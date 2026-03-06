import { EVENT_TYPES } from "../classifiers/event_classifier.js";

const DEFAULT_CONFIG = {
  matchWindowHours: 72,
  absoluteTolerance: 0.000001,
  percentageTolerance: 0.01,
  manualReviewPercentageTolerance: 0.05,
  highConfidenceWindowHours: 6,
};

const OUTGOING_TYPES = new Set([EVENT_TYPES.WITHDRAWAL, "TRANSFER_OUT", EVENT_TYPES.BRIDGE]);
const INCOMING_TYPES = new Set([EVENT_TYPES.DEPOSIT, "TRANSFER_IN", EVENT_TYPES.BRIDGE]);

export const TRANSFER_MATCH_STATUS = Object.freeze({
  UNMATCHED: "UNMATCHED",
  AUTO_MATCHED: "AUTO_MATCHED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  MANUALLY_CONFIRMED: "MANUALLY_CONFIRMED",
  REJECTED: "REJECTED",
});

export const TRANSFER_MATCH_CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

export function matchTransfers(unifiedTransactions, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const txs = unifiedTransactions.map((tx) => initializeTransferFields(tx));

  const outgoingIdx = txs
    .map((tx, idx) => ({ tx, idx }))
    .filter(({ tx }) => isOutgoingCandidate(tx));

  const incomingIdx = txs
    .map((tx, idx) => ({ tx, idx }))
    .filter(({ tx }) => isIncomingCandidate(tx));

  const matchedIncoming = new Set();
  const groups = [];
  const warnings = [];
  let groupCounter = 0;

  for (const { tx: outgoing, idx: outIndex } of outgoingIdx) {
    if (outgoing.transfer_match_status !== TRANSFER_MATCH_STATUS.UNMATCHED) continue;

    const candidateScores = incomingIdx
      .filter(({ idx }) => !matchedIncoming.has(idx))
      .map(({ tx: incoming, idx: inIndex }) => scoreCandidate(outgoing, incoming, cfg, inIndex))
      .filter((s) => s.eligible)
      .sort((a, b) => b.score - a.score);

    if (!candidateScores.length) {
      continue;
    }

    const best = candidateScores[0];
    const incoming = txs[best.inIndex];
    const groupId = generateTransferGroupId(++groupCounter, outgoing, incoming);

    if (best.confidence === TRANSFER_MATCH_CONFIDENCE.LOW) {
      txs[outIndex] = applyMatchMetadata(outgoing, {
        transfer_group_id: groupId,
        transfer_match_status: TRANSFER_MATCH_STATUS.MANUAL_REVIEW,
        matched_transaction_id: incoming.id,
        transfer_match_confidence: TRANSFER_MATCH_CONFIDENCE.LOW,
        transfer_match_reason: best.reason,
      });
      incomingIdx.forEach((entry) => {
        if (entry.idx === best.inIndex) {
          txs[entry.idx] = applyMatchMetadata(entry.tx, {
            transfer_group_id: groupId,
            transfer_match_status: TRANSFER_MATCH_STATUS.MANUAL_REVIEW,
            matched_transaction_id: outgoing.id,
            transfer_match_confidence: TRANSFER_MATCH_CONFIDENCE.LOW,
            transfer_match_reason: best.reason,
          });
        }
      });

      groups.push(buildGroupSummary(groupId, txs[outIndex], txs[best.inIndex], best));
      warnings.push(`MANUAL_REVIEW: ${groupId} ${best.reason}`);
      continue;
    }

    const outMatched = applyMatchMetadata(outgoing, {
      transfer_group_id: groupId,
      transfer_match_status: TRANSFER_MATCH_STATUS.AUTO_MATCHED,
      matched_transaction_id: incoming.id,
      transfer_match_confidence: best.confidence,
      transfer_match_reason: best.reason,
      event_type: EVENT_TYPES.INTERNAL_TRANSFER,
      income_category: "NONE",
    });
    const inMatched = applyMatchMetadata(incoming, {
      transfer_group_id: groupId,
      transfer_match_status: TRANSFER_MATCH_STATUS.AUTO_MATCHED,
      matched_transaction_id: outgoing.id,
      transfer_match_confidence: best.confidence,
      transfer_match_reason: best.reason,
      event_type: EVENT_TYPES.INTERNAL_TRANSFER,
      income_category: "NONE",
    });

    txs[outIndex] = outMatched;
    txs[best.inIndex] = inMatched;
    matchedIncoming.add(best.inIndex);

    groups.push(buildGroupSummary(groupId, outMatched, inMatched, best));
  }

  const stats = buildTransferStats(txs, groups);

  return {
    transactions: txs,
    groups,
    stats,
    warnings,
  };
}

function initializeTransferFields(tx) {
  return {
    ...tx,
    transfer_group_id: tx.transfer_group_id || null,
    transfer_match_status: tx.transfer_match_status || TRANSFER_MATCH_STATUS.UNMATCHED,
    matched_transaction_id: tx.matched_transaction_id || null,
    transfer_match_confidence: tx.transfer_match_confidence || null,
    transfer_match_reason: tx.transfer_match_reason || null,
  };
}

function applyMatchMetadata(tx, patch) {
  return {
    ...tx,
    ...patch,
    updated_at: new Date().toISOString(),
    note: tx.note,
  };
}

function isOutgoingCandidate(tx) {
  if (!OUTGOING_TYPES.has(tx.event_type)) return false;
  return tx.asset_out && Number.isFinite(tx.amount_out) && tx.amount_out > 0;
}

function isIncomingCandidate(tx) {
  if (!INCOMING_TYPES.has(tx.event_type)) return false;
  return tx.asset_in && Number.isFinite(tx.amount_in) && tx.amount_in > 0;
}

function scoreCandidate(outgoing, incoming, cfg, inIndex) {
  if (outgoing.id === incoming.id) {
    return { eligible: false };
  }

  const outAsset = String(outgoing.asset_out || "").toUpperCase();
  const inAsset = String(incoming.asset_in || "").toUpperCase();
  if (!outAsset || outAsset !== inAsset) {
    return { eligible: false };
  }

  const outTime = new Date(outgoing.timestamp).getTime();
  const inTime = new Date(incoming.timestamp).getTime();
  if (!Number.isFinite(outTime) || !Number.isFinite(inTime)) {
    return { eligible: false };
  }

  const diffMs = Math.abs(inTime - outTime);
  const hours = diffMs / 3600000;
  if (hours > cfg.matchWindowHours) {
    return { eligible: false };
  }

  const outAmount = Number(outgoing.amount_out);
  const inAmount = Number(incoming.amount_in);
  if (!Number.isFinite(outAmount) || !Number.isFinite(inAmount) || outAmount <= 0 || inAmount <= 0) {
    return { eligible: false };
  }

  const absDiff = Math.abs(outAmount - inAmount);
  const pctDiff = absDiff / Math.max(outAmount, inAmount);

  const hasHashEvidence = outgoing.tx_hash && incoming.tx_hash && outgoing.tx_hash === incoming.tx_hash;
  const hasAddressEvidence =
    (outgoing.to_address && incoming.to_address && outgoing.to_address === incoming.to_address)
    || (outgoing.from_address && incoming.from_address && outgoing.from_address === incoming.from_address)
    || (outgoing.to_address && incoming.wallet_address && outgoing.to_address === incoming.wallet_address)
    || (incoming.from_address && outgoing.wallet_address && incoming.from_address === outgoing.wallet_address);

  let confidence = null;
  let status = null;
  let score = 0;
  let reason = "";

  const withinStrictTolerance = absDiff <= cfg.absoluteTolerance || pctDiff <= cfg.percentageTolerance;
  const withinManualTolerance = pctDiff <= cfg.manualReviewPercentageTolerance;

  if (withinStrictTolerance) {
    if (hours <= cfg.highConfidenceWindowHours && (hasHashEvidence || hasAddressEvidence)) {
      confidence = TRANSFER_MATCH_CONFIDENCE.HIGH;
      status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
      score = 100 - hours;
      reason = `asset/amount/time aligned with strong evidence (hash/address), diff=${round(absDiff)}`;
    } else {
      confidence = TRANSFER_MATCH_CONFIDENCE.MEDIUM;
      status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
      score = 80 - hours;
      reason = `asset and amount matched within tolerance, diff=${round(absDiff)}, ${round(hours)}h apart`;
    }
  } else if (withinManualTolerance) {
    confidence = TRANSFER_MATCH_CONFIDENCE.LOW;
    status = TRANSFER_MATCH_STATUS.MANUAL_REVIEW;
    score = 50 - hours;
    reason = `possible fee-adjusted transfer, diff=${round(absDiff)} (${round(pctDiff * 100)}%)`;
  } else {
    return { eligible: false };
  }

  const contextDup =
    String(outgoing.source_name || "") === String(incoming.source_name || "")
    && String(outgoing.exchange || "") === String(incoming.exchange || "")
    && String(outgoing.source_file || "") === String(incoming.source_file || "");

  if (contextDup && !hasHashEvidence && !hasAddressEvidence && hours < 0.05) {
    return { eligible: false };
  }

  return {
    eligible: true,
    inIndex,
    score,
    status,
    confidence,
    reason,
    hours,
    absDiff,
    pctDiff,
  };
}

function generateTransferGroupId(counter, outgoing, incoming) {
  const base = new Date(Math.min(new Date(outgoing.timestamp).getTime(), new Date(incoming.timestamp).getTime()))
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  return `TG-${base}-${String(counter).padStart(6, "0")}`;
}

function buildGroupSummary(groupId, outgoing, incoming, score) {
  return {
    transfer_group_id: groupId,
    asset: outgoing.asset_out || incoming.asset_in,
    amount: incoming.amount_in,
    outgoing_source: outgoing.source_name || outgoing.exchange || "",
    incoming_destination: incoming.source_name || incoming.exchange || "",
    time_difference_hours: round(score.hours),
    confidence: score.confidence,
    transfer_match_status: score.status,
    transfer_match_reason: score.reason,
    outgoing_transaction_id: outgoing.id,
    incoming_transaction_id: incoming.id,
  };
}

function buildTransferStats(transactions, groups) {
  const unmatchedDeposits = transactions.filter(
    (tx) => tx.event_type === EVENT_TYPES.DEPOSIT && tx.transfer_match_status === TRANSFER_MATCH_STATUS.UNMATCHED
  ).length;

  const unmatchedWithdrawals = transactions.filter(
    (tx) => tx.event_type === EVENT_TYPES.WITHDRAWAL && tx.transfer_match_status === TRANSFER_MATCH_STATUS.UNMATCHED
  ).length;

  const manualReviewRequired = transactions.filter(
    (tx) => tx.transfer_match_status === TRANSFER_MATCH_STATUS.MANUAL_REVIEW
  ).length;

  const autoMatchedGroups = new Set(
    groups
      .filter((g) => g.transfer_match_status === TRANSFER_MATCH_STATUS.AUTO_MATCHED)
      .map((g) => g.transfer_group_id)
  ).size;

  return {
    matchedInternalTransferCount: autoMatchedGroups,
    unmatchedDepositCount: unmatchedDeposits,
    unmatchedWithdrawalCount: unmatchedWithdrawals,
    manualReviewRequiredCount: manualReviewRequired,
  };
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
