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

export function buildTradeProfitRows(realizedLots) {
  return realizedLots.map((lot) => ({
    asset: lot.asset,
    buy_time: lot.buy_timestamp,
    sell_time: lot.sell_timestamp,
    buy_exchange_or_wallet: lot.buy_source,
    sell_exchange_or_wallet: lot.sell_source,
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
