//! Oracle Rumble — non-custodial escrow program.
//!
//! Holds the money for one rumble (a Market-Royale battle-royale round series):
//! a shared entry pool plus every player's isolated trading vault. Funds live in
//! a program-owned token account; the operator/host can never move them to
//! itself. The only ways USDC leaves the escrow:
//!
//!   * `Claim`   — a player withdraws the entitlement the host assigned them at
//!                 settlement (remaining vault + prize share), once and only once.
//!   * `Recover` — if the host never settles, any player can, after the settle
//!                 deadline, reclaim their own entry + vault. This is the
//!                 Market-Royale fair-play guarantee, enforced on-chain.
//!
//! Conservation is enforced: the sum of assigned entitlements can never exceed
//! what was actually escrowed, so a buggy or malicious settlement cannot mint
//! funds or overpay the pool.
//!
//! Trust model: the host is trusted to compute the RANKINGS (who won), because
//! ranking depends on off-chain price history. The host is NOT trusted with
//! CUSTODY — it cannot withdraw, cannot exceed the escrowed total, and cannot
//! stop a player from recovering after the deadline.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::{clock::Clock, Sysvar},
};
use spl_associated_token_account::{
    get_associated_token_address, instruction::create_associated_token_account,
};
use thiserror::Error;

// ── seeds ───────────────────────────────────────────────────────────────
pub const ROUND_SEED: &[u8] = b"round";
pub const AUTH_SEED: &[u8] = b"auth";
pub const PLAYER_SEED: &[u8] = b"player";

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_SETTLED: u8 = 1;

// ── errors ──────────────────────────────────────────────────────────────
#[derive(Error, Debug, Copy, Clone)]
pub enum EscrowError {
    #[error("account already initialized")]
    AlreadyInitialized,
    #[error("account not initialized")]
    NotInitialized,
    #[error("not the round host")]
    NotHost,
    #[error("round is full")]
    RoundFull,
    #[error("round is not open")]
    NotOpen,
    #[error("round is not settled")]
    NotSettled,
    #[error("already claimed")]
    AlreadyClaimed,
    #[error("player not settled")]
    PlayerNotSettled,
    #[error("entitlements exceed escrowed funds")]
    Overpay,
    #[error("settle deadline not reached")]
    DeadlineNotReached,
    #[error("account mismatch")]
    AccountMismatch,
    #[error("numeric overflow")]
    Overflow,
    #[error("invalid amount")]
    InvalidAmount,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32 + 100)
    }
}

// ── state ───────────────────────────────────────────────────────────────
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RoundVault {
    pub is_initialized: bool,
    pub host: Pubkey,
    pub usdc_mint: Pubkey,
    pub escrow_token_account: Pubkey,
    pub entry_amount: u64,
    pub vault_amount: u64,
    pub capacity: u16,
    pub deposited: u16,
    pub pool_total: u64,
    pub total_escrowed: u64,
    pub settled_total: u64,
    pub claimed_total: u64,
    pub settle_deadline: i64,
    pub status: u8,
    pub bump: u8,
    pub vault_authority_bump: u8,
}
pub const ROUND_VAULT_LEN: usize = 168;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct PlayerEntry {
    pub is_initialized: bool,
    pub round: Pubkey,
    pub wallet: Pubkey,
    pub vault_deposit: u64,
    pub entitlement: u64,
    pub settled: bool,
    pub claimed: bool,
    pub bump: u8,
}
pub const PLAYER_ENTRY_LEN: usize = 84;

// ── instructions ────────────────────────────────────────────────────────
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum EscrowInstruction {
    /// Create a rumble escrow. Accounts:
    /// 0 host (signer, writable, rent payer)
    /// 1 round_vault PDA [ROUND_SEED, host, round_seed] (writable, created)
    /// 2 vault_authority PDA [AUTH_SEED, round_vault] (read)
    /// 3 usdc_mint (read)
    /// 4 escrow_token_account = ATA(vault_authority, mint) (writable, created)
    /// 5 system_program  6 token_program  7 associated_token_program  8 rent
    InitRound {
        round_seed: [u8; 32],
        entry_amount: u64,
        vault_amount: u64,
        capacity: u16,
        settle_deadline: i64,
    },
    /// Player funds their seat (entry + vault). Accounts:
    /// 0 player (signer, writable) 1 round_vault (writable)
    /// 2 player_entry PDA [PLAYER_SEED, round_vault, player] (writable, created)
    /// 3 player_usdc_ata (writable, source) 4 escrow_token_account (writable, dest)
    /// 5 system_program 6 token_program
    Deposit,
    /// Host assigns a player's withdrawable entitlement. Accounts:
    /// 0 host (signer) 1 round_vault (writable) 2 player_entry (writable)
    SettlePlayer { entitlement: u64 },
    /// Host locks settlement so players can claim. Accounts:
    /// 0 host (signer) 1 round_vault (writable)
    CloseSettlement,
    /// Player withdraws their settled entitlement. Accounts:
    /// 0 player (signer, writable) 1 round_vault (writable) 2 player_entry (writable)
    /// 3 vault_authority PDA 4 escrow_token_account (writable)
    /// 5 player_usdc_ata (writable, dest) 6 token_program
    Claim,
    /// After the deadline with no settlement, player reclaims entry + vault. Accounts:
    /// 0 player (signer, writable) 1 round_vault (writable) 2 player_entry (writable)
    /// 3 vault_authority PDA 4 escrow_token_account (writable)
    /// 5 player_usdc_ata (writable, dest) 6 token_program 7 clock sysvar
    Recover,
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let ix = EscrowInstruction::try_from_slice(input)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        EscrowInstruction::InitRound {
            round_seed,
            entry_amount,
            vault_amount,
            capacity,
            settle_deadline,
        } => process_init_round(
            program_id,
            accounts,
            round_seed,
            entry_amount,
            vault_amount,
            capacity,
            settle_deadline,
        ),
        EscrowInstruction::Deposit => process_deposit(program_id, accounts),
        EscrowInstruction::SettlePlayer { entitlement } => {
            process_settle_player(program_id, accounts, entitlement)
        }
        EscrowInstruction::CloseSettlement => process_close_settlement(program_id, accounts),
        EscrowInstruction::Claim => process_withdraw(program_id, accounts, false),
        EscrowInstruction::Recover => process_withdraw(program_id, accounts, true),
    }
}

// ── helpers ─────────────────────────────────────────────────────────────

fn load_round(ai: &AccountInfo, program_id: &Pubkey) -> Result<RoundVault, ProgramError> {
    if ai.owner != program_id {
        return Err(EscrowError::AccountMismatch.into());
    }
    let v = RoundVault::try_from_slice(&ai.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if !v.is_initialized {
        return Err(EscrowError::NotInitialized.into());
    }
    Ok(v)
}

fn store_round(ai: &AccountInfo, v: &RoundVault) -> ProgramResult {
    v.serialize(&mut &mut ai.data.borrow_mut()[..])
        .map_err(|_| ProgramError::AccountDataTooSmall.into())
}

fn spl_transfer<'a>(
    token_program: &AccountInfo<'a>,
    source: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    let ix = spl_token::instruction::transfer(
        token_program.key,
        source.key,
        dest.key,
        authority.key,
        &[],
        amount,
    )?;
    invoke(
        &ix,
        &[source.clone(), dest.clone(), authority.clone(), token_program.clone()],
    )
}

fn spl_transfer_signed<'a>(
    token_program: &AccountInfo<'a>,
    source: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
    seeds: &[&[u8]],
) -> ProgramResult {
    let ix = spl_token::instruction::transfer(
        token_program.key,
        source.key,
        dest.key,
        authority.key,
        &[],
        amount,
    )?;
    invoke_signed(
        &ix,
        &[source.clone(), dest.clone(), authority.clone(), token_program.clone()],
        &[seeds],
    )
}

/// Read the SPL token account balance of `ai`.
fn token_balance(ai: &AccountInfo) -> Result<u64, ProgramError> {
    let acct = spl_token::state::Account::unpack(&ai.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(acct.amount)
}

// ── InitRound ───────────────────────────────────────────────────────────
#[allow(clippy::too_many_arguments)]
fn process_init_round(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    round_seed: [u8; 32],
    entry_amount: u64,
    vault_amount: u64,
    capacity: u16,
    settle_deadline: i64,
) -> ProgramResult {
    let it = &mut accounts.iter();
    let host = next_account_info(it)?;
    let round_vault = next_account_info(it)?;
    let vault_authority = next_account_info(it)?;
    let usdc_mint = next_account_info(it)?;
    let escrow_ta = next_account_info(it)?;
    let system_program = next_account_info(it)?;
    let token_program = next_account_info(it)?;
    let ata_program = next_account_info(it)?;
    let rent_sysvar = next_account_info(it)?;

    if !host.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if capacity < 2 || entry_amount == 0 || vault_amount == 0 {
        return Err(EscrowError::InvalidAmount.into());
    }

    // Derive + verify the round_vault PDA.
    let (rv_key, rv_bump) = Pubkey::find_program_address(
        &[ROUND_SEED, host.key.as_ref(), &round_seed],
        program_id,
    );
    if rv_key != *round_vault.key {
        return Err(EscrowError::AccountMismatch.into());
    }
    if round_vault.owner == program_id && !round_vault.data_is_empty() {
        return Err(EscrowError::AlreadyInitialized.into());
    }

    // Derive + verify the vault authority PDA (owns the escrow token account).
    let (auth_key, auth_bump) =
        Pubkey::find_program_address(&[AUTH_SEED, rv_key.as_ref()], program_id);
    if auth_key != *vault_authority.key {
        return Err(EscrowError::AccountMismatch.into());
    }

    // Escrow token account must be the ATA of the vault authority for this mint.
    let expected_ata = get_associated_token_address(&auth_key, usdc_mint.key);
    if expected_ata != *escrow_ta.key {
        return Err(EscrowError::AccountMismatch.into());
    }

    // Create the round_vault PDA account (program-owned data account).
    let rent = Rent::from_account_info(rent_sysvar)?;
    let lamports = rent.minimum_balance(ROUND_VAULT_LEN);
    invoke_signed(
        &system_instruction::create_account(
            host.key,
            round_vault.key,
            lamports,
            ROUND_VAULT_LEN as u64,
            program_id,
        ),
        &[host.clone(), round_vault.clone(), system_program.clone()],
        &[&[ROUND_SEED, host.key.as_ref(), &round_seed, &[rv_bump]]],
    )?;

    // Create the escrow ATA owned by the vault authority PDA.
    invoke(
        &create_associated_token_account(host.key, &auth_key, usdc_mint.key, token_program.key),
        &[
            host.clone(),
            escrow_ta.clone(),
            vault_authority.clone(),
            usdc_mint.clone(),
            system_program.clone(),
            token_program.clone(),
            ata_program.clone(),
        ],
    )?;

    let state = RoundVault {
        is_initialized: true,
        host: *host.key,
        usdc_mint: *usdc_mint.key,
        escrow_token_account: *escrow_ta.key,
        entry_amount,
        vault_amount,
        capacity,
        deposited: 0,
        pool_total: 0,
        total_escrowed: 0,
        settled_total: 0,
        claimed_total: 0,
        settle_deadline,
        status: STATUS_OPEN,
        bump: rv_bump,
        vault_authority_bump: auth_bump,
    };
    store_round(round_vault, &state)
}

// ── Deposit ─────────────────────────────────────────────────────────────
fn process_deposit(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let it = &mut accounts.iter();
    let player = next_account_info(it)?;
    let round_vault = next_account_info(it)?;
    let player_entry = next_account_info(it)?;
    let player_ata = next_account_info(it)?;
    let escrow_ta = next_account_info(it)?;
    let system_program = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut round = load_round(round_vault, program_id)?;
    if round.status != STATUS_OPEN {
        return Err(EscrowError::NotOpen.into());
    }
    if round.deposited >= round.capacity {
        return Err(EscrowError::RoundFull.into());
    }
    if *escrow_ta.key != round.escrow_token_account {
        return Err(EscrowError::AccountMismatch.into());
    }

    // Derive + verify the player_entry PDA, and create it (one seat per wallet).
    let (pe_key, pe_bump) = Pubkey::find_program_address(
        &[PLAYER_SEED, round_vault.key.as_ref(), player.key.as_ref()],
        program_id,
    );
    if pe_key != *player_entry.key {
        return Err(EscrowError::AccountMismatch.into());
    }
    if player_entry.owner == program_id && !player_entry.data_is_empty() {
        return Err(EscrowError::AlreadyInitialized.into());
    }
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(PLAYER_ENTRY_LEN);
    invoke_signed(
        &system_instruction::create_account(
            player.key,
            player_entry.key,
            lamports,
            PLAYER_ENTRY_LEN as u64,
            program_id,
        ),
        &[player.clone(), player_entry.clone(), system_program.clone()],
        &[&[PLAYER_SEED, round_vault.key.as_ref(), player.key.as_ref(), &[pe_bump]]],
    )?;

    let seat = round
        .entry_amount
        .checked_add(round.vault_amount)
        .ok_or(EscrowError::Overflow)?;
    spl_transfer(token_program, player_ata, escrow_ta, player, seat)?;

    round.pool_total = round
        .pool_total
        .checked_add(round.entry_amount)
        .ok_or(EscrowError::Overflow)?;
    round.total_escrowed = round
        .total_escrowed
        .checked_add(seat)
        .ok_or(EscrowError::Overflow)?;
    round.deposited = round.deposited.checked_add(1).ok_or(EscrowError::Overflow)?;
    store_round(round_vault, &round)?;

    let entry = PlayerEntry {
        is_initialized: true,
        round: *round_vault.key,
        wallet: *player.key,
        vault_deposit: round.vault_amount,
        entitlement: 0,
        settled: false,
        claimed: false,
        bump: pe_bump,
    };
    entry
        .serialize(&mut &mut player_entry.data.borrow_mut()[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

// ── SettlePlayer ────────────────────────────────────────────────────────
fn process_settle_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    entitlement: u64,
) -> ProgramResult {
    let it = &mut accounts.iter();
    let host = next_account_info(it)?;
    let round_vault = next_account_info(it)?;
    let player_entry = next_account_info(it)?;

    if !host.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut round = load_round(round_vault, program_id)?;
    if *host.key != round.host {
        return Err(EscrowError::NotHost.into());
    }
    if round.status != STATUS_OPEN {
        return Err(EscrowError::NotOpen.into());
    }
    if player_entry.owner != program_id {
        return Err(EscrowError::AccountMismatch.into());
    }
    let mut entry = PlayerEntry::try_from_slice(&player_entry.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if !entry.is_initialized || entry.round != *round_vault.key {
        return Err(EscrowError::AccountMismatch.into());
    }

    // Conservation: replace any prior entitlement for this player, then check
    // the running total never exceeds what was actually escrowed.
    let prior = if entry.settled { entry.entitlement } else { 0 };
    let new_total = round
        .settled_total
        .checked_sub(prior)
        .ok_or(EscrowError::Overflow)?
        .checked_add(entitlement)
        .ok_or(EscrowError::Overflow)?;
    if new_total > round.total_escrowed {
        return Err(EscrowError::Overpay.into());
    }
    round.settled_total = new_total;
    store_round(round_vault, &round)?;

    entry.entitlement = entitlement;
    entry.settled = true;
    entry
        .serialize(&mut &mut player_entry.data.borrow_mut()[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

// ── CloseSettlement ─────────────────────────────────────────────────────
fn process_close_settlement(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let it = &mut accounts.iter();
    let host = next_account_info(it)?;
    let round_vault = next_account_info(it)?;
    if !host.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut round = load_round(round_vault, program_id)?;
    if *host.key != round.host {
        return Err(EscrowError::NotHost.into());
    }
    if round.status != STATUS_OPEN {
        return Err(EscrowError::NotOpen.into());
    }
    round.status = STATUS_SETTLED;
    store_round(round_vault, &round)
}

// ── Claim / Recover (shared withdraw path) ──────────────────────────────
fn process_withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    recovery: bool,
) -> ProgramResult {
    let it = &mut accounts.iter();
    let player = next_account_info(it)?;
    let round_vault = next_account_info(it)?;
    let player_entry = next_account_info(it)?;
    let vault_authority = next_account_info(it)?;
    let escrow_ta = next_account_info(it)?;
    let player_ata = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut round = load_round(round_vault, program_id)?;
    if *escrow_ta.key != round.escrow_token_account {
        return Err(EscrowError::AccountMismatch.into());
    }

    if player_entry.owner != program_id {
        return Err(EscrowError::AccountMismatch.into());
    }
    let mut entry = PlayerEntry::try_from_slice(&player_entry.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if !entry.is_initialized
        || entry.round != *round_vault.key
        || entry.wallet != *player.key
    {
        return Err(EscrowError::AccountMismatch.into());
    }
    if entry.claimed {
        return Err(EscrowError::AlreadyClaimed.into());
    }

    // Decide the withdraw amount and status gate.
    let amount = if recovery {
        // Recovery is only allowed on an unsettled round past its deadline, and
        // returns exactly this player's own funds (entry + vault deposit).
        if round.status != STATUS_OPEN {
            return Err(EscrowError::NotOpen.into());
        }
        let now = Clock::get()?.unix_timestamp;
        if now < round.settle_deadline {
            return Err(EscrowError::DeadlineNotReached.into());
        }
        round
            .entry_amount
            .checked_add(entry.vault_deposit)
            .ok_or(EscrowError::Overflow)?
    } else {
        if round.status != STATUS_SETTLED {
            return Err(EscrowError::NotSettled.into());
        }
        if !entry.settled {
            return Err(EscrowError::PlayerNotSettled.into());
        }
        entry.entitlement
    };

    // Never transfer more than the escrow actually holds.
    let held = token_balance(escrow_ta)?;
    if amount > held {
        return Err(EscrowError::Overpay.into());
    }

    // Verify the vault authority PDA before signing with it.
    let auth_seeds: &[&[u8]] = &[AUTH_SEED, round_vault.key.as_ref(), &[round.vault_authority_bump]];
    let auth_key = Pubkey::create_program_address(auth_seeds, program_id)
        .map_err(|_| EscrowError::AccountMismatch)?;
    if auth_key != *vault_authority.key {
        return Err(EscrowError::AccountMismatch.into());
    }

    if amount > 0 {
        spl_transfer_signed(
            token_program,
            escrow_ta,
            player_ata,
            vault_authority,
            amount,
            auth_seeds,
        )?;
    }

    round.claimed_total = round
        .claimed_total
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    store_round(round_vault, &round)?;

    entry.claimed = true;
    entry
        .serialize(&mut &mut player_entry.data.borrow_mut()[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}
