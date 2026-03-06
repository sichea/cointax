import { EVENT_TYPES, isTradeEventType, TRANSACTION_STATUS } from "../classifiers/event_classifier.js";

export function matchFifoLots(unifiedTransactions) {
  const inventory = new Map();
  const lots = [];
  const warnings = [];

  const txs = unifiedTransactions.map((tx) => ({ ...tx }));
  const tradeRows = txs.filter(
    (tx) =>
      isTradeEventType(tx.event_type)
      && tx.event_type !== EVENT_TYPES.INTERNAL_TRANSFER
      && tx.transfer_match_status !== "AUTO_MATCHED"
      && tx.transfer_match_status !== "MANUALLY_CONFIRMED"
  );

  for (const tx of tradeRows) {
    const asset = tx.event_type === EVENT_TYPES.TRADE_BUY ? tx.asset_in : tx.asset_out;
    if (!inventory.has(asset)) {
      inventory.set(asset, []);
    }

    const queue = inventory.get(asset);

    if (tx.event_type === EVENT_TYPES.TRADE_BUY) {
      queue.push({
        lot_id: `LOT-${tx.id}`,
        transaction_id: tx.id,
        timestamp: tx.timestamp,
        source: tx.source_name || tx.exchange,
        remaining: tx.amount_in,
        unit_cost_usdt: tx.amount_in > 0 ? tx.amount_out / tx.amount_in : NaN,
        unit_cost_krw: tx.amount_in > 0 ? tx.amount_out_krw / tx.amount_in : NaN,
      });
      continue;
    }

    let sellRemaining = tx.amount_out;
    const unitSellPriceUsdt = tx.amount_out > 0 ? tx.amount_in / tx.amount_out : NaN;
    const unitSellPriceKrw = tx.amount_out > 0 ? tx.amount_in_krw / tx.amount_out : NaN;

    while (sellRemaining > 0 && queue.length > 0) {
      const lot = queue[0];
      const matched = Math.min(sellRemaining, lot.remaining);
      const lotId = `${lot.lot_id}-${tx.id}-${Math.round(matched * 1e8)}`;

      lots.push({
        matched_lot_id: lotId,
        buy_transaction_id: lot.transaction_id,
        sell_transaction_id: tx.id,
        asset,
        buy_timestamp: lot.timestamp,
        sell_timestamp: tx.timestamp,
        buy_source: lot.source,
        sell_source: tx.source_name || tx.exchange,
        buy_amount: matched,
        sell_amount: matched,
        buy_price_usdt: lot.unit_cost_usdt,
        sell_price_usdt: unitSellPriceUsdt,
        buy_price_krw: lot.unit_cost_krw,
        sell_price_krw: unitSellPriceKrw,
        profit_usdt: matched * (unitSellPriceUsdt - lot.unit_cost_usdt),
        profit_krw: matched * (unitSellPriceKrw - lot.unit_cost_krw),
        calculation_method: "FIFO",
      });

      tx.matched_lot_id = lotId;
      tx.status = TRANSACTION_STATUS.MATCHED;

      lot.remaining -= matched;
      sellRemaining -= matched;
      if (lot.remaining <= 0) queue.shift();
    }

    if (sellRemaining > 0) {
      warnings.push(`${tx.timestamp} ${asset} 매도 ${round(sellRemaining)} 수량이 FIFO 매칭되지 않았습니다.`);
    }
  }

  return { transactions: txs, lots, warnings };
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
