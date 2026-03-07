const DIRECT_PRICE_SOURCE = "HISTORICAL_PRICE_TABLE";
const DERIVED_SWAP_SOURCE = "DERIVED_SWAP_RATIO";
const STABLE_PRICE_SOURCE = "USD_STABLE_PARITY";
export const PRICING_SOURCE_MISSING = "MISSING";

const ASSET_PRICE_POINTS = [
  { timestamp: "2026-03-01T00:00:00.000Z", asset: "ETH", price_usdt: 3200, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-02T00:00:00.000Z", asset: "ETH", price_usdt: 3225, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-03T00:00:00.000Z", asset: "ETH", price_usdt: 3185, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-04T00:00:00.000Z", asset: "ETH", price_usdt: 3160, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "ETH", price_usdt: 3210, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-06T00:00:00.000Z", asset: "ETH", price_usdt: 3240, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-01T00:00:00.000Z", asset: "BTC", price_usdt: 64000, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "SOL", price_usdt: 145, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "ARB", price_usdt: 1.85, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-06T00:00:00.000Z", asset: "LP-CRV", price_usdt: 12.5, source: DIRECT_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "USDC", price_usdt: 1, source: STABLE_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "USDT", price_usdt: 1, source: STABLE_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "FDUSD", price_usdt: 1, source: STABLE_PRICE_SOURCE },
  { timestamp: "2026-03-05T00:00:00.000Z", asset: "DAI", price_usdt: 1, source: STABLE_PRICE_SOURCE },
];

const STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);
const cache = new Map();

export function resolveAssetPriceUsdt({ asset, timestamp, tx = null, toleranceMs = 24 * 60 * 60 * 1000 }) {
  const symbol = String(asset || "").trim().toUpperCase();
  if (!symbol) return missingPrice(symbol);

  const cacheKey = `${symbol}|${timestamp}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let resolved = null;

  if (STABLE_ASSETS.has(symbol)) {
    resolved = {
      price_usdt: 1,
      pricing_source: STABLE_PRICE_SOURCE,
      price_timestamp: timestamp,
    };
  } else if (tx && tx.event_type === "SWAP") {
    resolved = deriveSwapPrice(symbol, tx);
  }

  if (!resolved) {
    const nearest = findNearestPricePoint(symbol, timestamp, toleranceMs);
    if (nearest) {
      resolved = {
        price_usdt: nearest.price_usdt,
        pricing_source: nearest.source,
        price_timestamp: nearest.timestamp,
      };
    }
  }

  if (!resolved) resolved = missingPrice(symbol);
  cache.set(cacheKey, resolved);
  return resolved;
}

export function listAssetPricePoints() {
  return ASSET_PRICE_POINTS.map((row) => ({ ...row }));
}

function deriveSwapPrice(symbol, tx) {
  const assetIn = String(tx.asset_in || "").toUpperCase();
  const assetOut = String(tx.asset_out || "").toUpperCase();
  const amountIn = Number(tx.amount_in);
  const amountOut = Number(tx.amount_out);

  if (symbol === assetIn && amountIn > 0 && amountOut > 0 && STABLE_ASSETS.has(assetOut)) {
    return {
      price_usdt: amountOut / amountIn,
      pricing_source: DERIVED_SWAP_SOURCE,
      price_timestamp: tx.timestamp,
    };
  }

  if (symbol === assetOut && amountIn > 0 && amountOut > 0 && STABLE_ASSETS.has(assetIn)) {
    return {
      price_usdt: amountIn / amountOut,
      pricing_source: DERIVED_SWAP_SOURCE,
      price_timestamp: tx.timestamp,
    };
  }

  return null;
}

function findNearestPricePoint(asset, timestamp, toleranceMs) {
  const target = new Date(timestamp).getTime();
  if (!Number.isFinite(target)) return null;

  let best = null;
  let bestDiff = Infinity;
  for (const row of ASSET_PRICE_POINTS) {
    if (row.asset !== asset) continue;
    const diff = Math.abs(new Date(row.timestamp).getTime() - target);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return best;
}

function missingPrice(asset) {
  return {
    price_usdt: null,
    pricing_source: PRICING_SOURCE_MISSING,
    price_timestamp: "",
    asset,
  };
}
