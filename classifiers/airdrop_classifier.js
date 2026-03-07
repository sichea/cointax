const AIRDROP_HINTS = ["airdrop", "distribution", "claim", "merkle"];

export function classifyAirdrop(tx, context) {
  const raw = context.raw;
  const text = `${raw.summary || ""} ${raw.protocol || ""} ${tx.from_address || ""}`.toLowerCase();
  const likelyAirdrop = AIRDROP_HINTS.some((hint) => text.includes(hint));
  const incomingOnly = tx.amount_in > 0 && (!tx.amount_out || tx.amount_out === tx.amount_in);

  if (!incomingOnly || !likelyAirdrop) return null;

  return {
    event_type: "AIRDROP",
    income_category: "AIRDROP_INCOME",
    protocol: tx.protocol || raw.protocol || "",
    note: buildNote(tx.note, "Airdrop-like inbound distribution detected."),
    status: "CLASSIFIED",
    classification_confidence: raw.kind === "AIRDROP" ? "HIGH" : "MEDIUM",
  };
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
