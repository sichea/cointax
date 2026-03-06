export const TRADE_PROFIT_HEADERS = [
  "asset",
  "buy_time",
  "sell_time",
  "buy_exchange_or_wallet",
  "sell_exchange_or_wallet",
  "buy_price_usdt",
  "sell_price_usdt",
  "buy_price_krw",
  "sell_price_krw",
  "amount",
  "profit_usdt",
  "profit_krw",
  "calculation_method",
];

export function buildTradeProfitRows(records) {
  return records.map((row) => ({
    asset: row.asset,
    buy_time: row.buy_time,
    sell_time: row.sell_time,
    buy_exchange_or_wallet: row.buy_exchange_or_wallet,
    sell_exchange_or_wallet: row.sell_exchange_or_wallet,
    buy_price_usdt: row.buy_price_usdt,
    sell_price_usdt: row.sell_price_usdt,
    buy_price_krw: row.buy_price_krw,
    sell_price_krw: row.sell_price_krw,
    amount: row.amount,
    profit_usdt: row.profit_usdt,
    profit_krw: row.profit_krw,
    calculation_method: row.calculation_method,
  }));
}
