import { buildZipEvidencePackage, OUTPUT_FILES } from "./exports/zip_package_exporter.js";
import { buildNarrativeJsonBlob } from "./exports/narrative_json_exporter.js";
import { buildNarrativeTaxReportPdf } from "./exports/narrative_pdf_exporter.js";
import { matchTransfers } from "./matchers/transfer_matcher.js";
import { canParseBinanceSpotTrade, parseBinanceSpotTradeRows } from "./parsers/binance_spot_trade_parser.js";
import { parseBinanceTransactionHistoryRows } from "./parsers/binance_transaction_history_parser.js";
import { parseBinanceDistributionHistoryRows } from "./parsers/binance_distribution_history_parser.js";
import { parseBinanceEarnStakingRewardsRows } from "./parsers/binance_earn_staking_rewards_parser.js";
import { canParseBybit, parseBybitRows } from "./parsers/bybit_parser.js";
import { buildFxRatesForExport } from "./pricing/fx_rate_service.js";
import { enrichTransactionsWithPricing } from "./pricing/pricing_enrichment_pipeline.js";
import { calculateRealizedProfit } from "./calculators/realized_profit_calculator.js";
import { buildTaxSummary } from "./reports/tax_summary_report.js";
import { buildNarrativeTaxReport } from "./reports/narrative_report_builder.js";
import { clearUnifiedTransactions, insertUnifiedTransactions, listUnifiedTransactions } from "./db/unified_transactions_table.js";
import { clearRealizedProfitLots, insertRealizedProfitLots, listRealizedProfitLots } from "./db/realized_profit_lots_table.js";
import { detect_binance_file_type, detect_binance_header_row, FILE_TYPES } from "./parsers/binance_file_type_detector.js";
import { hydrateOnchainTransactions, listOnchainTransactions } from "./db/onchain_transactions_table.js";
import { hydrateWalletSyncJobs } from "./db/wallet_sync_jobs_table.js";
import { classifyOnchainUnifiedTransactions } from "./classifiers/onchain_event_classifier.js";
import {
  CHAIN_FAMILIES,
  SUPPORTED_CHAINS,
  annotateTransactionsWithOwnership,
  hydrateWalletRegistry,
  listWalletAddresses,
} from "./wallets/wallet_registry.js";
import {
  addWalletAddress,
  disableRegisteredWalletAddress,
  listRegisteredWalletAddresses,
  removeRegisteredWalletAddress,
} from "./wallets/wallet_import_service.js";
import {
  buildWalletSyncStatusMap,
  ingestWalletActivity,
  listWalletSyncStatuses,
  listSyncedOnchainTransactions,
  syncAllUserWallets,
} from "./onchain/wallet_activity_service.js";

const THEME_STORAGE_KEY = "tax-evidence-theme";
const WALLET_STORAGE_KEY = "tax-evidence-wallets-v1";
const ONCHAIN_STORAGE_KEY = "tax-evidence-onchain-rows-v1";
const SYNC_JOBS_STORAGE_KEY = "tax-evidence-wallet-sync-jobs-v1";
const USER_ID = "demo-user";
const APP_BUILD_ID = "b2fe5e0";

const state = {
  unifiedTransactions: [],
  realizedLots: [],
  summary: null,
  narrativeReport: null,
  packageFiles: null,
  narrativePdfFile: null,
  narrativeJsonFile: null,
  warnings: [],
  processing: null,
  detectedFileTypes: [],
  walletAddresses: [],
  onchainTransactions: [],
  syncJobs: [],
  lastSyncSummary: null,
};

const PARSER_REGISTRY = [
  { id: "binance_spot_trade_parser", parseRows: parseBinanceSpotTradeRows },
  { id: "binance_transaction_history_parser", parseRows: parseBinanceTransactionHistoryRows },
  { id: "binance_distribution_history_parser", parseRows: parseBinanceDistributionHistoryRows },
  { id: "binance_earn_staking_rewards_parser", parseRows: parseBinanceEarnStakingRewardsRows },
  { id: "bybit_parser", canParse: canParseBybit, parseRows: parseBybitRows },
];

const dom = {
  files: document.getElementById("csvFiles"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  downloadNarrativePdfBtn: document.getElementById("downloadNarrativePdfBtn"),
  downloadNarrativeJsonBtn: document.getElementById("downloadNarrativeJsonBtn"),
  themeToggle: document.getElementById("themeToggle"),
  syncAllWalletsBtn: document.getElementById("syncAllWalletsBtn"),
  walletChainFamily: document.getElementById("walletChainFamily"),
  walletChain: document.getElementById("walletChain"),
  walletAddressInput: document.getElementById("walletAddressInput"),
  walletLabelInput: document.getElementById("walletLabelInput"),
  addWalletBtn: document.getElementById("addWalletBtn"),
  walletFormStatus: document.getElementById("walletFormStatus"),
  walletImportStatus: document.getElementById("walletImportStatus"),
  walletSyncSummary: document.getElementById("walletSyncSummary"),
  walletList: document.getElementById("walletList"),
  status: document.getElementById("status"),
  statsCard: document.getElementById("statsCard"),
  statsGrid: document.getElementById("statsGrid"),
  previewCard: document.getElementById("previewCard"),
  ledgerPreview: document.getElementById("ledgerPreview"),
  transferReviewCard: document.getElementById("transferReviewCard"),
  transferReviewSummary: document.getElementById("transferReviewSummary"),
  narrativeCard: document.getElementById("narrativeCard"),
  narrativePreview: document.getElementById("narrativePreview"),
};

initTheme();
initWalletRegistry();
initOnchainStore();
initWalletSyncJobs();
renderWalletChainFamilyOptions();
renderWalletChainOptions();
refreshWalletState();

dom.processBtn.addEventListener("click", handleProcess);
dom.downloadBtn.addEventListener("click", handleDownload);
dom.downloadNarrativePdfBtn.addEventListener("click", handleDownloadNarrativePdf);
dom.downloadNarrativeJsonBtn.addEventListener("click", handleDownloadNarrativeJson);
dom.addWalletBtn.addEventListener("click", handleAddWallet);
dom.syncAllWalletsBtn.addEventListener("click", handleSyncAllWallets);
dom.walletChainFamily.addEventListener("change", handleChainFamilyChange);
dom.walletList.addEventListener("click", handleWalletListAction);
if (dom.themeToggle) {
  dom.themeToggle.addEventListener("click", toggleTheme);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    setTheme(savedTheme);
    return;
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

function initWalletRegistry() {
  const raw = localStorage.getItem(WALLET_STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  hydrateWalletRegistry(Array.isArray(parsed) ? parsed : []);
}

function initOnchainStore() {
  const raw = localStorage.getItem(ONCHAIN_STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  hydrateOnchainTransactions(Array.isArray(parsed) ? parsed : []);
}

function initWalletSyncJobs() {
  const raw = localStorage.getItem(SYNC_JOBS_STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  hydrateWalletSyncJobs(Array.isArray(parsed) ? parsed : []);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  if (dom.themeToggle) {
    dom.themeToggle.textContent = theme === "dark" ? "라이트모드" : "다크모드";
  }
}

function handleChainFamilyChange() {
  renderWalletChainOptions();
}

function handleAddWallet() {
  const payload = {
    chain_family: dom.walletChainFamily.value,
    chain: dom.walletChain.value,
    wallet_address: dom.walletAddressInput.value,
    label: dom.walletLabelInput.value,
  };

  const result = addWalletAddress(payload, { userId: USER_ID });
  if (!result.ok) {
    setInlineMessage(dom.walletFormStatus, buildWalletFormMessage(result), "error");
    return;
  }

  persistWalletRegistry();
  refreshWalletState();
  dom.walletAddressInput.value = "";
  dom.walletLabelInput.value = "";
  setInlineMessage(
    dom.walletFormStatus,
    `saved successfully: ${result.address.wallet_address} (${result.address.chain})${result.address.label ? ` / ${result.address.label}` : ""}`,
    "success"
  );
}

async function handleWalletListAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.getAttribute("data-id");
  const action = button.getAttribute("data-action");
  if (!id || !action) return;

  if (action === "sync") {
    await syncOneWallet(id);
    return;
  }

  const result = action === "disable"
    ? disableRegisteredWalletAddress(id, { userId: USER_ID })
    : removeRegisteredWalletAddress(id, { userId: USER_ID });

  if (!result.ok) {
    setInlineMessage(dom.walletFormStatus, result.message, "error");
    return;
  }

  persistWalletRegistry();
  refreshWalletState();
  setInlineMessage(dom.walletFormStatus, result.message, "success");
}

async function handleSyncAllWallets() {
  const activeWallets = listRegisteredWalletAddresses({ userId: USER_ID, includeInactive: false });
  if (!activeWallets.length) {
    setInlineMessage(dom.walletSyncSummary, "동기화할 활성 지갑 주소가 없습니다.", "error");
    return;
  }

  setInlineMessage(dom.walletSyncSummary, "모든 지갑의 온체인 활동을 동기화 중입니다...", "muted");
  const summary = await syncAllUserWallets(USER_ID);
  persistOnchainTransactions();
  persistWalletSyncJobs();
  state.lastSyncSummary = summary;
  refreshWalletState();
  renderWalletSyncSummary();
}

async function syncOneWallet(walletId) {
  setInlineMessage(dom.walletSyncSummary, "지갑 온체인 활동을 동기화 중입니다...", "muted");
  const result = await ingestWalletActivity(USER_ID, walletId);
  persistOnchainTransactions();
  persistWalletSyncJobs();
  state.lastSyncSummary = {
    walletCount: 1,
    results: [result],
    importedCount: result.importedCount || 0,
    updatedCount: result.updatedCount || 0,
    skippedCount: result.skippedCount || 0,
    unknownCount: result.unknownCount || 0,
    transferLikeCount: result.transferLikeCount || 0,
    swapLikeCount: result.swapLikeCount || 0,
    classificationCounts: result.classificationCounts || {},
  };
  refreshWalletState();
  renderWalletSyncSummary();
}

async function handleProcess() {
  const files = Array.from(dom.files.files || []);
  const activeWallets = listRegisteredWalletAddresses({ userId: USER_ID, includeInactive: false });
  const syncedOnchainRows = listSyncedOnchainTransactions(USER_ID);

  if (!files.length && !syncedOnchainRows.length) {
    setStatus("CSV 파일을 업로드하거나 먼저 wallet on-chain sync를 실행하세요.");
    return;
  }

  setStatus("세무 증빙 복원 파이프라인을 실행 중입니다...");
  dom.downloadBtn.disabled = true;
  dom.downloadNarrativePdfBtn.disabled = true;
  dom.downloadNarrativeJsonBtn.disabled = true;

  try {
    clearUnifiedTransactions();
    clearRealizedProfitLots();

    const combinedRows = [];
    const detectedFileTypes = [];
    let parsedRowCount = 0;

    for (const file of files) {
      const text = await file.text();
      const parsed = parseCsv(text, file.name);
      if (!parsed.rows.length) continue;

      parsedRowCount += parsed.rows.length;
      const parser = selectParser(parsed.detectedFileType, parsed.headers, file.name);
      if (!parser) {
        throw new Error(`지원하지 않는 포맷입니다: ${file.name}`);
      }

      const normalizedRows = parser.parseRows(parsed.rows, file.name, { userId: USER_ID });
      combinedRows.push(...normalizedRows);
      detectedFileTypes.push({
        fileName: file.name,
        type: parsed.detectedFileType,
        parsedRows: parsed.rows.length,
        normalizedRows: normalizedRows.length,
      });
    }

    combinedRows.push(...syncedOnchainRows);

    if (!combinedRows.length) {
      throw new Error("정규화된 unified transaction이 없습니다.");
    }

    insertUnifiedTransactions(combinedRows);
    const ownershipEnriched = annotateTransactionsWithOwnership(listUnifiedTransactions(), activeWallets);
    const classifiedRows = classifyOnchainUnifiedTransactions(ownershipEnriched);

    const transferMatched = matchTransfers(classifiedRows, { userOwnedAddresses: activeWallets });
    const pricing = await enrichTransactionsWithPricing(transferMatched.transactions);
    const realized = calculateRealizedProfit(pricing.transactions, USER_ID);

    const matchedUnified = realized.unifiedTransactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    clearUnifiedTransactions();
    insertUnifiedTransactions(matchedUnified);
    const unifiedSourceOfTruth = listUnifiedTransactions();

    insertRealizedProfitLots(realized.realizedLots);
    const realizedLots = listRealizedProfitLots();

    const fxRates = buildFxRatesForExport(unifiedSourceOfTruth);
    const summary = buildTaxSummary(unifiedSourceOfTruth, realizedLots, realized.warnings);
    const narrativeReport = buildNarrativeTaxReport({
      unifiedTransactions: unifiedSourceOfTruth,
      realizedLots,
      summary,
      fxRates,
      userId: USER_ID,
    });
    const narrativePdfFile = new Blob([buildNarrativeTaxReportPdf(narrativeReport)], { type: "application/pdf" });
    const narrativeJsonFile = buildNarrativeJsonBlob(narrativeReport);

    const zipBlob = await buildZipEvidencePackage({
      unifiedTransactions: unifiedSourceOfTruth,
      realizedLots,
      fxRates,
      summary,
      narrativeReport,
    });

    state.unifiedTransactions = unifiedSourceOfTruth;
    state.realizedLots = realizedLots;
    state.summary = summary;
    state.narrativeReport = narrativeReport;
    state.packageFiles = zipBlob;
    state.narrativePdfFile = narrativePdfFile;
    state.narrativeJsonFile = narrativeJsonFile;
    state.warnings = realized.warnings;
    state.detectedFileTypes = detectedFileTypes;
    state.processing = {
      parsedRowCount,
      normalizedCount: unifiedSourceOfTruth.length,
      realizedSellCount: realized.realizedSellCount,
      transferMatching: transferMatched.stats,
      evidenceGenerated: true,
      outputFiles: OUTPUT_FILES.slice(),
      eventTypeCounts: countByEventType(unifiedSourceOfTruth),
      onchainClassificationCounts: countOnchainClassifications(unifiedSourceOfTruth),
      activeWalletCount: activeWallets.length,
      onchainRecordCount: syncedOnchainRows.length,
      csvRecordCount: combinedRows.length - syncedOnchainRows.length,
      pricing: pricing.summary,
      tax: realized.taxSummary,
      narrativeUnknownCount: narrativeReport.unknown_manual_review.total_unknown_items || 0,
      debugProof: buildDebugProof(unifiedSourceOfTruth, realizedLots, realized.taxSummary),
      negativeLotTrace: buildNegativeLotTrace(unifiedSourceOfTruth, realizedLots),
    };

    renderSummary(state.processing, summary);
    renderLedgerPreview(unifiedSourceOfTruth);
    renderTransferReview(transferMatched);
    renderNarrativePreview(narrativeReport);

    dom.downloadBtn.disabled = false;
    dom.downloadNarrativePdfBtn.disabled = false;
    dom.downloadNarrativeJsonBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;
    dom.transferReviewCard.hidden = false;
    dom.narrativeCard.hidden = false;

    setStatus(
      [
        "처리 결과",
        `- build: ${APP_BUILD_ID}`,
        `- 감지된 파일 유형: ${detectedFileTypes.map((x) => `${x.fileName}=${x.type}`).join("; ") || "없음"}`,
        `- CSV 파싱 행 수: ${parsedRowCount}`,
        `- 동기화된 온체인 행 수: ${syncedOnchainRows.length}`,
        `- 정규화된 거래 수: ${unifiedSourceOfTruth.length}`,
        `- 등록된 활성 지갑 수: ${activeWallets.length}`,
        `- 실현손익 계산 건수: ${realized.realizedSellCount}`,
        `- 내부 전송 자동 매칭 건수: ${transferMatched.stats.matchedInternalTransferCount}`,
        `- 미매칭 입금 건수: ${transferMatched.stats.unmatchedDepositCount}`,
        `- 미매칭 출금 건수: ${transferMatched.stats.unmatchedWithdrawalCount}`,
        `- 수동 검토 필요 건수: ${transferMatched.stats.manualReviewRequiredCount}`,
        `- priced_transactions: ${pricing.summary.priced_transactions}`,
        `- missing_pricing_count: ${pricing.summary.missing_pricing_count}`,
        `- 환율 적용: ${pricing.summary.fxRateApplied}`,
        `- pricing_source: ${pricing.summary.pricing_source}`,
        `- 자본이득: ${format(realized.taxSummary.total_capital_gain_krw)} KRW`,
        `- 에어드랍 소득: ${format(realized.taxSummary.total_airdrop_income_krw)} KRW`,
        `- 스테이킹 소득: ${format(realized.taxSummary.total_staking_income_krw)} KRW`,
        `- DeFi 소득: ${format(realized.taxSummary.total_defi_income_krw)} KRW`,
        `- 총 과세대상: ${format(realized.taxSummary.total_taxable_income_krw)} KRW`,
        ...formatDebugProofLines(state.processing.debugProof),
        ...formatNegativeLotTraceLines(state.processing.negativeLotTrace),
        `- 비과세 내부이동 건수: ${realized.taxSummary.total_non_taxable_transfers}`,
        `- 수동 검토 UNKNOWN 건수: ${realized.taxSummary.unknown_income_events}`,
        `- 내러티브 수동 검토 항목: ${narrativeReport.unknown_manual_review.total_unknown_items || 0}`,
        ...formatClassificationSummaryLines(state.processing.onchainClassificationCounts),
        ...formatEventCountLines(state.processing.eventTypeCounts),
        "- 증빙 파일 생성: 성공",
        `- 생성된 증빙 파일 목록: ${OUTPUT_FILES.join(", ")}`,
      ].join("\n")
    );
  } catch (error) {
    setStatus(`처리에 실패했습니다: ${error.message}`);
    console.error(error);
  }
}

function renderSummary(processing, summary) {
  const counts = processing.eventTypeCounts || {};
  const pricingCard = buildPricingSourceCard(processing.pricing);
  const items = [
    ["build", APP_BUILD_ID],
    ["CSV 행 수", processing.parsedRowCount],
    ["온체인 행 수", processing.onchainRecordCount],
    ["정규화된 거래 수", processing.normalizedCount],
    ["등록된 활성 지갑", processing.activeWalletCount],
    ["실현손익 계산 건수", processing.realizedSellCount],
    ["TRANSFER_IN", counts.TRANSFER_IN || 0],
    ["TRANSFER_OUT", counts.TRANSFER_OUT || 0],
    ["SWAP", counts.SWAP || 0],
    ["APPROVAL", counts.APPROVAL || 0],
    ["UNKNOWN", counts.UNKNOWN || 0],
    ["내부 전송 자동 매칭", processing.transferMatching?.matchedInternalTransferCount || 0],
    ["수동 검토 필요", processing.transferMatching?.manualReviewRequiredCount || 0],
    ["priced_transactions", processing.pricing?.priced_transactions || 0],
    ["missing_pricing_count", processing.pricing?.missing_pricing_count || 0],
    pricingCard,
    ["capital_gain_krw", format(processing.tax?.capital_gain_krw || 0)],
    ["airdrop_income_krw", format(processing.tax?.airdrop_income_krw || 0)],
    ["staking_income_krw", format(processing.tax?.staking_income_krw || 0)],
    ["defi_income_krw", format(processing.tax?.defi_income_krw || 0)],
    ["total_taxable_income_krw", format(processing.tax?.total_taxable_income_krw || 0)],
    ["내러티브 수동검토", processing.narrativeUnknownCount || 0],
    ["On-chain SWAP", processing.onchainClassificationCounts?.SWAP || 0],
    ["On-chain AIRDROP", processing.onchainClassificationCounts?.AIRDROP || 0],
    ["On-chain STAKING", processing.onchainClassificationCounts?.STAKING_REWARD || 0],
    ["On-chain DEFI", processing.onchainClassificationCounts?.DEFI_REWARD || 0],
    ["총 거래 건수", summary.totalTransactionCount],
    ["순이익 (KRW)", format(summary.netTradingProfitKrw)],
    ["총 과세대상 (KRW)", format(summary.totalTaxableAmountKrw)],
    ["증빙 파일 생성", processing.evidenceGenerated ? "성공" : "실패"],
  ];

  dom.statsGrid.innerHTML = items
    .map((item) => {
      const [label, value, detail] = Array.isArray(item) ? item : [item.label, item.value, item.detail];
      const titleAttr = detail ? ` title="${escapeHtml(String(detail))}"` : "";
      return `<div class="stat-item"${titleAttr}><div class="label">${escapeHtml(String(label))}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
    })
    .join("");
}

function buildPricingSourceCard(pricing = {}) {
  const raw = String(pricing?.pricing_source || "MISSING");
  if (!raw || raw === "MISSING") return ["pricing_source", "MISSING", "No priced transactions"];
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const shortLabel = parts.length <= 1 ? classifyPricingSourceLabel(parts[0]) : "Mixed sources";
  return ["pricing_source", shortLabel, raw];
}

function classifyPricingSourceLabel(source) {
  const value = String(source || "");
  if (value.includes("TRADE_EXECUTION_PRICE")) return "Trade execution price";
  if (value.includes("BINANCE_KLINES") || value.includes("FRANKFURTER")) return "Historical price service";
  if (value.includes("USD_STABLE_PARITY")) return "Trade execution price";
  return "Historical price service";
}

function renderLedgerPreview(unifiedTransactions) {
  const rows = unifiedTransactions
    .slice(0, 30)
    .map((tx) => {
      const chainLabel = [tx.chain_family, tx.chain].filter(Boolean).join(" / ");
      const assetLabel = tx.asset_in === tx.asset_out ? tx.asset_in : `${tx.asset_out || ""} -> ${tx.asset_in || ""}`;
      const quantity = tx.amount_in || tx.amount_out || "";
      const ownedLabel = tx.involves_user_owned_address ? "YES" : "NO";
      return `<tr><td>${escapeHtml(tx.timestamp)}</td><td>${escapeHtml(tx.source_type)}</td><td>${escapeHtml(tx.source_name || tx.exchange || "")}</td><td>${escapeHtml(tx.event_type)}</td><td>${escapeHtml(chainLabel)}</td><td>${escapeHtml(assetLabel)}</td><td>${escapeHtml(String(round(quantity)))}</td><td>${escapeHtml(ownedLabel)}</td><td>${escapeHtml(tx.source_file || tx.tx_hash || "")}</td></tr>`;
    })
    .join("");

  dom.ledgerPreview.innerHTML = rows;
}

function renderTransferReview(transferMatched) {
  const groups = transferMatched.groups || [];
  const lines = groups.slice(0, 20).map(
    (g) =>
      `- ${g.transfer_group_id} | ${g.asset} ${g.amount} | ${g.outgoing_source} -> ${g.incoming_destination} | ${g.time_difference_hours}h | ${g.confidence} | ${g.transfer_match_reason}`
  );
  const reviewLines = lines.length ? lines.join("\n") : "- 매칭 요약 없음";
  dom.transferReviewSummary.textContent = reviewLines;
}

function renderNarrativePreview(report) {
  if (!report) {
    dom.narrativePreview.textContent = "내러티브 리포트가 아직 생성되지 않았습니다.";
    return;
  }

  const overview = report.report_overview;
  const flow = report.asset_flow_summary?.paragraphs || [];
  const internal = report.internal_transfer_summary;
  const airdrop = report.airdrop_income_summary?.items?.[0];
  const unknown = report.unknown_manual_review;

  dom.narrativePreview.textContent = [
    `[Report Overview]`,
    `${overview.narrative}`,
    `- 사용자: ${overview.user_identifier}`,
    `- 과세연도: ${overview.tax_year}`,
    `- 총 거래 수: ${overview.total_transaction_count}`,
    `- 과세 이벤트 수: ${overview.total_taxable_events}`,
    `- 수동 검토 항목: ${overview.total_unknown_manual_review_events}`,
    "",
    `[User Asset Flow Summary]`,
    ...(flow.length ? flow.map((line) => `- ${line}`) : ["- 요약 가능한 자산 흐름이 없습니다."]),
    "",
    `[Internal Transfer Summary]`,
    ...(internal.paragraphs || []).map((line) => `- ${line}`),
    "",
    `[Airdrop Income Summary]`,
    airdrop
      ? `- ${airdrop.asset} ${airdrop.amount} | ${airdrop.wallet} | ${format(Number(airdrop.income_krw) || 0)} KRW`
      : "- 에어드랍 소득 없음",
    "",
    `[Unknown / Manual Review]`,
    unknown.total_unknown_items
      ? `- ${unknown.total_unknown_items}건 존재. 예시: ${(unknown.items[0]?.tx_hash || "(no hash)")}`
      : "- 수동 검토 항목 없음",
  ].join("\n");
}

function renderWalletChainFamilyOptions() {
  dom.walletChainFamily.innerHTML = Object.values(CHAIN_FAMILIES)
    .map((family) => `<option value="${family}">${family}</option>`)
    .join("");
  if (!dom.walletChainFamily.value) {
    dom.walletChainFamily.value = CHAIN_FAMILIES.EVM;
  }
}

function renderWalletChainOptions() {
  const family = dom.walletChainFamily.value || CHAIN_FAMILIES.EVM;
  const chains = SUPPORTED_CHAINS[family] || [];
  const current = dom.walletChain.value;
  dom.walletChain.innerHTML = chains
    .map((chain) => `<option value="${chain}">${chain}</option>`)
    .join("");
  dom.walletChain.value = chains.includes(current) ? current : chains[0] || "";
}

function refreshWalletState() {
  state.walletAddresses = listWalletAddresses({ userId: USER_ID, includeInactive: true });
  state.onchainTransactions = listOnchainTransactions().filter((row) => row.user_id === USER_ID);
  state.syncJobs = buildWalletSyncStatusMap();
  renderWalletImportStatus();
  renderWalletSyncSummary();
  renderWalletList();
}

function renderWalletImportStatus() {
  const active = state.walletAddresses.filter((row) => row.is_active);
  const inactive = state.walletAddresses.length - active.length;
  const evmCount = active.filter((row) => row.chain_family === CHAIN_FAMILIES.EVM).length;
  const solanaCount = active.filter((row) => row.chain_family === CHAIN_FAMILIES.SOLANA).length;
  const onchainCount = state.onchainTransactions.length;

  dom.walletImportStatus.textContent = [
    `- 활성 지갑 주소: ${active.length}`,
    `- 비활성 지갑 주소: ${inactive}`,
    `- EVM wallets: ${evmCount}`,
    `- Solana wallets: ${solanaCount}`,
    `- synced on-chain unified rows: ${onchainCount}`,
  ].join("\n");
}

function renderWalletSyncSummary() {
  if (!state.lastSyncSummary) {
    dom.walletSyncSummary.textContent = "- 아직 실행된 wallet sync가 없습니다.";
    return;
  }

  dom.walletSyncSummary.textContent = [
    `- sync wallets: ${state.lastSyncSummary.walletCount}`,
    `- imported on-chain records: ${state.lastSyncSummary.importedCount}`,
    `- updated existing records: ${state.lastSyncSummary.updatedCount}`,
    `- skipped duplicates: ${state.lastSyncSummary.skippedCount}`,
    `- unknown transactions: ${state.lastSyncSummary.unknownCount}`,
    `- transfer-like transactions: ${state.lastSyncSummary.transferLikeCount}`,
    `- swap-like transactions: ${state.lastSyncSummary.swapLikeCount}`,
    ...formatClassificationSummaryLines(state.lastSyncSummary.classificationCounts || {}),
  ].join("\n");
}

function renderWalletList() {
  if (!state.walletAddresses.length) {
    dom.walletList.innerHTML = '<div class="empty-state">등록된 지갑 주소가 없습니다.</div>';
    return;
  }

  const rows = state.walletAddresses.map((row) => {
    const latestJob = state.syncJobs.get(row.id) || null;
    const statusTone = row.is_active ? "success" : "muted";
    const label = row.label || "(label 없음)";
    return `
      <tr>
        <td>${escapeHtml(row.chain_family)}</td>
        <td>${escapeHtml(row.chain)}</td>
        <td class="wallet-address-cell">${escapeHtml(row.wallet_address)}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(row.address_type)}</td>
        <td><span class="badge" data-tone="${statusTone}">${row.is_active ? "ACTIVE" : "DISABLED"}</span></td>
        <td>${escapeHtml(row.verification_status)}</td>
        <td>${escapeHtml(latestJob?.status || "NEVER_SYNCED")}</td>
        <td>${escapeHtml(latestJob?.finished_at || "")}</td>
        <td class="wallet-actions">
          ${row.is_active ? `<button type="button" data-action="sync" data-id="${row.id}" class="secondary-btn">Sync</button>` : ""}
          ${row.is_active ? `<button type="button" data-action="disable" data-id="${row.id}" class="secondary-btn">비활성화</button>` : ""}
          <button type="button" data-action="remove" data-id="${row.id}" class="ghost-btn">삭제</button>
        </td>
      </tr>
    `;
  }).join("");

  dom.walletList.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Chain Family</th>
            <th>Chain</th>
            <th>Wallet Address</th>
            <th>Label</th>
            <th>Type</th>
            <th>Status</th>
            <th>Verification</th>
            <th>Last Sync Status</th>
            <th>Last Sync Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function handleDownload() {
  if (!state.packageFiles) return;
  downloadBlob(state.packageFiles, "tax_evidence_package.zip");
}

function handleDownloadNarrativePdf() {
  if (!state.narrativePdfFile) return;
  downloadBlob(state.narrativePdfFile, "narrative_tax_report.pdf");
}

function handleDownloadNarrativeJson() {
  if (!state.narrativeJsonFile) return;
  downloadBlob(state.narrativeJsonFile, "narrative_tax_report.json");
}

function persistWalletRegistry() {
  const rows = listWalletAddresses({ userId: USER_ID, includeInactive: true });
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(rows));
}

function persistOnchainTransactions() {
  localStorage.setItem(ONCHAIN_STORAGE_KEY, JSON.stringify(listOnchainTransactions()));
}

function persistWalletSyncJobs() {
  const rows = listWalletSyncStatuses();
  localStorage.setItem(SYNC_JOBS_STORAGE_KEY, JSON.stringify(rows));
  hydrateWalletSyncJobs(rows);
}

function selectParser(detectedFileType, headers, fileName) {
  const byType = {
    [FILE_TYPES.SPOT_TRADE_HISTORY]: "binance_spot_trade_parser",
    [FILE_TYPES.TRANSACTION_HISTORY]: "binance_transaction_history_parser",
    [FILE_TYPES.DISTRIBUTION_HISTORY]: "binance_distribution_history_parser",
    [FILE_TYPES.EARN_STAKING_REWARDS_HISTORY]: "binance_earn_staking_rewards_parser",
  };

  const id = byType[detectedFileType];
  if (id) {
    return PARSER_REGISTRY.find((parser) => parser.id === id) || null;
  }

  if (canParseBinanceSpotTrade(headers, fileName)) {
    return PARSER_REGISTRY.find((parser) => parser.id === "binance_spot_trade_parser") || null;
  }

  for (const parser of PARSER_REGISTRY) {
    if (parser.canParse && parser.canParse(headers, fileName)) return parser;
  }

  return null;
}

function parseCsv(text, fileName = "") {
  const csvRows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '"') {
      const nextCh = text[i + 1];
      if (inQuotes && nextCh === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value.trim());
      value = "";
      if (row.some((cell) => cell !== "")) csvRows.push(row);
      row = [];
      continue;
    }

    value += ch;
  }

  if (value.length || row.length) {
    row.push(value.trim());
    if (row.some((cell) => cell !== "")) csvRows.push(row);
  }

  if (csvRows.length < 2) {
    return { headers: [], rows: [], detectedFileType: FILE_TYPES.UNKNOWN };
  }

  const { headerRowIndex, fileType } = detect_binance_header_row(csvRows);
  const rawHeaders = csvRows[headerRowIndex] || [];
  const rowsAfterHeader = csvRows.slice(headerRowIndex + 1);

  const headers = rawHeaders.map((h) => normalizeHeader(h));
  const mappedRows = rowsAfterHeader
    .filter((cells) => cells.some((cell) => String(cell || "").trim() !== ""))
    .map((cells, idx) => {
      const obj = {};
      for (let i = 0; i < headers.length; i += 1) {
        obj[headers[i]] = cells[i] || "";
      }
      obj.__raw_row_index = headerRowIndex + idx + 2;
      return obj;
    });

  const detectedFileType =
    fileType !== FILE_TYPES.UNKNOWN
      ? fileType
      : detect_binance_file_type(rawHeaders, rowsAfterHeader.slice(0, 5));

  if (detectedFileType === FILE_TYPES.UNKNOWN && fileName.toLowerCase().includes("binance")) {
    return { headers, rows: mappedRows, detectedFileType: FILE_TYPES.TRANSACTION_HISTORY };
  }

  return { headers, rows: mappedRows, detectedFileType };
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\uFEFF]/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function countByEventType(unifiedTransactions) {
  const counts = {};
  for (const tx of unifiedTransactions) {
    const type = tx.event_type || "UNKNOWN";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function formatEventCountLines(counts) {
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `- ${key} count: ${value}`);
}

function countOnchainClassifications(unifiedTransactions) {
  const counts = {};
  for (const tx of unifiedTransactions) {
    if (tx.source_type !== "WALLET_ONCHAIN") continue;
    const type = tx.event_type || "UNKNOWN";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function formatClassificationSummaryLines(counts) {
  if (!counts || !Object.keys(counts).length) return [];
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `- On-chain ${key}: ${value}`);
}

function buildDebugProof(unifiedTransactions, realizedLots, taxSummary) {
  return {
    normalizedBuy: pickNormalizedTradeExample(unifiedTransactions, "TRADE_BUY"),
    normalizedSell: pickNormalizedTradeExample(unifiedTransactions, "TRADE_SELL"),
    btcFifoMatch: pickLotExample(realizedLots, "BTC"),
    ethFifoMatch: pickLotExample(realizedLots, "ETH"),
    airdropValuation: pickIncomeExample(unifiedTransactions, "AIRDROP"),
    stakingValuation: pickIncomeExample(unifiedTransactions, "STAKING_REWARD"),
    finalTotals: {
      capital_gain_krw: taxSummary.capital_gain_krw,
      airdrop_income_krw: taxSummary.airdrop_income_krw,
      staking_income_krw: taxSummary.staking_income_krw,
      defi_income_krw: taxSummary.defi_income_krw,
      total_taxable_income_krw: taxSummary.total_taxable_income_krw,
    },
  };
}

function pickNormalizedTradeExample(unifiedTransactions, eventType) {
  const tx = unifiedTransactions.find((row) => row.event_type === eventType);
  if (!tx) return null;
  return {
    id: tx.id,
    event_type: tx.event_type,
    asset_in: tx.asset_in,
    amount_in: round(tx.amount_in),
    asset_out: tx.asset_out,
    amount_out: round(tx.amount_out),
    price_usdt: round(tx.price_usdt),
    price_krw: round(tx.price_krw),
    amount_in_krw: round(tx.amount_in_krw),
    amount_out_krw: round(tx.amount_out_krw),
  };
}

function pickLotExample(realizedLots, asset) {
  const lot = realizedLots.find((row) => row.asset === asset);
  if (!lot) return null;
  return {
    asset: lot.asset,
    matched_amount: round(lot.matched_amount || lot.sell_amount),
    buy_price_usdt: round(lot.buy_price_usdt),
    sell_price_usdt: round(lot.sell_price_usdt),
    buy_price_krw: round(lot.buy_price_krw),
    sell_price_krw: round(lot.sell_price_krw),
    profit_usdt: round(lot.profit_usdt),
    profit_krw: round(lot.profit_krw),
  };
}

function pickIncomeExample(unifiedTransactions, eventType) {
  const tx = unifiedTransactions.find((row) => row.event_type === eventType && Number.isFinite(Number(row.price_krw)));
  if (!tx) return null;
  const receivedAmount = Number(tx.amount_in);
  const priceKrw = Number(tx.price_krw);
  return {
    asset: tx.asset_in,
    received_amount: round(receivedAmount),
    price_krw_at_receive: round(priceKrw),
    income_krw: round(Number.isFinite(receivedAmount) && Number.isFinite(priceKrw) ? receivedAmount * priceKrw : tx.amount_in_krw),
  };
}

function formatDebugProofLines(debugProof) {
  if (!debugProof) return [];
  return [
    `- normalized BUY example: ${formatDebugEntry(debugProof.normalizedBuy)}`,
    `- normalized SELL example: ${formatDebugEntry(debugProof.normalizedSell)}`,
    `- BTC FIFO match example: ${formatDebugEntry(debugProof.btcFifoMatch)}`,
    `- ETH FIFO match example: ${formatDebugEntry(debugProof.ethFifoMatch)}`,
    `- AIRDROP valuation example: ${formatDebugEntry(debugProof.airdropValuation)}`,
    `- STAKING_REWARD valuation example: ${formatDebugEntry(debugProof.stakingValuation)}`,
    `- final summary totals: ${formatDebugEntry(debugProof.finalTotals)}`,
  ];
}

function formatDebugEntry(entry) {
  if (!entry) return "not available";
  return Object.entries(entry)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function buildNegativeLotTrace(unifiedTransactions, realizedLots) {
  const byId = new Map(unifiedTransactions.map((tx) => [tx.id, tx]));
  const negativeLots = realizedLots
    .filter((lot) => Number(lot.profit_krw) < 0)
    .sort((a, b) => Number(a.profit_krw) - Number(b.profit_krw))
    .slice(0, 10)
    .map((lot) => {
      const buyTx = byId.get(lot.buy_transaction_id) || null;
      const sellTx = byId.get(lot.sell_transaction_id) || null;
      return {
        asset: lot.asset,
        profit_krw: round(lot.profit_krw),
        matched_amount: round(lot.matched_amount || lot.sell_amount),
        buy_transaction_id: lot.buy_transaction_id,
        sell_transaction_id: lot.sell_transaction_id,
        buy_event_type: buyTx?.event_type || lot.buy_event_type,
        sell_event_type: sellTx?.event_type || lot.sell_event_type,
        buy_asset_in: buyTx?.asset_in || "",
        buy_amount_in: round(buyTx?.amount_in),
        buy_asset_out: buyTx?.asset_out || "",
        buy_amount_out: round(buyTx?.amount_out),
        sell_asset_in: sellTx?.asset_in || "",
        sell_amount_in: round(sellTx?.amount_in),
        sell_asset_out: sellTx?.asset_out || "",
        sell_amount_out: round(sellTx?.amount_out),
        buy_price_krw: round(lot.buy_price_krw),
        sell_price_krw: round(lot.sell_price_krw),
      };
    });

  return {
    negativeLotCount: negativeLots.length,
    rows: negativeLots,
  };
}

function formatNegativeLotTraceLines(trace) {
  if (!trace || !trace.rows?.length) return ["- negative lot trace: none"];
  return [
    `- negative lot trace count: ${trace.negativeLotCount}`,
    ...trace.rows.map((row, index) => `- negative lot ${index + 1}: ${formatDebugEntry(row)}`),
  ];
}

function buildWalletFormMessage(result) {
  if (result.code === "INVALID_ADDRESS") {
    return `invalid address: ${result.message}`;
  }
  if (result.code === "DUPLICATE_ADDRESS") {
    return `duplicate address: ${result.address?.wallet_address || result.validation?.normalizedAddress || ""}`;
  }
  return result.message;
}

function setStatus(text) {
  dom.status.textContent = text;
}

function setInlineMessage(element, text, tone = "muted") {
  element.textContent = text;
  element.dataset.tone = tone;
}

function format(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}

function round(value) {
  if (!Number.isFinite(Number(value))) return "";
  return Math.round((Number(value) + Number.EPSILON) * 100000000) / 100000000;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function downloadBlob(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
