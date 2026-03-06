const FILE_TYPES = Object.freeze({
  SPOT_TRADE_HISTORY: "SPOT_TRADE_HISTORY",
  TRANSACTION_HISTORY: "TRANSACTION_HISTORY",
  DISTRIBUTION_HISTORY: "DISTRIBUTION_HISTORY",
  EARN_STAKING_REWARDS_HISTORY: "EARN_STAKING_REWARDS_HISTORY",
  UNKNOWN: "UNKNOWN",
});

const SPOT_HEADERS = [
  "date(utc)",
  "pair",
  "base asset",
  "quote asset",
  "type",
  "price",
  "amount",
  "total",
  "fee",
  "fee coin",
];

export { FILE_TYPES };

export function detect_binance_file_type(headers = [], previewRows = []) {
  const normalized = new Set((headers || []).map(normalizeHeader));
  const previewText = previewRows
    .flatMap((row) => row || [])
    .map((v) => String(v || "").toLowerCase())
    .join(" ");

  if (SPOT_HEADERS.every((h) => normalized.has(h))) {
    return FILE_TYPES.SPOT_TRADE_HISTORY;
  }

  const hasTxCore = hasAny(normalized, ["time", "date", "datetime"])
    && hasAny(normalized, ["operation", "type", "transaction type"])
    && hasAny(normalized, ["coin", "asset", "currency"])
    && hasAny(normalized, ["change", "amount", "delta"]);
  if (hasTxCore) {
    return FILE_TYPES.TRANSACTION_HISTORY;
  }

  const hasDistributionCore = hasAny(normalized, ["time", "date", "datetime"])
    && hasAny(normalized, ["asset", "coin", "currency"])
    && hasAny(normalized, ["amount", "quantity"])
    && hasAny(normalized, ["distribution type", "distribution", "remark", "description"]);
  if (hasDistributionCore && /(distribution|airdrop|launchpool|promo|promotion)/.test(previewText)) {
    return FILE_TYPES.DISTRIBUTION_HISTORY;
  }

  const hasEarnCore = hasAny(normalized, ["time", "date", "datetime"])
    && hasAny(normalized, ["asset", "coin"])
    && hasAny(normalized, ["amount", "reward amount"])
    && (hasAny(normalized, ["product", "reward type", "status"]) || /(staking|earn|reward|savings|launchpool)/.test(previewText));
  if (hasEarnCore) {
    return FILE_TYPES.EARN_STAKING_REWARDS_HISTORY;
  }

  if (hasDistributionCore) {
    return FILE_TYPES.DISTRIBUTION_HISTORY;
  }

  return FILE_TYPES.UNKNOWN;
}

export function detect_binance_header_row(csvRows = []) {
  for (let i = 0; i < csvRows.length; i += 1) {
    const candidateHeaders = csvRows[i] || [];
    const previewRows = csvRows.slice(i + 1, i + 6);
    const fileType = detect_binance_file_type(candidateHeaders, previewRows);
    if (fileType !== FILE_TYPES.UNKNOWN) {
      return { headerRowIndex: i, fileType };
    }
  }

  return { headerRowIndex: 0, fileType: FILE_TYPES.UNKNOWN };
}

function hasAny(headerSet, aliases) {
  return (aliases || []).some((alias) => headerSet.has(normalizeHeader(alias)));
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
