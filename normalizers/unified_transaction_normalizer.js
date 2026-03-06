import { applyClassification, classifyEventTypeFromRaw, TRANSACTION_STATUS } from "../classifiers/event_classifier.js";
import { calculatePriceBundle } from "../pricing/asset_price_service.js";
import { FX_RATE_SOURCE, getUsdtKrwAt } from "../pricing/fx_rate_service.js";

export function normalizeUnifiedTransactions(rawTransactions, { userId = "demo-user" } = {}) {
  const now = new Date().toISOString();

  const normalized = rawTransactions
    .map((raw) => normalizeOne(raw, userId, now))
    .filter(Boolean)
    .map((tx) => ({ ...tx, status: TRANSACTION_STATUS.NORMALIZED }));

  return applyClassification(normalized).map((tx) => ({
    ...tx,
    status: TRANSACTION_STATUS.PRICED,
  }));
}

function normalizeOne(raw, userId, now) {
  const timestamp = normalizeDate(raw.timestamp);
  const eventType = raw.event_type || classifyEventTypeFromRaw(raw);

  const amountIn = toNumber(raw.amount_in);
  const amountOut = toNumber(raw.amount_out);
  const fee = toNumberOrZero(raw.fee);

  if (!timestamp || !eventType) return null;
  if (!raw.source_type || !raw.id) return null;

  const assetIn = toUpperOrEmpty(raw.asset_in);
  const assetOut = toUpperOrEmpty(raw.asset_out);

  const fxRate = getUsdtKrwAt(timestamp);
  const priceBundle = calculatePriceBundle({
    eventType,
    assetIn,
    assetOut,
    amountIn,
    amountOut,
    fee,
    feeAsset: raw.fee_asset,
    usdtKrw: fxRate,
  });

  const tx = {
    id: String(raw.id).trim(),
    user_id: String(raw.user_id || userId).trim(),
    created_at: String(raw.created_at || now),
    updated_at: String(raw.updated_at || now),

    source_type: String(raw.source_type || "").trim(),
    source_name: String(raw.source_name || "").trim(),
    source_file: String(raw.source_file || "").trim(),
    raw_row_index: toInteger(raw.raw_row_index),
    raw_description: String(raw.raw_description || "").trim(),

    timestamp,
    event_type: String(eventType).trim(),
    exchange: String(raw.exchange || "").trim(),
    chain: String(raw.chain || "").trim(),
    protocol: String(raw.protocol || "").trim(),
    wallet_address: String(raw.wallet_address || "").trim(),
    from_address: String(raw.from_address || "").trim(),
    to_address: String(raw.to_address || "").trim(),
    tx_hash: String(raw.tx_hash || "").trim(),

    asset_in: assetIn,
    asset_out: assetOut,
    amount_in: amountIn,
    amount_out: amountOut,
    fee,
    fee_asset: toUpperOrEmpty(raw.fee_asset),

    price_usdt: priceBundle.price_usdt,
    price_krw: priceBundle.price_krw,
    amount_in_krw: priceBundle.amount_in_krw,
    amount_out_krw: priceBundle.amount_out_krw,
    fee_krw: priceBundle.fee_krw,
    fx_rate_usdt_krw: fxRate,
    pricing_source: FX_RATE_SOURCE,

    income_category: String(raw.income_category || "").trim(),
    transfer_group_id: String(raw.transfer_group_id || "").trim(),
    matched_lot_id: String(raw.matched_lot_id || "").trim(),
    calculation_method: String(raw.calculation_method || "FIFO").trim(),
    note: String(raw.note || "").trim(),
    status: TRANSACTION_STATUS.PARSED,
  };

  if (!isValidUnifiedTransaction(tx)) return null;
  return tx;
}

export function isValidUnifiedTransaction(tx) {
  if (!tx.id || !tx.user_id || !tx.timestamp) return false;
  if (!tx.source_type || !tx.event_type) return false;
  if (!tx.asset_in || !tx.asset_out) return false;
  if (!Number.isFinite(tx.amount_in) || !Number.isFinite(tx.amount_out)) return false;
  return true;
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function toNumberOrZero(value) {
  const num = toNumber(value);
  return Number.isFinite(num) ? num : 0;
}

function toInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function toUpperOrEmpty(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}
