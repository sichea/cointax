import { fetchSolanaWalletActivity } from "../providers/solana_provider.js";
import { normalizeSolanaWalletActivity } from "../normalizers/solana_transaction_normalizer.js";

export async function ingestSolanaWalletActivity(walletRecord, { userId = "demo-user" } = {}) {
  const rawActivities = await fetchSolanaWalletActivity({
    walletAddress: walletRecord.wallet_address,
    chain: walletRecord.chain,
  });

  const normalizedRows = normalizeSolanaWalletActivity(rawActivities, walletRecord, { userId });

  return {
    walletAddressId: walletRecord.id,
    rawCount: rawActivities.length,
    normalizedRows,
  };
}
