"use client";

/**
 * Mounts Privy (X sign-in + the player's embedded Solana wallet) and
 * registers the bridge in lib/privy-client. Loaded lazily by <PrivyMount/>
 * only when NEXT_PUBLIC_PRIVY_APP_ID is set.
 *
 * It renders nothing of its own: the app's components talk to Privy through
 * the bridge, so Privy doesn't need to wrap the page.
 */

import { useEffect, useMemo } from "react";
import { getIdentityToken, PrivyProvider, useLoginWithOAuth, usePrivy, useUser } from "@privy-io/react-auth";
import { useCreateWallet, useExportWallet, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PRIVY_APP_ID, setPrivyBridge } from "@/lib/privy-client";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
const CHAIN = (CLUSTER === "mainnet-beta" ? "solana:mainnet" : `solana:${CLUSTER}`) as "solana:devnet";

function Bridge() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { initOAuth } = useLoginWithOAuth();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();

  // The user's Privy embedded wallet (the only wallet The Pit uses).
  const embedded = wallets.find((w) => /privy/i.test(w.standardWallet.name)) ?? null;

  useEffect(() => {
    setPrivyBridge({
      ready,
      authenticated,
      xUsername: user?.twitter?.username ?? null,
      embeddedAddress: embedded?.address ?? null,
      loginWithX: () => initOAuth({ provider: "twitter" }),
      ensureEmbeddedWallet: async () => {
        if (embedded) return embedded.address;
        try {
          const { wallet } = await createWallet();
          return wallet.address;
        } catch (err) {
          // Created on login a moment ago but not in `wallets` yet: read it from the user.
          const u = await refreshUser();
          const addr = u.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy");
          if (addr && "address" in addr) return addr.address;
          throw err;
        }
      },
      signTransaction: async (transaction) => {
        if (!embedded) throw { code: 4100, message: "Your X wallet isn't ready yet." };
        const { signedTransaction } = await signTransaction({ transaction, wallet: embedded, chain: CHAIN });
        return signedTransaction;
      },
      tokens: async () => {
        // Refresh first so the identity token lists a wallet created this session.
        await refreshUser().catch(() => undefined);
        const [idToken, accessToken] = await Promise.all([
          getIdentityToken().catch(() => null),
          getAccessToken().catch(() => null)
        ]);
        return { idToken: idToken ?? undefined, accessToken: accessToken ?? undefined };
      },
      exportWallet: () => exportWallet(embedded ? { address: embedded.address } : undefined),
      logout
    });
  }, [ready, authenticated, user, embedded, initOAuth, createWallet, refreshUser, signTransaction, exportWallet, getAccessToken, logout]);

  useEffect(() => () => setPrivyBridge(null), []);
  return null;
}

export default function PrivyRoot() {
  const config = useMemo(() => ({
    loginMethods: ["twitter" as const],
    appearance: { theme: "dark" as const, walletChainType: "solana-only" as const },
    // Every X account gets its Solana wallet as it signs in.
    embeddedWallets: { solana: { createOnLogin: "users-without-wallets" as const } },
    solana: {
      rpcs: {
        [CHAIN]: {
          rpc: createSolanaRpc(RPC),
          rpcSubscriptions: createSolanaRpcSubscriptions(RPC.replace(/^http/, "ws"))
        }
      }
    }
  }), []);
  if (!PRIVY_APP_ID) return null;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={config}>
      <Bridge />
    </PrivyProvider>
  );
}
