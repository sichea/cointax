export const DEFAULT_USDT_KRW = 1300;
export const FX_SOURCE = "MVP_FIXED_USDT_KRW";

export function getUsdtKrwAt() {
  return DEFAULT_USDT_KRW;
}

export function buildFxRates(events) {
  const byTimestamp = new Map();

  for (const event of events) {
    const timestamp = event.timestamp;
    if (!timestamp) continue;

    if (!byTimestamp.has(timestamp)) {
      byTimestamp.set(timestamp, {
        timestamp,
        usdt_krw: round(getUsdtKrwAt(timestamp)),
        btc_krw: "",
        eth_krw: "",
        source: FX_SOURCE,
      });
    }

    const row = byTimestamp.get(timestamp);
    if (event.base_asset === "BTC" && Number.isFinite(event.price_krw)) {
      row.btc_krw = round(event.price_krw);
    }
    if (event.base_asset === "ETH" && Number.isFinite(event.price_krw)) {
      row.eth_krw = round(event.price_krw);
    }
  }

  return Array.from(byTimestamp.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
