export const USD_STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);

export function convertQuoteValueToUsdt(value, quoteAsset, usdtKrw) {
  if (!Number.isFinite(value)) return NaN;
  const quote = String(quoteAsset || "").toUpperCase();

  if (USD_STABLE_ASSETS.has(quote)) return value;
  if (quote === "KRW") return value / usdtKrw;
  return NaN;
}

export function convertFeeToUsdt({ fee, feeAsset, baseAsset, quoteAsset, priceUsdt, usdtKrw }) {
  if (!Number.isFinite(fee) || fee === 0) return 0;

  const feeCoin = String(feeAsset || "").toUpperCase();
  const base = String(baseAsset || "").toUpperCase();
  const quote = String(quoteAsset || "").toUpperCase();

  if (feeCoin === quote) {
    return convertQuoteValueToUsdt(fee, quote, usdtKrw);
  }
  if (feeCoin === base && Number.isFinite(priceUsdt)) {
    return fee * priceUsdt;
  }
  if (USD_STABLE_ASSETS.has(feeCoin)) {
    return fee;
  }
  if (feeCoin === "KRW") {
    return fee / usdtKrw;
  }
  return 0;
}
