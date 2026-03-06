import { EVENT_TYPES, INCOME_CATEGORIES, TRANSACTION_STATUS } from "../classifiers/event_classifier.js";
import { SOURCE_TYPES } from "./source_types.js";

const BINANCE_SPOT_HEADERS = {
  timestamp: ["Date(UTC)"],
  pair: ["Pair"],
  baseAsset: ["Base Asset"],
  quoteAsset: ["Quote Asset"],
  side: ["Type"],
  price: ["Price"],
  amount: ["Amount"],
  total: ["Total"],
  fee: ["Fee"],
  feeAsset: ["Fee Coin"],
};

export function canParseBinanceSpotTrade(headers = [], fileName = "") {
  const normalizedHeaders = new Set((headers || []).map((h) => normalizeHeader(h)));
  const required = [
    BINANCE_SPOT_HEADERS.timestamp[0],
    BINANCE_SPOT_HEADERS.pair[0],
    BINANCE_SPOT_HEADERS.baseAsset[0],
    BINANCE_SPOT_HEADERS.quoteAsset[0],
    BINANCE_SPOT_HEADERS.side[0],
    BINANCE_SPOT_HEADERS.price[0],
    BINANCE_SPOT_HEADERS.amount[0],
    BINANCE_SPOT_HEADERS.total[0],
    BINANCE_SPOT_HEADERS.fee[0],
    BINANCE_SPOT_HEADERS.feeAsset[0],
  ];

  const hasAll = required.every((h) => normalizedHeaders.has(normalizeHeader(h)));
  if (hasAll) return true;

  return fileName.toLowerCase().includes("binance");
}

export function parseBinanceSpotTradeRows(rows, sourceFile, { userId = "demo-user" } = {}) {
  const sample = rows[0] || {};
  const columns = resolveColumns(sample);

  return rows
    .map((row, index) => normalize_binance_spot_trade_row(row, sourceFile, index + 2, columns, userId))
    .filter(Boolean);
}

export function normalize_binance_spot_trade_row(row, fileName, rawRowIndex, columns, userId = "demo-user") {
  const sideRaw = String(getCell(row, columns.side) || "").trim().toUpperCase();
  const eventType = toEventType(sideRaw);
  if (!eventType) return null;

  const timestamp = normalizeTimestamp(getCell(row, columns.timestamp));
  const baseAsset = toUpper(getCell(row, columns.baseAsset));
  const quoteAsset = toUpper(getCell(row, columns.quoteAsset));
  const price = toNumber(getCell(row, columns.price));
  const amount = toNumber(getCell(row, columns.amount));
  const total = toNumber(getCell(row, columns.total));
  const fee = toNumberOrZero(getCell(row, columns.fee));
  const feeAsset = toUpper(getCell(row, columns.feeAsset));

  if (!timestamp || !baseAsset || !quoteAsset || !Number.isFinite(amount) || !Number.isFinite(total)) {
    return null;
  }

  let assetIn = "";
  let assetOut = "";
  let amountIn = NaN;
  let amountOut = NaN;

  if (eventType === EVENT_TYPES.TRADE_BUY) {
    assetIn = baseAsset;
    amountIn = amount;
    assetOut = quoteAsset;
    amountOut = total;
  } else {
    assetIn = quoteAsset;
    amountIn = total;
    assetOut = baseAsset;
    amountOut = amount;
  }

  const priceUsdt = Number.isFinite(price) ? price : null;
  const isQuoteStable = quoteAsset === "USDT" || quoteAsset === "USDC";
  const note = isQuoteStable
    ? null
    : `Quote Asset=${quoteAsset}. price_usdt is raw trade price and requires future FX conversion.`;

  const now = new Date().toISOString();
  const unified = {
    id: `binance-spot-${fileName}-${rawRowIndex}`,
    user_id: userId,
    created_at: now,
    updated_at: now,

    source_type: SOURCE_TYPES.EXCHANGE_CSV,
    source_name: "Binance Spot Trade History",
    source_file: fileName,
    raw_row_index: rawRowIndex,
    raw_description: JSON.stringify(row),

    timestamp,
    event_type: eventType,
    income_category: INCOME_CATEGORIES.NONE,
    exchange: "Binance",
    chain: null,
    protocol: null,
    wallet_address: null,
    from_address: null,
    to_address: null,
    tx_hash: null,

    asset_in: assetIn,
    asset_out: assetOut,
    amount_in: amountIn,
    amount_out: amountOut,
    fee,
    fee_asset: feeAsset || null,

    price_usdt: priceUsdt,
    price_krw: null,
    amount_in_krw: null,
    amount_out_krw: null,
    fee_krw: null,
    fx_rate_usdt_krw: null,
    pricing_source: null,

    transfer_group_id: null,
    matched_lot_id: null,
    calculation_method: "FIFO",
    note,
    status: TRANSACTION_STATUS.NORMALIZED,
  };

  return validateNormalizedUnifiedTransaction(unified) ? unified : null;
}

export function validateNormalizedUnifiedTransaction(tx) {
  if (!tx || !tx.id || !tx.user_id) return false;
  if (!tx.timestamp || !tx.event_type || !tx.source_type) return false;
  if (!tx.asset_in || !tx.asset_out) return false;
  if (!Number.isFinite(tx.amount_in) || !Number.isFinite(tx.amount_out)) return false;
  return true;
}

function resolveColumns(sample) {
  return {
    timestamp: findColumn(sample, BINANCE_SPOT_HEADERS.timestamp),
    pair: findColumn(sample, BINANCE_SPOT_HEADERS.pair),
    baseAsset: findColumn(sample, BINANCE_SPOT_HEADERS.baseAsset),
    quoteAsset: findColumn(sample, BINANCE_SPOT_HEADERS.quoteAsset),
    side: findColumn(sample, BINANCE_SPOT_HEADERS.side),
    price: findColumn(sample, BINANCE_SPOT_HEADERS.price),
    amount: findColumn(sample, BINANCE_SPOT_HEADERS.amount),
    total: findColumn(sample, BINANCE_SPOT_HEADERS.total),
    fee: findColumn(sample, BINANCE_SPOT_HEADERS.fee),
    feeAsset: findColumn(sample, BINANCE_SPOT_HEADERS.feeAsset),
  };
}

function getCell(row, key) {
  if (!key) return "";
  return row[key];
}

function findColumn(sampleRow, aliases) {
  const keys = Object.keys(sampleRow || {});
  const aliasSet = new Set((aliases || []).map((alias) => normalizeHeader(alias)));
  for (const key of keys) {
    if (aliasSet.has(normalizeHeader(key))) return key;
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\uFEFF]/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function toEventType(side) {
  if (side.includes("BUY")) return EVENT_TYPES.TRADE_BUY;
  if (side.includes("SELL")) return EVENT_TYPES.TRADE_SELL;
  return "";
}

function normalizeTimestamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function toNumberOrZero(value) {
  const num = toNumber(value);
  return Number.isFinite(num) ? num : 0;
}
