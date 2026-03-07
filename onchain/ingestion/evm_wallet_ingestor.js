import { fetchEvmWalletActivity } from "../providers/evm_provider.js";
import { normalizeEvmWalletActivity } from "../normalizers/evm_transaction_normalizer.js";

export async function ingestEvmWalletActivity(walletRecord, { userId = "demo-user" } = {}) {
  const rawActivities = await fetchEvmWalletActivity({
    walletAddress: walletRecord.wallet_address,
    chain: walletRecord.chain,
  });

  const normalizedRows = normalizeEvmWalletActivity(rawActivities, walletRecord, { userId });

  return {
    walletAddressId: walletRecord.id,
    rawCount: rawActivities.length,
    normalizedRows,
  };
}
