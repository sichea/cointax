import { resolveUsdtKrwRate, FX_RATE_MISSING } from "./fx_rate_service.js";
import { PRICING_SOURCE_MISSING, resolveAssetPriceUsdt } from "./price_service.js";

const STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);

export async function resolveTransactionPricing(tx) {
  const fx = await resolveUsdtKrwRate({ timestamp: tx.timestamp });
  const assetForPrimaryPrice = selectPrimaryAsset(tx);
  const price = await resolveAssetPriceUsdt({ asset: assetForPrimaryPrice, timestamp: tx.timestamp, tx });

  const priceKrw = Number.isFinite(price.price_usdt) && Number.isFinite(fx.rate)
    ? price.price_usdt * fx.rate
    : null;

  const amountInKrw = await computeAmountKrw(tx.amount_in, tx.asset_in, tx, fx.rate);
  const amountOutKrw = await computeAmountKrw(tx.amount_out, tx.asset_out, tx, fx.rate);
  const feeKrw = await computeAmountKrw(tx.fee, tx.fee_asset, tx, fx.rate);
  const hasMissingValuation = hasMissingComponent(tx.amount_in, tx.asset_in, amountInKrw)
    || hasMissingComponent(tx.amount_out, tx.asset_out, amountOutKrw)
    || hasMissingComponent(tx.fee, tx.fee_asset, feeKrw);

  return {
    price_usdt: price.price_usdt,
    price_krw: priceKrw,
    amount_in_krw: amountInKrw,
    amount_out_krw: amountOutKrw,
    fee_krw: feeKrw,
    fx_rate_usdt_krw: fx.rate,
    pricing_source: choosePricingSource(price.pricing_source, fx.source, hasMissingValuation),
    fx_rate_source: fx.source,
  };
}

function selectPrimaryAsset(tx) {
  if (tx.event_type === "TRADE_BUY") return tx.asset_in;
  if (tx.event_type === "TRADE_SELL") return tx.asset_out;
  if (tx.event_type === "SWAP") return tx.asset_in || tx.asset_out;
  if (tx.income_category === "AIRDROP_INCOME" || tx.income_category === "STAKING_INCOME" || tx.income_category === "DEFI_INCOME") {
    return tx.asset_in;
  }
  return tx.asset_in || tx.asset_out;
}

async function computeAmountKrw(amount, asset, tx, fxRate) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return null;
  const symbol = String(asset || "").toUpperCase();
  if (!symbol) return null;
  if (symbol === "KRW") return numericAmount;
  if (!Number.isFinite(fxRate)) return null;
  if (STABLE_ASSETS.has(symbol)) return numericAmount * fxRate;

  const resolved = await resolveAssetPriceUsdt({ asset: symbol, timestamp: tx.timestamp, tx });
  if (!Number.isFinite(resolved.price_usdt)) return null;
  return numericAmount * resolved.price_usdt * fxRate;
}

function choosePricingSource(priceSource, fxSource, hasMissingValuation) {
  if (priceSource === PRICING_SOURCE_MISSING || fxSource === FX_RATE_MISSING || hasMissingValuation) {
    return PRICING_SOURCE_MISSING;
  }
  return [priceSource, fxSource].filter(Boolean).join("+");
}

function hasMissingComponent(amount, asset, amountKrw) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) return false;
  if (!String(asset || "").trim()) return false;
  return !Number.isFinite(amountKrw);
}
