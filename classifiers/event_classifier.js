export const EVENT_TYPES = Object.freeze({
  TRADE_BUY: "TRADE_BUY",
  TRADE_SELL: "TRADE_SELL",
  AIRDROP: "AIRDROP",
  STAKING_REWARD: "STAKING_REWARD",
  DEFI_REWARD: "DEFI_REWARD",
  TRANSFER_IN: "TRANSFER_IN",
  TRANSFER_OUT: "TRANSFER_OUT",
  INTERNAL_TRANSFER: "INTERNAL_TRANSFER",
  DEPOSIT: "DEPOSIT",
  WITHDRAWAL: "WITHDRAWAL",
  UNKNOWN: "UNKNOWN",
});

export function classifyEvent(record = {}) {
  const side = String(record.side || "").trim().toUpperCase();
  if (side.includes("BUY")) return EVENT_TYPES.TRADE_BUY;
  if (side.includes("SELL")) return EVENT_TYPES.TRADE_SELL;
  return EVENT_TYPES.UNKNOWN;
}

export function isTradeEvent(eventType) {
  return eventType === EVENT_TYPES.TRADE_BUY || eventType === EVENT_TYPES.TRADE_SELL;
}
