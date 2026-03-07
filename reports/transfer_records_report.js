export const TRANSFER_RECORDS_HEADERS = [
  "timestamp",
  "chain",
  "asset",
  "amount",
  "from_exchange_or_wallet",
  "to_exchange_or_wallet",
  "from_label",
  "to_label",
  "involves_user_owned_address",
  "transfer_group_id",
  "transfer_match_status",
  "transfer_match_confidence",
  "transfer_match_reason",
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
      chain: tx.chain,
      asset: tx.asset_in || tx.asset_out,
      amount: tx.amount_in || tx.amount_out,
      from_exchange_or_wallet: tx.from_address_label || tx.from_address || tx.source_name,
      to_exchange_or_wallet: tx.to_address_label || tx.to_address || tx.source_name,
      from_label: tx.from_address_label || tx.wallet_address_label || "",
      to_label: tx.to_address_label || tx.wallet_address_label || "",
      involves_user_owned_address: tx.involves_user_owned_address ? "YES" : "NO",
      transfer_group_id: tx.transfer_group_id,
      transfer_match_status: tx.transfer_match_status,
      transfer_match_confidence: tx.transfer_match_confidence,
      transfer_match_reason: tx.transfer_match_reason,
      tx_hash: tx.tx_hash,
      note: tx.note,
    }));
}
