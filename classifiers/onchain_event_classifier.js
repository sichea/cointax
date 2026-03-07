import { classifySwap } from "./swap_classifier.js";
import { classifyLiquidity } from "./liquidity_classifier.js";
import { classifyBridge } from "./bridge_classifier.js";
import { classifyStakingOrDefiReward } from "./staking_classifier.js";
import { classifyAirdrop } from "./airdrop_classifier.js";
import { classifyNft } from "./nft_classifier.js";

const CLASSIFIER_CHAIN = [
  classifySwap,
  classifyLiquidity,
  classifyBridge,
  classifyStakingOrDefiReward,
  classifyAirdrop,
  classifyNft,
];

const CONFIDENCE_SCORE = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  "": 0,
  null: 0,
  undefined: 0,
};

export function classifyOnchainUnifiedTransactions(unifiedTransactions) {
  return unifiedTransactions.map((tx, _, rows) => classifyOneOnchainTransaction(tx, rows));
}

export function classifyOneOnchainTransaction(tx, allRows = []) {
  if (tx.source_type !== "WALLET_ONCHAIN") return { ...tx };

  const raw = parseRawDescription(tx.raw_description);
  let current = {
    ...tx,
    classification_confidence: tx.classification_confidence || "",
  };

  for (const classifier of CLASSIFIER_CHAIN) {
    const patch = classifier(current, { raw, allRows });
    if (!patch) continue;
    if (!canApplyClassification(current, patch)) continue;
    current = {
      ...current,
      ...patch,
    };
  }

  if (!current.classification_confidence) {
    current.classification_confidence = current.event_type === "UNKNOWN" ? "LOW" : "MEDIUM";
  }

  return current;
}

function canApplyClassification(current, patch) {
  if (current.event_type === "UNKNOWN" || current.event_type === "TRANSFER_IN" || current.event_type === "TRANSFER_OUT") {
    return true;
  }

  return score(patch.classification_confidence) > score(current.classification_confidence);
}

function parseRawDescription(rawDescription) {
  if (!rawDescription) return {};
  try {
    return JSON.parse(rawDescription);
  } catch {
    return { summary: String(rawDescription) };
  }
}

function score(value) {
  return CONFIDENCE_SCORE[value] || 0;
}
