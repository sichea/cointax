import { EVENT_TYPES } from "../classifiers/event_classifier.js";
import { buildOwnedAddressLookup, describeOwnedAddress } from "../wallets/wallet_registry.js";

const DEFAULT_CONFIG = {
  matchWindowHours: 24,
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
  const ownershipLookup = buildOwnedAddressLookup(cfg.userOwnedAddresses || []);
  const txs = unifiedTransactions.map((tx) => initializeTransferFields(tx, ownershipLookup));

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
      .map(({ tx: incoming, idx: inIndex }) => scoreCandidate(outgoing, incoming, cfg, inIndex, ownershipLookup))
      .filter((s) => s.eligible)
      .sort((a, b) => b.score - a.score);

    if (!candidateScores.length) continue;

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

function initializeTransferFields(tx, ownershipLookup) {
  const hydrated = hydrateOwnershipFlags(tx, ownershipLookup);
  return {
    ...hydrated,
    transfer_group_id: hydrated.transfer_group_id || null,
    transfer_match_status: hydrated.transfer_match_status || TRANSFER_MATCH_STATUS.UNMATCHED,
    matched_transaction_id: hydrated.matched_transaction_id || null,
    transfer_match_confidence: hydrated.transfer_match_confidence || null,
    transfer_match_reason: hydrated.transfer_match_reason || null,
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

function scoreCandidate(outgoing, incoming, cfg, inIndex, ownershipLookup) {
  if (outgoing.id === incoming.id) return { eligible: false };

  const outAsset = String(outgoing.asset_out || "").toUpperCase();
  const inAsset = String(incoming.asset_in || "").toUpperCase();
  if (!outAsset || outAsset !== inAsset) return { eligible: false };

  const outTime = new Date(outgoing.timestamp).getTime();
  const inTime = new Date(incoming.timestamp).getTime();
  if (!Number.isFinite(outTime) || !Number.isFinite(inTime)) return { eligible: false };

  const diffMs = Math.abs(inTime - outTime);
  const hours = diffMs / 3600000;
  if (hours > cfg.matchWindowHours) return { eligible: false };

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

  const ownershipEvidence = collectOwnershipEvidence(outgoing, incoming, ownershipLookup);
  const exchangePairEvidence = collectExchangePairEvidence(outgoing, incoming);

  let confidence = null;
  let status = null;
  let score = 0;
  let reason = "";

  const withinStrictTolerance = absDiff <= cfg.absoluteTolerance || pctDiff <= cfg.percentageTolerance;
  const withinManualTolerance = pctDiff <= cfg.manualReviewPercentageTolerance;

  if (exchangePairEvidence.isEligiblePair && withinStrictTolerance) {
    confidence = hours <= cfg.highConfidenceWindowHours
      ? TRANSFER_MATCH_CONFIDENCE.HIGH
      : TRANSFER_MATCH_CONFIDENCE.MEDIUM;
    status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
    score = 95 - hours;
    reason = buildReason(
      `withdrawal/deposit matched by asset/time/amount, diff=${round(absDiff)}`,
      hasHashEvidence,
      hasAddressEvidence,
      ownershipEvidence.details,
      exchangePairEvidence.details
    );
  } else if (exchangePairEvidence.isEligiblePair && withinManualTolerance) {
    confidence = TRANSFER_MATCH_CONFIDENCE.MEDIUM;
    status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
    score = 85 - hours;
    reason = buildReason(
      `fee-adjusted withdrawal/deposit match, diff=${round(absDiff)} (${round(pctDiff * 100)}%)`,
      hasHashEvidence,
      hasAddressEvidence,
      ownershipEvidence.details,
      exchangePairEvidence.details
    );
  } else if (withinStrictTolerance) {
    if (hasHashEvidence || hasAddressEvidence || ownershipEvidence.signalCount > 0) {
      confidence = TRANSFER_MATCH_CONFIDENCE.HIGH;
      status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
      score = 100 - hours + ownershipEvidence.signalCount * 5;
      reason = buildReason(
        `asset/amount/time aligned with strong evidence, diff=${round(absDiff)}`,
        hasHashEvidence,
        hasAddressEvidence,
        ownershipEvidence.details,
        exchangePairEvidence.details
      );
    } else {
      confidence = TRANSFER_MATCH_CONFIDENCE.MEDIUM;
      status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
      score = 80 - hours;
      reason = buildReason(
        `asset and amount matched within tolerance, diff=${round(absDiff)}, ${round(hours)}h apart`,
        hasHashEvidence,
        hasAddressEvidence,
        ownershipEvidence.details,
        exchangePairEvidence.details
      );
    }
  } else if (withinManualTolerance) {
    if (ownershipEvidence.signalCount > 0 && hours <= cfg.highConfidenceWindowHours) {
      confidence = TRANSFER_MATCH_CONFIDENCE.MEDIUM;
      status = TRANSFER_MATCH_STATUS.AUTO_MATCHED;
      score = 70 - hours + ownershipEvidence.signalCount * 5;
      reason = buildReason(
        `possible fee-adjusted internal transfer, diff=${round(absDiff)} (${round(pctDiff * 100)}%)`,
        hasHashEvidence,
        hasAddressEvidence,
        ownershipEvidence.details,
        exchangePairEvidence.details
      );
    } else {
      confidence = TRANSFER_MATCH_CONFIDENCE.LOW;
      status = TRANSFER_MATCH_STATUS.MANUAL_REVIEW;
      score = 50 - hours + ownershipEvidence.signalCount * 2;
      reason = buildReason(
        `possible fee-adjusted transfer, diff=${round(absDiff)} (${round(pctDiff * 100)}%)`,
        hasHashEvidence,
        hasAddressEvidence,
        ownershipEvidence.details,
        exchangePairEvidence.details
      );
    }
  } else {
    return { eligible: false };
  }

  const contextDup =
    String(outgoing.source_name || "") === String(incoming.source_name || "")
    && String(outgoing.exchange || "") === String(incoming.exchange || "")
    && String(outgoing.source_file || "") === String(incoming.source_file || "");

  if (contextDup && !hasHashEvidence && !hasAddressEvidence && ownershipEvidence.signalCount === 0 && hours < 0.05) {
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

function collectOwnershipEvidence(outgoing, incoming, ownershipLookup) {
  const signals = [];

  const ownedOutgoingWallet = lookupOwnedRecord(outgoing.wallet_address, ownershipLookup);
  const ownedIncomingWallet = lookupOwnedRecord(incoming.wallet_address, ownershipLookup);
  const ownedOutgoingTo = lookupOwnedRecord(outgoing.to_address, ownershipLookup);
  const ownedOutgoingFrom = lookupOwnedRecord(outgoing.from_address, ownershipLookup);
  const ownedIncomingFrom = lookupOwnedRecord(incoming.from_address, ownershipLookup);
  const ownedIncomingTo = lookupOwnedRecord(incoming.to_address, ownershipLookup);

  if (ownedOutgoingTo) signals.push(`destination is registered wallet ${describeOwnedAddress(ownedOutgoingTo)}`);
  if (ownedIncomingFrom) signals.push(`source is registered wallet ${describeOwnedAddress(ownedIncomingFrom)}`);
  if (ownedOutgoingWallet) signals.push(`outgoing wallet context is registered ${describeOwnedAddress(ownedOutgoingWallet)}`);
  if (ownedIncomingWallet) signals.push(`incoming wallet context is registered ${describeOwnedAddress(ownedIncomingWallet)}`);
  if (ownedOutgoingFrom && ownedIncomingTo) {
    signals.push(
      `both sides touch registered wallets ${describeOwnedAddress(ownedOutgoingFrom)} and ${describeOwnedAddress(ownedIncomingTo)}`
    );
  }

  return {
    signalCount: new Set(signals).size,
    details: Array.from(new Set(signals)),
  };
}

function collectExchangePairEvidence(outgoing, incoming) {
  const withdrawalExchange = getSourceExchange(outgoing);
  const depositExchange = getSourceExchange(incoming);
  const isEligiblePair =
    outgoing.event_type === EVENT_TYPES.WITHDRAWAL
    && incoming.event_type === EVENT_TYPES.DEPOSIT
    && Boolean(withdrawalExchange)
    && Boolean(depositExchange);

  const details = [];
  if (withdrawalExchange) details.push(`withdrawal source exchange: ${withdrawalExchange}`);
  if (depositExchange) details.push(`deposit source exchange: ${depositExchange}`);

  return {
    isEligiblePair,
    details,
  };
}

function buildReason(base, hasHashEvidence, hasAddressEvidence, ownershipDetails, exchangeDetails = []) {
  const extras = [];
  if (hasHashEvidence) extras.push("matching tx hash");
  if (hasAddressEvidence) extras.push("matching address linkage");
  extras.push(...ownershipDetails.map((detail) => `ownership evidence: ${detail}`));
  extras.push(...exchangeDetails);
  return extras.length ? `${base}; ${extras.join("; ")}` : base;
}

function hydrateOwnershipFlags(tx, ownershipLookup) {
  const walletRecord = lookupOwnedRecord(tx.wallet_address, ownershipLookup);
  const fromRecord = lookupOwnedRecord(tx.from_address, ownershipLookup);
  const toRecord = lookupOwnedRecord(tx.to_address, ownershipLookup);

  return {
    ...tx,
    wallet_user_owned_address: Boolean(tx.wallet_user_owned_address || walletRecord),
    from_user_owned_address: Boolean(tx.from_user_owned_address || fromRecord),
    to_user_owned_address: Boolean(tx.to_user_owned_address || toRecord),
    involves_user_owned_address: Boolean(tx.involves_user_owned_address || walletRecord || fromRecord || toRecord),
    wallet_address_label: tx.wallet_address_label || walletRecord?.label || "",
    from_address_label: tx.from_address_label || fromRecord?.label || "",
    to_address_label: tx.to_address_label || toRecord?.label || "",
  };
}

function lookupOwnedRecord(address, ownershipLookup) {
  if (!address) return null;
  return ownershipLookup.get(address) || null;
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
    outgoing_source: getSourceExchange(outgoing) || outgoing.to_address_label || outgoing.source_name || outgoing.exchange || outgoing.to_address || "",
    incoming_destination: getSourceExchange(incoming) || incoming.from_address_label || incoming.source_name || incoming.exchange || incoming.from_address || "",
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

function getSourceExchange(tx) {
  const exchange = String(tx.exchange || "").trim();
  if (exchange) return exchange;

  const sourceName = String(tx.source_name || "").trim();
  if (sourceName.includes("Binance")) return "Binance";
  if (sourceName.includes("Bybit")) return "Bybit";
  return "";
}
