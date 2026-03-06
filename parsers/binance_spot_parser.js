import { SOURCE_TYPES } from "./source_types.js";

const COLUMN_ALIASES = {
  transactionId: ["id", "trade_id", "order_id"],
  timestamp: ["Date(UTC)", "date(utc)", "date_utc", "time", "timestamp", "date", "create_time"],
  symbol: ["Pair", "pair", "symbol", "market", "trading_pair"],
  baseAsset: ["Base Asset", "base asset", "base_asset", "base"],
  quoteAsset: ["Quote Asset", "quote asset", "quote_asset", "quote"],
  side: ["Type", "side", "type", "direction"],
  price: ["Price", "price", "avg_price", "executed_price"],
  amount: ["Amount", "amount", "executed", "filled", "executed_qty", "quantity", "qty"],
  total: ["Total", "total", "value", "filled_value"],
  fee: ["Fee", "fee", "commission", "trading_fee"],
  feeAsset: ["Fee Coin", "fee coin", "fee_asset", "commission_asset"],
  txHash: ["tx hash", "tx_hash", "hash"],
  walletSource: ["from", "wallet source", "source"],
  walletDestination: ["to", "wallet destination", "destination"],
};

export function canParseBinanceSpot(headers = [], fileName = "") {
  const headerSet = new Set((headers || []).map((h) => normalizeHeader(h)));
  const hasCore = hasAny(headerSet, COLUMN_ALIASES.timestamp)
    && hasAny(headerSet, COLUMN_ALIASES.side)
    && hasAny(headerSet, COLUMN_ALIASES.price)
    && hasAny(headerSet, COLUMN_ALIASES.amount);

  const hasPair = hasAny(headerSet, COLUMN_ALIASES.symbol)
    || (hasAny(headerSet, COLUMN_ALIASES.baseAsset) && hasAny(headerSet, COLUMN_ALIASES.quoteAsset));

  if (hasCore && hasPair) return true;
  return fileName.toLowerCase().includes("binance");
}

export function parseBinanceSpotRows(rows, sourceFile) {
  const sample = rows[0] || {};
  const columns = {
    transactionId: findColumn(sample, COLUMN_ALIASES.transactionId),
    timestamp: findColumn(sample, COLUMN_ALIASES.timestamp),
    symbol: findColumn(sample, COLUMN_ALIASES.symbol),
    baseAsset: findColumn(sample, COLUMN_ALIASES.baseAsset),
    quoteAsset: findColumn(sample, COLUMN_ALIASES.quoteAsset),
    side: findColumn(sample, COLUMN_ALIASES.side),
    price: findColumn(sample, COLUMN_ALIASES.price),
    amount: findColumn(sample, COLUMN_ALIASES.amount),
    total: findColumn(sample, COLUMN_ALIASES.total),
    fee: findColumn(sample, COLUMN_ALIASES.fee),
    feeAsset: findColumn(sample, COLUMN_ALIASES.feeAsset),
    txHash: findColumn(sample, COLUMN_ALIASES.txHash),
    walletSource: findColumn(sample, COLUMN_ALIASES.walletSource),
    walletDestination: findColumn(sample, COLUMN_ALIASES.walletDestination),
  };

  return rows.map((row, index) => mapRow(row, columns, sourceFile, index)).filter(Boolean);
}

function mapRow(row, columns, sourceFile, index) {
  const side = String(row[columns.side] || "").trim().toUpperCase();
  if (!side.includes("BUY") && !side.includes("SELL")) {
    return null;
  }

  const explicitBase = columns.baseAsset ? String(row[columns.baseAsset] || "").trim().toUpperCase() : "";
  const explicitQuote = columns.quoteAsset ? String(row[columns.quoteAsset] || "").trim().toUpperCase() : "";
  const pair = columns.symbol ? String(row[columns.symbol] || "") : "";
  const [pairBase, pairQuote] = extractPair(pair);

  const baseAsset = explicitBase || pairBase;
  const quoteAsset = explicitQuote || pairQuote;
  if (!baseAsset || !quoteAsset) return null;

  const externalId = columns.transactionId ? String(row[columns.transactionId] || "").trim() : "";
  const txHash = columns.txHash ? String(row[columns.txHash] || "").trim() : "";
  const walletOrSource = columns.walletSource ? String(row[columns.walletSource] || "").trim() : "Binance";
  const walletOrDestination = columns.walletDestination ? String(row[columns.walletDestination] || "").trim() : "Binance";

  return {
    id: externalId || `Binance-${sourceFile}-${index + 1}`,
    source_type: SOURCE_TYPES.EXCHANGE_CSV,
    source_name: "Binance Spot Trade History",
    exchange: "Binance",
    chain: "CEX",
    protocol: "BINANCE_SPOT",
    wallet_address: "",
    from_address: "",
    to_address: "",
    wallet_or_source: walletOrSource || "Binance",
    wallet_or_destination: walletOrDestination || "Binance",
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    side,
    timestamp: columns.timestamp ? row[columns.timestamp] : "",
    price: columns.price ? row[columns.price] : "",
    amount: columns.amount ? row[columns.amount] : "",
    total: columns.total ? row[columns.total] : "",
    fee: columns.fee ? row[columns.fee] : "0",
    fee_asset: columns.feeAsset ? row[columns.feeAsset] : "",
    tx_hash: txHash,
    source_file: sourceFile,
    note: "Binance Spot Trade History CSV",
  };
}

function findColumn(sampleRow, aliases) {
  const keys = Object.keys(sampleRow || {});
  const aliasSet = new Set((aliases || []).map((alias) => normalizeHeader(alias)));
  for (const key of keys) {
    if (aliasSet.has(normalizeHeader(key))) {
      return key;
    }
  }
  return "";
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

function extractPair(symbol) {
  const normalized = String(symbol || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "/");

  if (normalized.includes("/")) {
    const [base, quote] = normalized.split("/");
    return [base || "", quote || ""];
  }

  const knownQuotes = ["USDT", "USDC", "BUSD", "FDUSD", "USD", "KRW", "BTC", "ETH"];
  for (const quote of knownQuotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return [normalized.slice(0, -quote.length), quote];
    }
  }

  return ["", ""];
}
