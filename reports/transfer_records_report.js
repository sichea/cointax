export const TRANSFER_RECORDS_HEADERS = [
  "timestamp",
  "asset",
  "amount",
  "from_exchange_or_wallet",
  "to_exchange_or_wallet",
  "tx_hash",
  "note",
];

export function buildTransferRecordRows(unifiedTransactions) {
  return unifiedTransactions
    .filter((tx) =>
      tx.event_type === "TRANSFER_IN"
      || tx.event_type === "TRANSFER_OUT"
      || tx.event_type === "INTERNAL_TRANSFER"
      || tx.event_type === "DEPOSIT"
      || tx.event_type === "WITHDRAWAL"
    )
    .map((tx) => ({
      timestamp: tx.timestamp,
      asset: tx.asset_in || tx.asset_out,
      amount: tx.amount_in || tx.amount_out,
      from_exchange_or_wallet: tx.from_address || tx.source_name,
      to_exchange_or_wallet: tx.to_address || tx.source_name,
      tx_hash: tx.tx_hash,
      note: tx.note,
    }));
}
