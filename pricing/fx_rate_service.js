export const DEFAULT_USDT_KRW = 1300;
export const FX_RATE_SOURCE = "MVP_FIXED_USDT_KRW";

export function getUsdtKrwAt() {
  return DEFAULT_USDT_KRW;
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
        source: tx.pricing_source || FX_RATE_SOURCE,
      });
    }

    const row = byTimestamp.get(tx.timestamp);
    if (tx.asset_in === "BTC" && Number.isFinite(tx.price_krw)) {
      row.btc_krw = round(tx.price_krw);
    }
    if (tx.asset_in === "ETH" && Number.isFinite(tx.price_krw)) {
      row.eth_krw = round(tx.price_krw);
    }
  }

  return Array.from(byTimestamp.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
