export const TRANSACTION_LEDGER_HEADERS = [
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "timestamp",
  "source_type",
  "source_name",
  "source_file",
  "raw_row_index",
  "raw_description",
  "event_type",
  "income_category",
  "exchange",
  "chain_family",
  "chain",
  "protocol",
  "wallet_address",
  "wallet_address_label",
  "from_address",
  "from_address_label",
  "to_address",
  "to_address_label",
  "wallet_user_owned_address",
  "from_user_owned_address",
  "to_user_owned_address",
  "involves_user_owned_address",
  "tx_hash",
  "asset_in",
  "asset_out",
  "amount_in",
  "amount_out",
  "fee",
  "fee_asset",
  "price_usdt",
  "price_krw",
  "amount_in_krw",
  "amount_out_krw",
  "fee_krw",
  "fx_rate_usdt_krw",
  "pricing_source",
  "transfer_group_id",
  "transfer_match_status",
  "matched_transaction_id",
  "transfer_match_confidence",
  "transfer_match_reason",
  "classification_confidence",
  "matched_lot_id",
  "calculation_method",
  "note",
  "status",
];

export function buildTransactionLedgerRows(unifiedTransactions) {
  return unifiedTransactions.map((tx) => {
    const row = {};
    for (const key of TRANSACTION_LEDGER_HEADERS) {
      row[key] = tx[key] ?? "";
    }
    return row;
  });
}
