import { buildAuditTrailReferences } from "./audit_trail_builder.js";
import { buildCalculationMethodologySection, buildPricingMethodologySection } from "./methodology_explainer.js";

export function buildNarrativeSections({ unifiedTransactions = [], realizedLots = [], summary = {}, userId = "demo-user" } = {}) {
  const sorted = [...unifiedTransactions].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const taxYear = deriveTaxYear(sorted);

  return {
    report_overview: buildReportOverview(sorted, summary, userId, taxYear),
    asset_flow_summary: buildAssetFlowSummary(sorted),
    exchange_activity_summary: buildExchangeActivitySummary(sorted, realizedLots),
    wallet_activity_summary: buildWalletActivitySummary(sorted),
    internal_transfer_summary: buildInternalTransferSummary(sorted),
    trading_gain_summary: buildTradingGainSummary(realizedLots),
    airdrop_income_summary: buildAirdropIncomeSummary(sorted),
    defi_income_summary: buildDefiIncomeSummary(sorted),
    unknown_manual_review: buildUnknownManualReviewSummary(sorted),
    pricing_methodology: buildPricingMethodologySection(summary),
    calculation_methodology: buildCalculationMethodologySection(),
    audit_trail_references: buildAuditTrailReferences(),
  };
}

function buildReportOverview(unifiedTransactions, summary, userId, taxYear) {
  const exchangeEvents = unifiedTransactions.filter((tx) => tx.source_type !== "WALLET_ONCHAIN").length;
  const onchainEvents = unifiedTransactions.filter((tx) => tx.source_type === "WALLET_ONCHAIN").length;
  const taxableEvents = unifiedTransactions.filter((tx) => isTaxableEvent(tx.event_type)).length;
  const maskedUser = maskUserIdentifier(userId);

  return {
    title: "Report Overview",
    report_title: "Unified Korean Crypto Tax Evidence Report",
    user_identifier: maskedUser,
    tax_year: taxYear,
    generated_at: new Date().toISOString(),
    total_transaction_count: unifiedTransactions.length,
    total_exchange_events: exchangeEvents,
    total_onchain_events: onchainEvents,
    total_internal_transfers: summary.totalNonTaxableTransfers || 0,
    total_taxable_events: taxableEvents,
    total_unknown_manual_review_events: summary.unknownIncomeEvents || 0,
    narrative: "This report summarizes the user's crypto asset activity across exchanges and wallets and organizes the evidence into taxable and non-taxable categories for accountant review.",
  };
}

function buildAssetFlowSummary(unifiedTransactions) {
  const lines = [];
  const firstTradeBuy = unifiedTransactions.find((tx) => tx.event_type === "TRADE_BUY");
  const firstWalletReceipt = unifiedTransactions.find((tx) =>
    tx.source_type === "WALLET_ONCHAIN"
    && (tx.event_type === "TRANSFER_IN" || tx.event_type === "DEPOSIT" || tx.event_type === "INTERNAL_TRANSFER" || tx.involves_user_owned_address)
  );
  const firstReward = unifiedTransactions.find((tx) => ["AIRDROP", "STAKING_REWARD", "DEFI_REWARD"].includes(tx.event_type));
  const firstDisposition = unifiedTransactions.find((tx) => ["TRADE_SELL", "SWAP"].includes(tx.event_type));

  if (firstTradeBuy) {
    lines.push(`The user acquired ${firstTradeBuy.asset_in || firstTradeBuy.asset_out || "crypto assets"} on ${describeSource(firstTradeBuy)} on ${formatDate(firstTradeBuy.timestamp)}.`);
  }
  if (firstWalletReceipt) {
    lines.push(`Assets later moved into the user-owned wallet ${describeWallet(firstWalletReceipt)}, where on-chain activity began to appear in the unified ledger.`);
  }
  if (firstReward) {
    lines.push(`Certain wallet inflows were classified as ${humanizeEventType(firstReward.event_type).toLowerCase()} based on receipt patterns, protocol hints, and the absence of matched outbound consideration.`);
  }
  if (firstDisposition) {
    lines.push(`Assets were later disposed through ${humanizeEventType(firstDisposition.event_type).toLowerCase()} activity, and realized gains were computed using FIFO where applicable.`);
  }
  if (!lines.length) {
    lines.push("The unified ledger did not contain enough classified activity to derive a higher-level asset flow summary.");
  }

  return {
    title: "User Asset Flow Summary",
    paragraphs: lines,
  };
}

function buildExchangeActivitySummary(unifiedTransactions, realizedLots) {
  const exchangeMap = new Map();
  for (const tx of unifiedTransactions) {
    const exchange = tx.exchange || tx.source_name;
    if (!exchange || tx.source_type === "WALLET_ONCHAIN") continue;
    const current = exchangeMap.get(exchange) || { exchange, trades: 0, depositsWithdrawals: 0, assets: new Set(), realized_gain_events: 0 };
    if (["TRADE_BUY", "TRADE_SELL"].includes(tx.event_type)) current.trades += 1;
    if (["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(tx.event_type)) current.depositsWithdrawals += 1;
    if (tx.asset_in) current.assets.add(tx.asset_in);
    if (tx.asset_out) current.assets.add(tx.asset_out);
    exchangeMap.set(exchange, current);
  }

  for (const lot of realizedLots) {
    const sellSource = lot.sell_source || "UNKNOWN";
    const current = exchangeMap.get(sellSource) || { exchange: sellSource, trades: 0, depositsWithdrawals: 0, assets: new Set(), realized_gain_events: 0 };
    current.realized_gain_events += 1;
    exchangeMap.set(sellSource, current);
  }

  const items = [...exchangeMap.values()].map((entry) => ({
    exchange: entry.exchange,
    number_of_trades: entry.trades,
    deposits_withdrawals: entry.depositsWithdrawals,
    major_assets: [...entry.assets].slice(0, 6),
    realized_gain_events: entry.realized_gain_events,
    narrative: `${entry.exchange} was used for ${entry.trades ? "trading" : "account activity"}${entry.depositsWithdrawals ? " and transfer-linked deposits/withdrawals" : ""}.`,
  }));

  if (!items.length) {
    items.push({
      exchange: "N/A",
      number_of_trades: 0,
      deposits_withdrawals: 0,
      major_assets: [],
      realized_gain_events: 0,
      narrative: "No exchange activity was present in the unified ledger for the selected period.",
    });
  }

  return {
    title: "Exchange Activity Summary",
    items,
  };
}

function buildWalletActivitySummary(unifiedTransactions) {
  const walletMap = new Map();
  for (const tx of unifiedTransactions) {
    if (!tx.involves_user_owned_address && tx.source_type !== "WALLET_ONCHAIN") continue;
    const walletKey = tx.wallet_address_label || tx.from_address_label || tx.to_address_label || tx.wallet_address || tx.from_address || tx.to_address || "Unlabeled Wallet";
    const entry = walletMap.get(walletKey) || {
      wallet_label: walletKey,
      chain: tx.chain || "",
      total_incoming_events: 0,
      total_outgoing_events: 0,
      swap_count: 0,
      bridge_count: 0,
      reward_like_inflows: 0,
      unknown_onchain_events: 0,
      narrative_parts: [],
    };
    if (["TRANSFER_IN", "DEPOSIT", "AIRDROP", "STAKING_REWARD", "DEFI_REWARD"].includes(tx.event_type)) entry.total_incoming_events += 1;
    if (["TRANSFER_OUT", "WITHDRAWAL"].includes(tx.event_type)) entry.total_outgoing_events += 1;
    if (tx.event_type === "SWAP") entry.swap_count += 1;
    if (tx.event_type === "BRIDGE") entry.bridge_count += 1;
    if (["AIRDROP", "STAKING_REWARD", "DEFI_REWARD"].includes(tx.event_type)) entry.reward_like_inflows += 1;
    if (tx.source_type === "WALLET_ONCHAIN" && tx.event_type === "UNKNOWN") entry.unknown_onchain_events += 1;
    walletMap.set(walletKey, entry);
  }

  const items = [...walletMap.values()].map((entry) => ({
    ...entry,
    narrative: `The wallet labeled "${entry.wallet_label}" on ${entry.chain || "its registered chain"} recorded ${entry.total_incoming_events} incoming events, ${entry.total_outgoing_events} outgoing events, ${entry.swap_count} swap-like events, ${entry.bridge_count} bridge-like events, and ${entry.reward_like_inflows} reward-like inflows.`,
  }));

  if (!items.length) {
    items.push({
      wallet_label: "N/A",
      chain: "",
      total_incoming_events: 0,
      total_outgoing_events: 0,
      swap_count: 0,
      bridge_count: 0,
      reward_like_inflows: 0,
      unknown_onchain_events: 0,
      narrative: "No user-owned wallet activity was available for narrative summarization.",
    });
  }

  return {
    title: "Wallet Activity Summary",
    items,
  };
}

function buildInternalTransferSummary(unifiedTransactions) {
  const matched = unifiedTransactions.filter((tx) => tx.event_type === "INTERNAL_TRANSFER" || tx.transfer_match_status === "AUTO_MATCHED");
  const examples = matched.slice(0, 8).map((tx) => ({
    timestamp: tx.timestamp,
    asset: tx.asset_in || tx.asset_out,
    amount: tx.amount_in || tx.amount_out,
    from: tx.from_address_label || tx.exchange || tx.from_address || tx.source_name || "Unknown source",
    to: tx.to_address_label || tx.wallet_address_label || tx.to_address || tx.source_name || "Unknown destination",
    transfer_group_id: tx.transfer_group_id || "",
    reason: tx.transfer_match_reason || "Ownership and timing evidence supported non-taxable transfer treatment.",
  }));

  const narrative = matched.length
    ? [
        `A total of ${matched.length} transfer-linked rows were treated as non-taxable internal movements because exchange withdrawals, exchange deposits, or wallet-to-wallet movements matched the user's registered addresses and timing/amount evidence.`,
      ]
    : ["No internal transfers were matched during this processing run."];

  return {
    title: "Internal Transfer Summary",
    total_internal_transfers: matched.length,
    paragraphs: narrative,
    examples,
  };
}

function buildTradingGainSummary(realizedLots) {
  const byAsset = new Map();
  for (const lot of realizedLots) {
    const asset = lot.asset || "UNKNOWN";
    const entry = byAsset.get(asset) || { asset, total_amount: 0, total_profit_krw: 0, examples: [] };
    entry.total_amount += safeNum(lot.amount);
    entry.total_profit_krw += safeNum(lot.profit_krw);
    if (entry.examples.length < 5) {
      entry.examples.push({
        buy_timestamp: lot.buy_timestamp,
        sell_timestamp: lot.sell_timestamp,
        buy_source: lot.buy_source,
        sell_source: lot.sell_source,
        profit_krw: lot.profit_krw,
        calculation_method: lot.calculation_method,
      });
    }
    byAsset.set(asset, entry);
  }

  const items = [...byAsset.values()].map((entry) => ({
    ...entry,
    total_profit_krw: round(entry.total_profit_krw),
    narrative: `${entry.asset} disposals produced realized gains of ${formatKrw(entry.total_profit_krw)} KRW under FIFO cost basis.`,
  }));

  return {
    title: "Trading Gain Summary",
    items,
    paragraphs: items.length
      ? ["Realized gains were computed only for disposal events such as TRADE_SELL and swap disposals, using FIFO acquisition matching."]
      : ["No realized disposal events were available for gain summarization."],
  };
}

function buildAirdropIncomeSummary(unifiedTransactions) {
  const airdrops = unifiedTransactions.filter((tx) => tx.event_type === "AIRDROP");
  const items = airdrops.slice(0, 12).map((tx) => ({
    asset: tx.asset_in,
    amount: tx.amount_in,
    receive_timestamp: tx.timestamp,
    price_krw_at_receive: tx.price_krw,
    income_krw: tx.amount_in_krw,
    wallet: tx.wallet_address_label || tx.to_address_label || tx.wallet_address || tx.to_address || "Unknown wallet",
    source_context: tx.source_name || tx.protocol || tx.from_address || "Unknown source",
    tx_hash: tx.tx_hash || "",
    narrative: `${tx.asset_in} was received into ${tx.wallet_address_label || tx.to_address_label || "the user's wallet"} on ${formatDate(tx.timestamp)} and classified as airdrop income at ${formatKrw(tx.amount_in_krw)} KRW.`,
  }));

  return {
    title: "Airdrop Income Summary",
    total_airdrop_events: airdrops.length,
    items,
  };
}

function buildDefiIncomeSummary(unifiedTransactions) {
  const rewards = unifiedTransactions.filter((tx) => ["STAKING_REWARD", "DEFI_REWARD"].includes(tx.event_type));
  const items = rewards.slice(0, 12).map((tx) => ({
    event_type: tx.event_type,
    protocol: tx.protocol || "UNKNOWN_PROTOCOL",
    asset: tx.asset_in,
    amount: tx.amount_in,
    timestamp: tx.timestamp,
    price_krw_at_receive: tx.price_krw,
    income_krw: tx.amount_in_krw,
    classification_basis: tx.note || tx.raw_description || "Protocol hint and receipt-only reward pattern.",
    narrative: `${humanizeEventType(tx.event_type)} was recognized for ${tx.asset_in} via ${tx.protocol || "an identified protocol context"} on ${formatDate(tx.timestamp)} and valued at ${formatKrw(tx.amount_in_krw)} KRW.`,
  }));

  return {
    title: "Staking / DeFi Income Summary",
    total_reward_events: rewards.length,
    items,
  };
}

function buildUnknownManualReviewSummary(unifiedTransactions) {
  const allUnknowns = unifiedTransactions.filter((tx) => tx.event_type === "UNKNOWN");
  const unknowns = allUnknowns.slice(0, 20).map((tx) => ({
    tx_hash: tx.tx_hash || "",
    chain: tx.chain || "",
    wallet_label: tx.wallet_address_label || tx.from_address_label || tx.to_address_label || "Unknown wallet",
    reason: tx.note || tx.raw_description || "This event could not be confidently classified from the available ledger structure.",
    requires_manual_review: true,
  }));

  return {
    title: "Unknown / Manual Review Items",
    total_unknown_items: allUnknowns.length,
    items: unknowns,
    paragraphs: unknowns.length
      ? ["Certain multi-leg or weak-signal on-chain events could not be confidently classified and should be reviewed manually."]
      : ["No UNKNOWN events required manual review in this run."],
  };
}

function deriveTaxYear(unifiedTransactions) {
  const first = unifiedTransactions.find((tx) => tx.timestamp);
  return first ? new Date(first.timestamp).getUTCFullYear() : new Date().getUTCFullYear();
}

function maskUserIdentifier(userId) {
  const value = String(userId || "user");
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 2)}***`;
}

function describeSource(tx) {
  return tx.exchange || tx.source_name || tx.protocol || "the recorded platform";
}

function describeWallet(tx) {
  return tx.wallet_address_label || tx.to_address_label || tx.from_address_label || tx.wallet_address || tx.to_address || tx.from_address || "an unlabeled wallet";
}

function isTaxableEvent(eventType) {
  return ["TRADE_SELL", "SWAP", "AIRDROP", "STAKING_REWARD", "DEFI_REWARD"].includes(eventType);
}

function humanizeEventType(eventType) {
  return String(eventType || "UNKNOWN").replace(/_/g, " ");
}

function formatDate(value) {
  if (!value) return "unknown time";
  return new Date(value).toISOString().slice(0, 10);
}

function safeNum(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function formatKrw(value) {
  return new Intl.NumberFormat("ko-KR").format(round(safeNum(value)));
}
