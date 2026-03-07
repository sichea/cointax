export function classifyLiquidity(tx, context) {
  const rawLegs = Array.isArray(context.raw.rawLegs) ? context.raw.rawLegs : [];
  if (!rawLegs.length) return null;

  const incoming = rawLegs.filter((leg) => String(leg.direction || "").toUpperCase() === "IN");
  const outgoing = rawLegs.filter((leg) => String(leg.direction || "").toUpperCase() === "OUT");
  const incomingLp = incoming.some((leg) => String(leg.token || "").toUpperCase().includes("LP"));
  const outgoingLp = outgoing.some((leg) => String(leg.token || "").toUpperCase().includes("LP"));

  if (outgoing.length >= 2 && incomingLp) {
    return {
      event_type: "LIQUIDITY_ADD",
      income_category: "NONE",
      protocol: tx.protocol || context.raw.protocol || "LP_PROTOCOL_PLACEHOLDER",
      note: buildNote(tx.note, "Liquidity add pattern detected from two outgoing legs and LP receipt."),
      status: "CLASSIFIED",
      classification_confidence: "HIGH",
    };
  }

  if (incoming.length >= 2 && outgoingLp) {
    return {
      event_type: "LIQUIDITY_REMOVE",
      income_category: "NONE",
      protocol: tx.protocol || context.raw.protocol || "LP_PROTOCOL_PLACEHOLDER",
      note: buildNote(tx.note, "Liquidity removal pattern detected from LP burn and token receipt."),
      status: "CLASSIFIED",
      classification_confidence: "HIGH",
    };
  }

  return null;
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
