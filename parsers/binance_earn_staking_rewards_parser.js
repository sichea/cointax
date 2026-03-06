import { EVENT_TYPES, INCOME_CATEGORIES, TRANSACTION_STATUS } from "../classifiers/event_classifier.js";
import { SOURCE_TYPES } from "./source_types.js";

const COLUMN_ALIASES = {
  time: ["time", "date", "datetime"],
  asset: ["asset", "coin", "currency"],
  amount: ["amount", "reward amount", "quantity"],
  product: ["product", "program", "pool", "protocol"],
  rewardType: ["reward type", "type", "income type"],
  status: ["status"],
  remark: ["remark", "note", "description"],
};

export function parseBinanceEarnStakingRewardsRows(rows, sourceFile, { userId = "demo-user" } = {}) {
  const sample = rows[0] || {};
  const columns = resolveColumns(sample);

  return rows
    .map((row, index) => normalize_binance_earn_staking_rewards_row(row, sourceFile, index, columns, userId))
    .filter(Boolean);
}

export function normalize_binance_earn_staking_rewards_row(row, fileName, index, columns, userId = "demo-user") {
  const timestamp = normalizeTimestamp(getCell(row, columns.time));
  const asset = toUpper(getCell(row, columns.asset));
  const amount = toNumber(getCell(row, columns.amount));
  const product = String(getCell(row, columns.product) || "").trim();
  const rewardType = String(getCell(row, columns.rewardType) || "").trim();
  const rowStatus = String(getCell(row, columns.status) || "").trim();
  const remark = String(getCell(row, columns.remark) || "").trim();

  if (!timestamp || !asset || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const eventType = classifyEarnEventType(product, rewardType, remark);
  const incomeCategory =
    eventType === EVENT_TYPES.DEFI_REWARD ? INCOME_CATEGORIES.DEFI_INCOME : INCOME_CATEGORIES.STAKING_INCOME;

  const rawRowIndex = Number.isInteger(row.__raw_row_index) ? row.__raw_row_index : index + 1;
  const now = new Date().toISOString();

  return {
    id: `binance-earn-${fileName}-${rawRowIndex}`,
    user_id: userId,
    created_at: now,
    updated_at: now,

    source_type: SOURCE_TYPES.EXCHANGE_CSV,
    source_name: "Binance Earn/Staking History",
    source_file: fileName,
    raw_row_index: rawRowIndex,
    raw_description: JSON.stringify(stripMeta(row)),

    timestamp,
    event_type: eventType,
    income_category: incomeCategory,
    exchange: "Binance",
    chain: null,
    protocol: product || "Binance Earn",
    wallet_address: null,
    from_address: null,
    to_address: null,
    tx_hash: null,

    asset_in: asset,
    asset_out: null,
    amount_in: amount,
    amount_out: null,
    fee: null,
    fee_asset: null,

    price_usdt: null,
    price_krw: null,
    amount_in_krw: null,
    amount_out_krw: null,
    fee_krw: null,
    fx_rate_usdt_krw: null,
    pricing_source: null,

    transfer_group_id: null,
    matched_lot_id: null,
    calculation_method: null,
    note: [product, rewardType, rowStatus, remark].filter(Boolean).join(" | ") || null,
    status: TRANSACTION_STATUS.NORMALIZED,
  };
}

function classifyEarnEventType(product, rewardType, remark) {
  const text = `${product} ${rewardType} ${remark}`.toLowerCase();
  if (/(launchpool|farming|defi|liquidity|yield)/.test(text)) return EVENT_TYPES.DEFI_REWARD;
  return EVENT_TYPES.STAKING_REWARD;
}

function resolveColumns(sample) {
  return {
    time: findColumn(sample, COLUMN_ALIASES.time),
    asset: findColumn(sample, COLUMN_ALIASES.asset),
    amount: findColumn(sample, COLUMN_ALIASES.amount),
    product: findColumn(sample, COLUMN_ALIASES.product),
    rewardType: findColumn(sample, COLUMN_ALIASES.rewardType),
    status: findColumn(sample, COLUMN_ALIASES.status),
    remark: findColumn(sample, COLUMN_ALIASES.remark),
  };
}

function stripMeta(row) {
  const out = { ...row };
  delete out.__raw_row_index;
  return out;
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
