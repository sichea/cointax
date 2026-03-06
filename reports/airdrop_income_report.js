export const AIRDROP_INCOME_HEADERS = [
  "timestamp",
  "asset",
  "amount",
  "source",
  "tx_hash",
  "price_usdt_at_receive",
  "price_krw_at_receive",
  "income_usdt",
  "income_krw",
  "note",
];

export function buildAirdropIncomeRows(unifiedTransactions) {
  return unifiedTransactions
    .filter((tx) => tx.event_type === "AIRDROP")
    .map((tx) => ({
      timestamp: tx.timestamp,
      asset: tx.asset_in,
      amount: tx.amount_in,
      source: tx.source_name,
      tx_hash: tx.tx_hash,
      price_usdt_at_receive: tx.price_usdt,
      price_krw_at_receive: tx.price_krw,
      income_usdt: tx.amount_in,
      income_krw: tx.amount_in_krw,
      note: tx.note,
    }));
}
