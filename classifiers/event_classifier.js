export const EVENT_TYPES = Object.freeze({
  TRADE_BUY: "TRADE_BUY",
  TRADE_SELL: "TRADE_SELL",
  DEPOSIT: "DEPOSIT",
  WITHDRAWAL: "WITHDRAWAL",
  INTERNAL_TRANSFER: "INTERNAL_TRANSFER",
  AIRDROP: "AIRDROP",
  STAKING_REWARD: "STAKING_REWARD",
  DEFI_REWARD: "DEFI_REWARD",
  SWAP: "SWAP",
  BRIDGE: "BRIDGE",
  LIQUIDITY_ADD: "LIQUIDITY_ADD",
  LIQUIDITY_REMOVE: "LIQUIDITY_REMOVE",
  NFT_MINT: "NFT_MINT",
  NFT_SALE: "NFT_SALE",
  UNKNOWN: "UNKNOWN",
});

export const INCOME_CATEGORIES = Object.freeze({
  CAPITAL_GAIN: "CAPITAL_GAIN",
  AIRDROP_INCOME: "AIRDROP_INCOME",
  STAKING_INCOME: "STAKING_INCOME",
  DEFI_INCOME: "DEFI_INCOME",
  OTHER: "OTHER",
  NONE: "NONE",
});

export const TRANSACTION_STATUS = Object.freeze({
  PARSED: "PARSED",
  NORMALIZED: "NORMALIZED",
  CLASSIFIED: "CLASSIFIED",
  MATCHED: "MATCHED",
  PRICED: "PRICED",
  REPORTED: "REPORTED",
  ERROR: "ERROR",
});

export function classifyEventTypeFromRaw(raw = {}) {
  const side = String(raw.side || "").trim().toUpperCase();
  if (side.includes("BUY")) return EVENT_TYPES.TRADE_BUY;
  if (side.includes("SELL")) return EVENT_TYPES.TRADE_SELL;
  return EVENT_TYPES.UNKNOWN;
}

export function classifyIncomeCategory(eventType) {
  if (eventType === EVENT_TYPES.TRADE_BUY || eventType === EVENT_TYPES.TRADE_SELL) {
    return INCOME_CATEGORIES.CAPITAL_GAIN;
  }
  if (eventType === EVENT_TYPES.AIRDROP) return INCOME_CATEGORIES.AIRDROP_INCOME;
  if (eventType === EVENT_TYPES.STAKING_REWARD) return INCOME_CATEGORIES.STAKING_INCOME;
  if (eventType === EVENT_TYPES.DEFI_REWARD) return INCOME_CATEGORIES.DEFI_INCOME;
  return INCOME_CATEGORIES.NONE;
}

export function applyClassification(unifiedTransactions) {
  return unifiedTransactions.map((tx) => ({
    ...tx,
    income_category: tx.income_category || classifyIncomeCategory(tx.event_type),
    status: TRANSACTION_STATUS.CLASSIFIED,
  }));
}

export function isTradeEventType(eventType) {
  return eventType === EVENT_TYPES.TRADE_BUY || eventType === EVENT_TYPES.TRADE_SELL;
}
