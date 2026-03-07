import { INCOME_CATEGORIES, TRANSACTION_STATUS } from "../../classifiers/event_classifier.js";
import { SOURCE_TYPES } from "../../parsers/source_types.js";
import { classifyOnchainActivity } from "../classification/onchain_event_classifier_placeholder.js";

export function normalizeSolanaWalletActivity(rawActivities, walletRecord, { userId = "demo-user" } = {}) {
  return rawActivities.map((activity, index) => normalizeOne(activity, walletRecord, userId, index)).filter(Boolean);
}

function normalizeOne(activity, walletRecord, userId, index) {
  const classification = classifyOnchainActivity(activity);
  const now = new Date().toISOString();
  const assetSymbol = String(activity.assetSymbol || "SOL").toUpperCase();
  const base = {
    id: buildRowId(walletRecord, activity, index),
    user_id: userId,
    created_at: now,
    updated_at: now,
    timestamp: activity.timestamp,
    source_type: SOURCE_TYPES.WALLET_ONCHAIN,
    source_name: `${walletRecord.chain}:${activity.provider || "solana-provider"}`,
    source_file: "",
    raw_row_index: null,
    raw_description: buildRawDescription(activity),
    event_type: classification.event_type,
    income_category: classification.income_category || INCOME_CATEGORIES.NONE,
    exchange: "",
    chain_family: walletRecord.chain_family,
    chain: walletRecord.chain,
    protocol: activity.protocol || "",
    wallet_address: walletRecord.wallet_address,
    from_address: activity.fromAddress || "",
    to_address: activity.toAddress || "",
    tx_hash: activity.signature || activity.txHash || "",
    asset_in: "",
    asset_out: "",
    amount_in: 0,
    amount_out: 0,
    fee: toNumber(activity.fee),
    fee_asset: activity.feeAsset || "SOL",
    price_usdt: null,
    price_krw: null,
    amount_in_krw: null,
    amount_out_krw: null,
    fee_krw: null,
    fx_rate_usdt_krw: null,
    pricing_source: "",
    transfer_group_id: "",
    matched_transaction_id: "",
    transfer_match_confidence: "",
    transfer_match_reason: "",
    classification_confidence: "",
    matched_lot_id: "",
    calculation_method: "FIFO",
    note: classification.note || "",
    status: classification.status || TRANSACTION_STATUS.NORMALIZED,
  };

  if (classification.event_type === "TRANSFER_IN") {
    base.asset_in = assetSymbol;
    base.amount_in = toNumber(activity.amount);
    base.asset_out = assetSymbol;
    base.amount_out = base.amount_in;
    return base;
  }

  if (classification.event_type === "TRANSFER_OUT") {
    base.asset_out = assetSymbol;
    base.amount_out = toNumber(activity.amount);
    base.asset_in = assetSymbol;
    base.amount_in = base.amount_out;
    return base;
  }

  base.asset_in = assetSymbol || "UNKNOWN";
  base.asset_out = assetSymbol || "UNKNOWN";
  base.amount_in = toNumber(activity.amountReceived || activity.amount);
  base.amount_out = toNumber(activity.amountSent || activity.amount);
  if (!base.amount_in && String(activity.direction || "").toUpperCase() === "IN" && activity.amount) {
    base.amount_in = toNumber(activity.amount);
    base.amount_out = base.amount_in;
  }
  if (!base.amount_out && String(activity.direction || "").toUpperCase() === "OUT" && activity.amount) {
    base.amount_out = toNumber(activity.amount);
    base.amount_in = base.amount_out;
  }
  return base;
}

function buildRowId(walletRecord, activity, index) {
  return [
    "onchain",
    walletRecord.chain,
    walletRecord.wallet_address,
    activity.signature || activity.txHash || `nohash-${index}`,
    index,
  ].join(":");
}

function buildRawDescription(activity) {
  const safe = {
    kind: activity.kind,
    summary: activity.summary,
    provider: activity.provider,
    protocol: activity.protocol,
    fromAddress: activity.fromAddress,
    toAddress: activity.toAddress,
    assetSymbol: activity.assetSymbol,
    amount: activity.amount,
    tokenMint: activity.tokenMint,
    innerInstructions: activity.innerInstructions,
  };
  return JSON.stringify(safe);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}
