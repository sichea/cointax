import { EVENT_TYPES, INCOME_CATEGORIES, TRANSACTION_STATUS } from "../../classifiers/event_classifier.js";

export function classifyOnchainActivity(rawActivity = {}) {
  const kind = String(rawActivity.kind || "").toUpperCase();
  const direction = String(rawActivity.direction || "").toUpperCase();

  if (kind === "APPROVAL") {
    return {
      event_type: EVENT_TYPES.APPROVAL,
      income_category: INCOME_CATEGORIES.NONE,
      status: TRANSACTION_STATUS.CLASSIFIED,
      note: "On-chain approval detected. Preserved for auditability and excluded from taxable trade logic.",
    };
  }

  if (kind === "SWAP") {
    return {
      event_type: EVENT_TYPES.SWAP,
      income_category: INCOME_CATEGORIES.NONE,
      status: TRANSACTION_STATUS.CLASSIFIED,
      note: rawActivity.protocol ? `Swap-like activity via ${rawActivity.protocol}. Placeholder classification.` : "Swap-like activity preserved for later interpretation.",
    };
  }

  if (kind === "TRANSFER" || kind === "NATIVE_TRANSFER" || kind === "TOKEN_TRANSFER") {
    return {
      event_type: direction === "IN" ? EVENT_TYPES.TRANSFER_IN : EVENT_TYPES.TRANSFER_OUT,
      income_category: INCOME_CATEGORIES.NONE,
      status: TRANSACTION_STATUS.CLASSIFIED,
      note: direction === "IN" ? "Incoming on-chain transfer." : "Outgoing on-chain transfer.",
    };
  }

  return {
    event_type: EVENT_TYPES.UNKNOWN,
    income_category: INCOME_CATEGORIES.NONE,
    status: TRANSACTION_STATUS.NORMALIZED,
    note: "Unknown on-chain activity preserved with raw metadata for later classification.",
  };
}
