const NFT_HINTS = ["nft", "mint", "opensea", "magiceden", "collection"];

export function classifyNft(tx, context) {
  const raw = context.raw;
  const text = `${raw.summary || ""} ${raw.protocol || ""}`.toLowerCase();
  if (!NFT_HINTS.some((hint) => text.includes(hint))) return null;

  const incomingOnly = tx.amount_in > 0 && (!tx.amount_out || tx.amount_out === 0);
  const outgoingForSale = tx.amount_out > 0 && tx.amount_in > 0;

  if (incomingOnly) {
    return {
      event_type: "NFT_MINT",
      income_category: "NONE",
      protocol: tx.protocol || raw.protocol || "NFT_PROTOCOL_PLACEHOLDER",
      note: buildNote(tx.note, "NFT mint-like pattern detected."),
      status: "CLASSIFIED",
      classification_confidence: "MEDIUM",
    };
  }

  if (outgoingForSale) {
    return {
      event_type: "NFT_SALE",
      income_category: "NONE",
      protocol: tx.protocol || raw.protocol || "NFT_PROTOCOL_PLACEHOLDER",
      note: buildNote(tx.note, "NFT sale-like pattern detected."),
      status: "CLASSIFIED",
      classification_confidence: "MEDIUM",
    };
  }

  return null;
}

function buildNote(existing, extra) {
  return [existing, extra].filter(Boolean).join(" ").trim();
}
