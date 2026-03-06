export const USD_STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);

export function convertQuoteValueToUsdt(value, quoteAsset, usdtKrw) {
  if (!Number.isFinite(value)) return NaN;
  const quote = String(quoteAsset || "").toUpperCase();
  if (USD_STABLE_ASSETS.has(quote)) return value;
  if (quote === "KRW") return value / usdtKrw;
  return NaN;
}

export function calculatePriceBundle({ eventType, assetIn, assetOut, amountIn, amountOut, fee, feeAsset, usdtKrw }) {
  const inAmount = Number(amountIn);
  const outAmount = Number(amountOut);

  let priceUsdt = NaN;

  if (Number.isFinite(inAmount) && inAmount > 0 && Number.isFinite(outAmount) && outAmount > 0) {
    if (eventType === "TRADE_BUY") {
      const outUsdt = convertQuoteValueToUsdt(outAmount, assetOut, usdtKrw);
      if (Number.isFinite(outUsdt)) priceUsdt = outUsdt / inAmount;
    }
    if (eventType === "TRADE_SELL") {
      const inUsdt = convertQuoteValueToUsdt(inAmount, assetIn, usdtKrw);
      if (Number.isFinite(inUsdt)) priceUsdt = inUsdt / outAmount;
    }
  }

  const amountInKrw = Number.isFinite(inAmount) ? convertAssetAmountToKrw(inAmount, assetIn, priceUsdt, usdtKrw) : NaN;
  const amountOutKrw = Number.isFinite(outAmount) ? convertAssetAmountToKrw(outAmount, assetOut, priceUsdt, usdtKrw) : NaN;
  const feeKrw = convertFeeToKrw({ fee, feeAsset, assetIn, assetOut, priceUsdt, usdtKrw });

  return {
    price_usdt: Number.isFinite(priceUsdt) ? priceUsdt : NaN,
    price_krw: Number.isFinite(priceUsdt) ? priceUsdt * usdtKrw : NaN,
    amount_in_krw: amountInKrw,
    amount_out_krw: amountOutKrw,
    fee_krw: feeKrw,
  };
}

function convertAssetAmountToKrw(amount, asset, priceUsdt, usdtKrw) {
  const symbol = String(asset || "").toUpperCase();
  if (symbol === "KRW") return amount;
  if (USD_STABLE_ASSETS.has(symbol)) return amount * usdtKrw;
  if (Number.isFinite(priceUsdt)) return amount * priceUsdt * usdtKrw;
  return NaN;
}

function convertFeeToKrw({ fee, feeAsset, assetIn, assetOut, priceUsdt, usdtKrw }) {
  const feeNum = Number(fee);
  if (!Number.isFinite(feeNum) || feeNum === 0) return 0;

  const feeCoin = String(feeAsset || "").toUpperCase();
  if (feeCoin === "KRW") return feeNum;
  if (USD_STABLE_ASSETS.has(feeCoin)) return feeNum * usdtKrw;
  if (feeCoin === String(assetIn || "").toUpperCase() || feeCoin === String(assetOut || "").toUpperCase()) {
    if (Number.isFinite(priceUsdt)) return feeNum * priceUsdt * usdtKrw;
  }
  return NaN;
}
