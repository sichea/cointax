const BRIDGE_HINTS = ["bridge", "wormhole", "layerzero", "hop", "stargate"];

export function classifyBridge(tx, context) {
  const raw = context.raw;
  const text = `${raw.summary || ""} ${raw.protocol || ""} ${tx.protocol || ""}`.toLowerCase();
  if (!BRIDGE_HINTS.some((hint) => text.includes(hint))) return null;

  return {
    event_type: "BRIDGE",
    income_category: "NONE",
    protocol: tx.protocol || raw.protocol || "BRIDGE_PROTOCOL_PLACEHOLDER",
    note: buildNote(tx.note, "Bridge-like transfer detected from protocol hints."),
    status: "CLASSIFIED",
    classification_confidence: raw.kind === "BRIDGE" ? "HIGH" : "MEDIUM",
  };
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
