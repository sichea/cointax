export const FX_RATE_SOURCE = "HISTORICAL_FX_TABLE";
export const FX_RATE_FALLBACK_SOURCE = "USD_KRW_FALLBACK";
export const FX_RATE_MISSING = "MISSING";

const FX_RATE_POINTS = [
  { timestamp: "2026-03-01T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1348, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-02T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1352, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-03T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1350, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-04T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1346, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1351, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-06T00:00:00.000Z", base_currency: "USDT", quote_currency: "KRW", rate: 1355, source: FX_RATE_SOURCE },
  { timestamp: "2026-03-01T00:00:00.000Z", base_currency: "USD", quote_currency: "KRW", rate: 1347, source: FX_RATE_FALLBACK_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", base_currency: "USD", quote_currency: "KRW", rate: 1350, source: FX_RATE_FALLBACK_SOURCE },
];

const cache = new Map();

export function resolveUsdtKrwRate({ timestamp, toleranceMs = 24 * 60 * 60 * 1000 }) {
  const cacheKey = `${timestamp}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const direct = findNearestRatePoint("USDT", "KRW", timestamp, toleranceMs);
  if (direct) {
    const result = {
      rate: direct.rate,
      source: direct.source,
      timestamp: direct.timestamp,
    };
    cache.set(cacheKey, result);
    return result;
  }

  const fallback = findNearestRatePoint("USD", "KRW", timestamp, toleranceMs);
  if (fallback) {
    const result = {
      rate: fallback.rate,
      source: fallback.source,
      timestamp: fallback.timestamp,
    };
    cache.set(cacheKey, result);
    return result;
  }

  const missing = { rate: null, source: FX_RATE_MISSING, timestamp: "" };
  cache.set(cacheKey, missing);
  return missing;
}

export function buildFxRatesForExport(unifiedTransactions) {
  const byTimestamp = new Map();

  for (const tx of unifiedTransactions) {
    if (!tx.timestamp) continue;
    if (!byTimestamp.has(tx.timestamp)) {
      byTimestamp.set(tx.timestamp, {
        timestamp: tx.timestamp,
        usdt_krw: round(tx.fx_rate_usdt_krw),
        btc_krw: "",
        eth_krw: "",
        source: tx.pricing_source || tx.fx_rate_source || FX_RATE_MISSING,
      });
    }

    const row = byTimestamp.get(tx.timestamp);
    if (tx.asset_in === "BTC" && Number.isFinite(tx.price_krw)) row.btc_krw = round(tx.price_krw);
    if (tx.asset_in === "ETH" && Number.isFinite(tx.price_krw)) row.eth_krw = round(tx.price_krw);
  }

  return Array.from(byTimestamp.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function listFxRatePoints() {
  return FX_RATE_POINTS.map((row) => ({ ...row }));
}

function findNearestRatePoint(base, quote, timestamp, toleranceMs) {
  const target = new Date(timestamp).getTime();
  if (!Number.isFinite(target)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const row of FX_RATE_POINTS) {
    if (row.base_currency !== base || row.quote_currency !== quote) continue;
    const diff = Math.abs(new Date(row.timestamp).getTime() - target);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return best;
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
