export const DEFI_INCOME_HEADERS = [
  "timestamp",
  "protocol",
  "income_type",
  "asset",
  "amount",
  "price_usdt_at_receive",
  "price_krw_at_receive",
  "income_usdt",
  "income_krw",
  "tx_hash",
  "note",
];

export function buildDefiIncomeRows(unifiedTransactions) {
  return unifiedTransactions
    .filter((tx) => tx.event_type === "STAKING_REWARD" || tx.event_type === "DEFI_REWARD")
    .map((tx) => ({
      timestamp: tx.timestamp,
      protocol: tx.protocol,
      income_type: tx.event_type,
      asset: tx.asset_in,
      amount: tx.amount_in,
      price_usdt_at_receive: tx.price_usdt,
      price_krw_at_receive: tx.price_krw,
      income_usdt: tx.amount_in,
      income_krw: tx.amount_in_krw,
      tx_hash: tx.tx_hash,
      note: tx.note,
    }));
}
