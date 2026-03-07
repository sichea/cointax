export const TRADE_PROFIT_HEADERS = [
  "asset",
  "buy_timestamp",
  "sell_timestamp",
  "buy_source",
  "sell_source",
  "buy_price_usdt",
  "sell_price_usdt",
  "buy_price_krw",
  "sell_price_krw",
  "amount",
  "profit_usdt",
  "profit_krw",
  "calculation_method",
];

export function buildTradeProfitRows(realizedLots) {
  return realizedLots.map((lot) => ({
    asset: lot.asset,
    buy_timestamp: lot.buy_timestamp,
    sell_timestamp: lot.sell_timestamp,
    buy_source: lot.buy_source,
    sell_source: lot.sell_source,
    buy_price_usdt: lot.buy_price_usdt,
    sell_price_usdt: lot.sell_price_usdt,
    buy_price_krw: lot.buy_price_krw,
    sell_price_krw: lot.sell_price_krw,
    amount: lot.sell_amount,
    profit_usdt: lot.profit_usdt,
    profit_krw: lot.profit_krw,
    calculation_method: lot.calculation_method,
  }));
}
