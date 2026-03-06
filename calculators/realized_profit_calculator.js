import { matchFifoLots } from "../matchers/fifo_lot_matcher.js";

export function calculateRealizedProfit(unifiedTransactions, userId = "demo-user") {
  const { transactions, lots, warnings } = matchFifoLots(unifiedTransactions);

  const realizedLots = lots.map((lot, index) => ({
    id: `RPL-${index + 1}-${lot.sell_transaction_id}`,
    user_id: userId,
    asset: lot.asset,
    buy_transaction_id: lot.buy_transaction_id,
    sell_transaction_id: lot.sell_transaction_id,
    buy_timestamp: lot.buy_timestamp,
    sell_timestamp: lot.sell_timestamp,
    buy_source: lot.buy_source,
    sell_source: lot.sell_source,
    buy_amount: round(lot.buy_amount),
    sell_amount: round(lot.sell_amount),
    buy_price_usdt: round(lot.buy_price_usdt),
    sell_price_usdt: round(lot.sell_price_usdt),
    buy_price_krw: round(lot.buy_price_krw),
    sell_price_krw: round(lot.sell_price_krw),
    profit_usdt: round(lot.profit_usdt),
    profit_krw: round(lot.profit_krw),
    calculation_method: lot.calculation_method,
    created_at: new Date().toISOString(),
  }));

  const realizedSellCount = new Set(realizedLots.map((row) => row.sell_transaction_id)).size;

  return { unifiedTransactions: transactions, realizedLots, warnings, realizedSellCount };
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
