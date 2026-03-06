import { EVENT_TYPES } from "../classifiers/event_classifier.js";
import { getUsdtKrwAt } from "../pricing/fx_rate_service.js";

export function calculateFifoRealizedPnl(events) {
  const inventory = new Map();
  const records = [];
  const warnings = [];
  const realizedSellIds = new Set();

  const tradeEvents = events.filter((event) =>
    event.event_type === EVENT_TYPES.TRADE_BUY || event.event_type === EVENT_TYPES.TRADE_SELL
  );

  for (const event of tradeEvents) {
    const asset = event.base_asset;
    if (!inventory.has(asset)) {
      inventory.set(asset, []);
    }

    const lots = inventory.get(asset);

    if (event.event_type === EVENT_TYPES.TRADE_BUY) {
      const buyFeeUsdt = event.fee_asset === event.quote_asset ? event.fee_usdt : 0;
      const buyFeeKrw = buyFeeUsdt * getUsdtKrwAt(event.timestamp);
      const unitCostUsdt = (event.total_usdt + buyFeeUsdt) / event.amount;
      const unitCostKrw = (event.total_krw + buyFeeKrw) / event.amount;

      lots.push({
        buy_id: event.id,
        buy_time: event.timestamp,
        buy_exchange_or_wallet: event.wallet_or_source || event.exchange,
        remaining: event.amount,
        unit_cost_usdt: unitCostUsdt,
        unit_cost_krw: unitCostKrw,
      });
      continue;
    }

    let sellRemaining = event.amount;
    const sellFeeUsdt = event.fee_asset === event.quote_asset ? event.fee_usdt : 0;
    const sellFeeKrw = sellFeeUsdt * getUsdtKrwAt(event.timestamp);
    const unitProceedsUsdt = (event.total_usdt - sellFeeUsdt) / event.amount;
    const unitProceedsKrw = (event.total_krw - sellFeeKrw) / event.amount;

    while (sellRemaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedAmount = Math.min(sellRemaining, lot.remaining);

      const costUsdt = matchedAmount * lot.unit_cost_usdt;
      const proceedsUsdt = matchedAmount * unitProceedsUsdt;
      const profitUsdt = proceedsUsdt - costUsdt;

      const costKrw = matchedAmount * lot.unit_cost_krw;
      const proceedsKrw = matchedAmount * unitProceedsKrw;
      const profitKrw = proceedsKrw - costKrw;

      records.push({
        asset,
        buy_time: lot.buy_time,
        sell_time: event.timestamp,
        buy_exchange_or_wallet: lot.buy_exchange_or_wallet,
        sell_exchange_or_wallet: event.wallet_or_source || event.exchange,
        buy_price_usdt: round(lot.unit_cost_usdt),
        sell_price_usdt: round(unitProceedsUsdt),
        buy_price_krw: round(lot.unit_cost_krw),
        sell_price_krw: round(unitProceedsKrw),
        amount: round(matchedAmount),
        profit_usdt: round(profitUsdt),
        profit_krw: round(profitKrw),
        calculation_method: "FIFO",
      });

      lot.remaining -= matchedAmount;
      sellRemaining -= matchedAmount;
      realizedSellIds.add(event.id);

      if (lot.remaining <= 0) {
        lots.shift();
      }
    }

    if (sellRemaining > 0) {
      warnings.push(
        `${event.timestamp} ${asset} 매도 ${round(sellRemaining)} 수량은 매수 내역과 FIFO 매칭되지 않았습니다.`
      );
    }
  }

  return {
    records,
    warnings,
    realizedSellCount: realizedSellIds.size,
  };
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
