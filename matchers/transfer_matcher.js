export function matchTransfers(unifiedTransactions) {
  // Placeholder for future CEX <-> on-chain transfer grouping.
  // It will assign transfer_group_id on both ends of matched transfers.
  return unifiedTransactions.map((tx) => ({ ...tx }));
}
