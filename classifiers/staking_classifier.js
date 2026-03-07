const STAKING_HINTS = ["staking", "validator", "lido", "reward", "restake"];
const DEFI_HINTS = ["farm", "vault", "defi", "compound", "aave", "curve"];

export function classifyStakingOrDefiReward(tx, context) {
  const raw = context.raw;
  const text = `${raw.summary || ""} ${raw.protocol || ""} ${tx.protocol || ""}`.toLowerCase();
  const incomingOnly = tx.amount_in > 0 && (!tx.amount_out || tx.amount_out === tx.amount_in);

  if (!incomingOnly) return null;

  if (STAKING_HINTS.some((hint) => text.includes(hint))) {
    return {
      event_type: "STAKING_REWARD",
      income_category: "STAKING_INCOME",
      protocol: tx.protocol || raw.protocol || "",
      note: buildNote(tx.note, "Staking reward heuristic matched protocol/reward pattern."),
      status: "CLASSIFIED",
      classification_confidence: raw.kind === "STAKING_REWARD" ? "HIGH" : "MEDIUM",
    };
  }

  if (DEFI_HINTS.some((hint) => text.includes(hint))) {
    return {
      event_type: "DEFI_REWARD",
      income_category: "DEFI_INCOME",
      protocol: tx.protocol || raw.protocol || "",
      note: buildNote(tx.note, "DeFi reward heuristic matched protocol/reward pattern."),
      status: "CLASSIFIED",
      classification_confidence: raw.kind === "DEFI_REWARD" ? "HIGH" : "MEDIUM",
    };
  }

  return null;
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
