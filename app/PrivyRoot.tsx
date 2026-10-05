"use client";

/**
 * Mounts Privy (X sign-in + embedded Solana wallets) and registers the
 * bridge in lib/privy-client. Loaded lazily by <PrivyMount/> only when
 * NEXT_PUBLIC_PRIVY_APP_ID is set, so the SDK never ships otherwise.
 *
 * It renders nothing of its own: the app's components talk to Privy through
 * the bridge, so Privy doesn't need to wrap the page.
 */

import { useEffect, useMemo } from "react";
import { PrivyProvider, useIdentityToken, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PRIVY_APP_ID, setPrivyBridge } from "@/lib/privy-client";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
const CHAIN = (CLUSTER === "mainnet-beta" ? "solana:mainnet" : `solana:${CLUSTER}`) as "solana:devnet";

function Bridge() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { initOAuth } = useLoginWithOAuth();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();

  // The user's Privy embedded wallet (not an external wallet they linked).
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
        const { wallet } = await createWallet();
        return wallet.address;
      },
      signMessage: async (message) => {
        if (!embedded) throw { code: 4100, message: "No X wallet yet." };
        const { signature } = await signMessage({ message, wallet: embedded });
        return signature;
      },
      signTransaction: async (transaction) => {
        if (!embedded) throw { code: 4100, message: "No X wallet yet." };
        const { signedTransaction } = await signTransaction({ transaction, wallet: embedded, chain: CHAIN });
        return signedTransaction;
      },
      tokens: async () => ({ idToken: identityToken ?? undefined, accessToken: (await getAccessToken()) ?? undefined }),
      logout
    });
  }, [ready, authenticated, user, embedded, identityToken, initOAuth, createWallet, signMessage, signTransaction, getAccessToken, logout]);

  useEffect(() => () => setPrivyBridge(null), []);
  return null;
}

export default function PrivyRoot() {
  const config = useMemo(() => ({
    loginMethods: ["twitter" as const],
    appearance: { theme: "dark" as const, walletChainType: "solana-only" as const },
    // Embedded wallets are created only for players who choose "play with X".
    embeddedWallets: { solana: { createOnLogin: "off" as const } },
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
