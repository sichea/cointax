const BINANCE_KLINES_ENDPOINT = "https://api.binance.com/api/v3/klines";

const DIRECT_PRICE_SOURCE = "TRADE_EXECUTION_PRICE";
const CANDLE_PRICE_SOURCE_PREFIX = "BINANCE_KLINES";
const DERIVED_SWAP_SOURCE = "DERIVED_SWAP_RATIO";
const STABLE_PRICE_SOURCE = "USD_STABLE_PARITY";
export const PRICING_SOURCE_MISSING = "MISSING";

const SUPPORTED_BINANCE_SYMBOLS = new Map([
  ["BTC", "BTCUSDT"],
  ["ETH", "ETHUSDT"],
  ["ARB", "ARBUSDT"],
]);

const STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);
const candleSearchPlans = [
  { interval: "1m", stepMs: 60 * 1000, searchWindowMs: 30 * 60 * 1000 },
  { interval: "1h", stepMs: 60 * 60 * 1000, searchWindowMs: 36 * 60 * 60 * 1000 },
  { interval: "1d", stepMs: 24 * 60 * 60 * 1000, searchWindowMs: 30 * 24 * 60 * 60 * 1000 },
];
const cache = new Map();

export async function resolveAssetPriceUsdt({ asset, timestamp, tx = null }) {
  const symbol = String(asset || "").trim().toUpperCase();
  if (!symbol) return missingPrice(symbol);

  const targetMs = Date.parse(timestamp);
  if (!Number.isFinite(targetMs)) return missingPrice(symbol);

  const cacheKey = `${symbol}|${targetMs}|${buildTxPriceCacheKey(tx)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const pending = resolveAssetPriceUsdtUncached({ symbol, timestamp, targetMs, tx }).catch(() => missingPrice(symbol));
  cache.set(cacheKey, pending);
  return pending;
}

export function listAssetPricePoints() {
  return [];
}

async function resolveAssetPriceUsdtUncached({ symbol, timestamp, targetMs, tx }) {
  if (STABLE_ASSETS.has(symbol)) {
    return {
      price_usdt: 1,
      pricing_source: STABLE_PRICE_SOURCE,
      price_timestamp: timestamp,
    };
  }

  const directTradePrice = resolveDirectTradePrice(symbol, tx);
  if (directTradePrice) return directTradePrice;

  if (tx && tx.event_type === "SWAP") {
    const swapPrice = deriveSwapPrice(symbol, tx);
    if (swapPrice) return swapPrice;
  }

  const marketSymbol = SUPPORTED_BINANCE_SYMBOLS.get(symbol);
  if (!marketSymbol) return missingPrice(symbol);

  for (const plan of candleSearchPlans) {
    const nearest = await fetchNearestCandlePrice(marketSymbol, targetMs, plan);
    if (nearest) {
      return {
        price_usdt: nearest.price_usdt,
        pricing_source: `${CANDLE_PRICE_SOURCE_PREFIX}_${plan.interval.toUpperCase()}_NEAREST`,
        price_timestamp: nearest.timestamp,
      };
    }
  }

  return missingPrice(symbol);
}

function resolveDirectTradePrice(symbol, tx) {
  if (!tx || !Number.isFinite(Number(tx.price_usdt))) return null;

  const assetIn = String(tx.asset_in || "").trim().toUpperCase();
  const assetOut = String(tx.asset_out || "").trim().toUpperCase();
  const rawPrice = Number(tx.price_usdt);

  if (tx.event_type === "TRADE_BUY" && symbol === assetIn && STABLE_ASSETS.has(assetOut)) {
    return {
      price_usdt: rawPrice,
      pricing_source: DIRECT_PRICE_SOURCE,
      price_timestamp: tx.timestamp,
    };
  }

  if (tx.event_type === "TRADE_SELL" && symbol === assetOut && STABLE_ASSETS.has(assetIn)) {
    return {
      price_usdt: rawPrice,
      pricing_source: DIRECT_PRICE_SOURCE,
      price_timestamp: tx.timestamp,
    };
  }

  return null;
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

async function fetchNearestCandlePrice(symbol, targetMs, { interval, stepMs, searchWindowMs }) {
  if (typeof fetch !== "function") return null;

  const startTime = targetMs - searchWindowMs;
  const endTime = targetMs + searchWindowMs;
  const limit = Math.min(1000, Math.floor((endTime - startTime) / stepMs) + 1);
  const query = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startTime),
    endTime: String(endTime),
    limit: String(limit),
  });

  const response = await fetch(`${BINANCE_KLINES_ENDPOINT}?${query.toString()}`);
  if (!response.ok) return null;

  const candles = await response.json();
  if (!Array.isArray(candles) || !candles.length) return null;

  let best = null;
  let bestDiff = Infinity;
  for (const candle of candles) {
    if (!Array.isArray(candle) || candle.length < 5) continue;
    const openTime = Number(candle[0]);
    const closePrice = Number(candle[4]);
    if (!Number.isFinite(openTime) || !Number.isFinite(closePrice)) continue;
    const diff = Math.abs(openTime - targetMs);
    if (diff < bestDiff) {
      best = {
        price_usdt: closePrice,
        timestamp: new Date(openTime).toISOString(),
      };
      bestDiff = diff;
    }
  }

  return best;
}

function buildTxPriceCacheKey(tx) {
  if (!tx) return "";
  const pieces = [
    tx.event_type,
    tx.asset_in,
    tx.asset_out,
    tx.amount_in,
    tx.amount_out,
    tx.price_usdt,
  ];
  return pieces.map((value) => String(value ?? "")).join("|");
}

function missingPrice(asset) {
  return {
    price_usdt: null,
    pricing_source: PRICING_SOURCE_MISSING,
    price_timestamp: "",
    asset,
  };
}
