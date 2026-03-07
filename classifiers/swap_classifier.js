export function classifySwap(tx, context) {
  const raw = context.raw;
  const hasSwapKind = raw.kind === "SWAP";
  const structuralSwap = tx.amount_in > 0 && tx.amount_out > 0 && tx.asset_in && tx.asset_out && tx.asset_in !== tx.asset_out;

  if (!hasSwapKind && !structuralSwap) return null;

  return {
    event_type: "SWAP",
    income_category: "NONE",
    protocol: tx.protocol || raw.protocol || "DEX_PLACEHOLDER",
    note: buildNote(tx.note, "Swap pattern detected from same-transaction outgoing/incoming asset movement."),
    status: "CLASSIFIED",
    classification_confidence: hasSwapKind ? "HIGH" : "MEDIUM",
  };
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
