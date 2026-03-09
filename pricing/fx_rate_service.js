export const FX_RATE_SOURCE = "FRANKFURTER_USD_KRW_NEAREST";
export const FX_RATE_FALLBACK_SOURCE = "USD_KRW_FALLBACK";
export const FX_RATE_MISSING = "MISSING";

const FRANKFURTER_ENDPOINT = "https://api.frankfurter.dev/v1";
const cache = new Map();

export async function resolveUsdtKrwRate({ timestamp, dayWindow = 7 }) {
  const targetMs = Date.parse(timestamp);
  if (!Number.isFinite(targetMs)) return missingRate();

  const dayKey = new Date(targetMs).toISOString().slice(0, 10);
  if (cache.has(dayKey)) return cache.get(dayKey);

  const pending = resolveUsdtKrwRateUncached(targetMs, dayWindow).catch(() => missingRate());
  cache.set(dayKey, pending);
  return pending;
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
  return [];
}

async function resolveUsdtKrwRateUncached(targetMs, dayWindow) {
  if (typeof fetch !== "function") return missingRate();

  const startDate = formatDate(targetMs - dayWindow * 24 * 60 * 60 * 1000);
  const endDate = formatDate(targetMs + dayWindow * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    base: "USD",
    symbols: "KRW",
  });

  const response = await fetch(`${FRANKFURTER_ENDPOINT}/${startDate}..${endDate}?${query.toString()}`);
  if (!response.ok) return missingRate();

  const payload = await response.json();
  const rates = payload?.rates;
  if (!rates || typeof rates !== "object") return missingRate();

  let best = null;
  let bestDiff = Infinity;
  for (const [date, values] of Object.entries(rates)) {
    const rate = Number(values?.KRW);
    const pointMs = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(rate) || !Number.isFinite(pointMs)) continue;
    const diff = Math.abs(pointMs - targetMs);
    if (diff < bestDiff) {
      best = { rate, timestamp: `${date}T00:00:00.000Z` };
      bestDiff = diff;
    }
  }

  if (!best) return missingRate();

  return {
    rate: best.rate,
    source: FX_RATE_SOURCE,
    timestamp: best.timestamp,
  };
}

function formatDate(timestampMs) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function missingRate() {
  return { rate: null, source: FX_RATE_MISSING, timestamp: "" };
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
