import { EVENT_TYPES, TRANSACTION_STATUS } from "../classifiers/event_classifier.js";

const ACQUISITION_TYPES = new Set([
  EVENT_TYPES.TRADE_BUY,
  EVENT_TYPES.AIRDROP,
  EVENT_TYPES.STAKING_REWARD,
  EVENT_TYPES.DEFI_REWARD,
  EVENT_TYPES.SWAP,
]);

const DISPOSAL_TYPES = new Set([
  EVENT_TYPES.TRADE_SELL,
  EVENT_TYPES.SWAP,
]);

export function calculateFifoCapitalGains(unifiedTransactions, userId = "demo-user") {
  const inventory = new Map();
  const lots = [];
  const warnings = [];
  const txs = unifiedTransactions.map((tx) => ({ ...tx }));

  const ordered = txs.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const tx of ordered) {
    if (isAcquisition(tx)) {
      enqueueAcquisition(tx, inventory);
    }

    if (!isDisposal(tx)) continue;

    const asset = disposalAsset(tx);
    const quantity = disposalAmount(tx);
    if (!asset || !Number.isFinite(quantity) || quantity <= 0) continue;

    if (!inventory.has(asset)) inventory.set(asset, []);
    const queue = inventory.get(asset);
    let remaining = quantity;
    const unitSellPriceUsdt = resolveDisposalUnitPriceUsdt(tx);
    const unitSellPriceKrw = resolveDisposalUnitPriceKrw(tx);

    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0];
      const matched = Math.min(remaining, lot.remaining);
      const lotId = `${lot.lot_id}-${tx.id}-${Math.round(matched * 1e8)}`;

      lots.push({
        id: `RPL-${lots.length + 1}-${tx.id}`,
        user_id: userId,
        asset,
        buy_transaction_id: lot.transaction_id,
        sell_transaction_id: tx.id,
        buy_event_type: lot.event_type,
        sell_event_type: tx.event_type,
        buy_timestamp: lot.timestamp,
        sell_timestamp: tx.timestamp,
        buy_source: lot.source,
        sell_source: tx.source_name || tx.exchange || tx.wallet_address,
        buy_amount: matched,
        sell_amount: matched,
        matched_amount: matched,
        buy_price_usdt: lot.unit_cost_usdt,
        sell_price_usdt: unitSellPriceUsdt,
        buy_price_krw: lot.unit_cost_krw,
        sell_price_krw: unitSellPriceKrw,
        profit_usdt: matched * (unitSellPriceUsdt - lot.unit_cost_usdt),
        profit_krw: (unitSellPriceKrw - lot.unit_cost_krw) * matched,
        buy_pricing_source: lot.pricing_source,
        sell_pricing_source: tx.pricing_source || "",
        calculation_method: "FIFO",
        created_at: new Date().toISOString(),
      });

      tx.matched_lot_id = lotId;
      tx.status = TRANSACTION_STATUS.MATCHED;

      lot.remaining -= matched;
      remaining -= matched;
      if (lot.remaining <= 0) queue.shift();
    }

    if (remaining > 0) {
      warnings.push(`${tx.timestamp} ${asset} disposal ${round(remaining)} 수량이 FIFO 매칭되지 않았습니다.`);
    }
  }

  const txIndex = new Map(txs.map((tx) => [tx.id, tx]));
  for (const orderedTx of ordered) {
    txIndex.set(orderedTx.id, orderedTx);
  }

  return {
    transactions: Array.from(txIndex.values()),
    lots,
    warnings,
    realizedSellCount: new Set(lots.map((lot) => lot.sell_transaction_id)).size,
  };
}

function enqueueAcquisition(tx, inventory) {
  const asset = acquisitionAsset(tx);
  const quantity = acquisitionAmount(tx);
  if (!asset || !Number.isFinite(quantity) || quantity <= 0) return;

  const unitCostUsdt = resolveAcquisitionUnitPriceUsdt(tx);
  const unitCostKrw = resolveAcquisitionUnitPriceKrw(tx);
  if (!Number.isFinite(unitCostUsdt) && !Number.isFinite(unitCostKrw)) return;

  const queue = inventory.get(asset) || [];
  queue.push({
    lot_id: `LOT-${tx.id}`,
    transaction_id: tx.id,
    event_type: tx.event_type,
    timestamp: tx.timestamp,
    source: tx.source_name || tx.exchange || tx.wallet_address,
    remaining: quantity,
    unit_cost_usdt: unitCostUsdt,
    unit_cost_krw: unitCostKrw,
    pricing_source: tx.pricing_source || "",
  });
  inventory.set(asset, queue);
}

function isAcquisition(tx) {
  if (!ACQUISITION_TYPES.has(tx.event_type)) return false;
  if (tx.transfer_match_status === "AUTO_MATCHED" || tx.transfer_match_status === "MANUALLY_CONFIRMED") return false;
  return true;
}

function isDisposal(tx) {
  if (!DISPOSAL_TYPES.has(tx.event_type)) return false;
  if (tx.transfer_match_status === "AUTO_MATCHED" || tx.transfer_match_status === "MANUALLY_CONFIRMED") return false;
  return true;
}

function acquisitionAsset(tx) {
  return tx.asset_in;
}

function acquisitionAmount(tx) {
  return Number(tx.amount_in);
}

function disposalAsset(tx) {
  return tx.asset_out;
}

function disposalAmount(tx) {
  return Number(tx.amount_out);
}

function resolveAcquisitionUnitPriceUsdt(tx) {
  const directPriceUsdt = readFiniteNumber(tx.price_usdt);
  if (Number.isFinite(directPriceUsdt)) return directPriceUsdt;
  const quantity = acquisitionAmount(tx);
  const total = readFiniteNumber(tx.amount_in_krw);
  const fxRate = readFiniteNumber(tx.fx_rate_usdt_krw);
  if (Number.isFinite(total) && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(fxRate) && fxRate > 0) {
    return total / quantity / fxRate;
  }
  return NaN;
}

function resolveAcquisitionUnitPriceKrw(tx) {
  const directPriceKrw = readFiniteNumber(tx.price_krw);
  if (Number.isFinite(directPriceKrw)) return directPriceKrw;
  const quantity = acquisitionAmount(tx);
  const total = readFiniteNumber(tx.amount_in_krw);
  if (Number.isFinite(total) && Number.isFinite(quantity) && quantity > 0) {
    return total / quantity;
  }
  return NaN;
}

function resolveDisposalUnitPriceUsdt(tx) {
  const directPriceUsdt = readFiniteNumber(tx.price_usdt);
  if (Number.isFinite(directPriceUsdt)) return directPriceUsdt;
  const quantity = disposalAmount(tx);
  const proceedsUsdt = readFiniteNumber(tx.amount_in);
  if (Number.isFinite(proceedsUsdt) && Number.isFinite(quantity) && quantity > 0) {
    return proceedsUsdt / quantity;
  }
  const proceedsKrw = readFiniteNumber(tx.amount_in_krw) ?? readFiniteNumber(tx.amount_out_krw);
  const fxRate = readFiniteNumber(tx.fx_rate_usdt_krw);
  if (Number.isFinite(proceedsKrw) && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(fxRate) && fxRate > 0) {
    return proceedsKrw / quantity / fxRate;
  }
  return NaN;
}

function resolveDisposalUnitPriceKrw(tx) {
  const directPriceKrw = readFiniteNumber(tx.price_krw);
  if (Number.isFinite(directPriceKrw)) return directPriceKrw;
  const quantity = disposalAmount(tx);
  const proceedsKrw = readFiniteNumber(tx.amount_in_krw) ?? readFiniteNumber(tx.amount_out_krw);
  if (Number.isFinite(proceedsKrw) && Number.isFinite(quantity) && quantity > 0) {
    return proceedsKrw / quantity;
  }
  const proceedsUsdt = readFiniteNumber(tx.amount_in);
  const fxRate = readFiniteNumber(tx.fx_rate_usdt_krw);
  if (Number.isFinite(proceedsUsdt) && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(fxRate) && fxRate > 0) {
    return (proceedsUsdt * fxRate) / quantity;
  }
  return NaN;
}

function readFiniteNumber(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
