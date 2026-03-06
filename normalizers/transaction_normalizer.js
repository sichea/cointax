import { classifyEvent } from "../classifiers/event_classifier.js";
import { convertFeeToUsdt, convertQuoteValueToUsdt } from "../pricing/asset_price_service.js";
import { getUsdtKrwAt } from "../pricing/fx_rate_service.js";

export function normalizeTransactions(records) {
  return records.map((record) => normalizeTransaction(record)).filter(Boolean);
}

export function normalizeTransaction(record) {
  const eventType = classifyEvent(record);
  const timestamp = normalizeDate(record.timestamp);
  const baseAsset = toUpperOrEmpty(record.base_asset);
  const quoteAsset = toUpperOrEmpty(record.quote_asset);
  const amount = toNumber(record.amount);
  const rawPrice = toNumber(record.price);
  const rawTotal = toNumber(record.total);
  const fee = toNumberOrZero(record.fee);
  const feeAsset = toUpperOrEmpty(record.fee_asset);

  const usdtKrw = getUsdtKrwAt(timestamp);
  const priceUsdt = convertQuoteValueToUsdt(rawPrice, quoteAsset, usdtKrw);
  const totalUsdtRaw = convertQuoteValueToUsdt(rawTotal, quoteAsset, usdtKrw);
  const totalUsdt = Number.isFinite(totalUsdtRaw) ? totalUsdtRaw : priceUsdt * amount;

  const feeUsdt = convertFeeToUsdt({
    fee,
    feeAsset,
    baseAsset,
    quoteAsset,
    priceUsdt,
    usdtKrw,
  });

  const normalized = {
    id: String(record.id || "").trim(),
    source_type: record.source_type,
    source_name: String(record.source_name || "").trim(),
    event_type: eventType,
    transaction_type: eventType,
    timestamp,
    exchange: String(record.exchange || "").trim(),
    chain: String(record.chain || "").trim(),
    protocol: String(record.protocol || "").trim(),
    wallet_address: String(record.wallet_address || "").trim(),
    from_address: String(record.from_address || "").trim(),
    to_address: String(record.to_address || "").trim(),
    wallet_or_source: String(record.wallet_or_source || "").trim(),
    wallet_or_destination: String(record.wallet_or_destination || "").trim(),
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    amount,
    price_usdt: priceUsdt,
    price_krw: Number.isFinite(priceUsdt) ? priceUsdt * usdtKrw : NaN,
    total_usdt: totalUsdt,
    total_krw: Number.isFinite(totalUsdt) ? totalUsdt * usdtKrw : NaN,
    fee,
    fee_asset: feeAsset,
    fee_usdt: Number.isFinite(feeUsdt) ? feeUsdt : 0,
    tx_hash: String(record.tx_hash || "").trim(),
    source_file: String(record.source_file || "").trim(),
    note: String(record.note || "").trim(),
  };

  if (!isValidNormalizedEvent(normalized)) {
    return null;
  }
  return normalized;
}

export function isValidNormalizedEvent(event) {
  if (!event.id || !event.source_type || !event.timestamp) return false;
  if (!event.base_asset || !event.quote_asset) return false;
  if (!Number.isFinite(event.amount) || event.amount <= 0) return false;
  if (!Number.isFinite(event.price_usdt) || !Number.isFinite(event.total_usdt)) return false;
  return true;
}

export function toNumber(value) {
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

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function toUpperOrEmpty(value) {
  return String(value || "").trim().toUpperCase();
}
