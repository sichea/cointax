import { buildZipEvidencePackage, OUTPUT_FILES } from "./exports/zip_package_exporter.js";
import { matchTransfers } from "./matchers/transfer_matcher.js";
import { canParseBinanceSpotTrade, parseBinanceSpotTradeRows } from "./parsers/binance_spot_trade_parser.js";
import { parseBinanceTransactionHistoryRows } from "./parsers/binance_transaction_history_parser.js";
import { parseBinanceDistributionHistoryRows } from "./parsers/binance_distribution_history_parser.js";
import { parseBinanceEarnStakingRewardsRows } from "./parsers/binance_earn_staking_rewards_parser.js";
import { canParseBybit, parseBybitRows } from "./parsers/bybit_parser.js";
import { collectWalletImportRequests, parseWalletImportPlaceholder } from "./parsers/wallet_import_placeholder.js";
import { buildFxRatesForExport } from "./pricing/fx_rate_service.js";
import { calculateRealizedProfit } from "./calculators/realized_profit_calculator.js";
import { buildTaxSummary } from "./reports/tax_summary_report.js";
import { clearUnifiedTransactions, insertUnifiedTransactions, listUnifiedTransactions } from "./db/unified_transactions_table.js";
import { clearRealizedProfitLots, insertRealizedProfitLots, listRealizedProfitLots } from "./db/realized_profit_lots_table.js";
import { detect_binance_file_type, detect_binance_header_row, FILE_TYPES } from "./parsers/binance_file_type_detector.js";

const THEME_STORAGE_KEY = "tax-evidence-theme";

const state = {
  unifiedTransactions: [],
  realizedLots: [],
  summary: null,
  packageFiles: null,
  warnings: [],
  processing: null,
  detectedFileTypes: [],
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
  themeToggle: document.getElementById("themeToggle"),
  evmWalletAddress: document.getElementById("evmWalletAddress"),
  solanaWalletAddress: document.getElementById("solanaWalletAddress"),
  status: document.getElementById("status"),
  statsCard: document.getElementById("statsCard"),
  statsGrid: document.getElementById("statsGrid"),
  previewCard: document.getElementById("previewCard"),
  ledgerPreview: document.getElementById("ledgerPreview"),
  transferReviewCard: document.getElementById("transferReviewCard"),
  transferReviewSummary: document.getElementById("transferReviewSummary"),
};

initTheme();
dom.processBtn.addEventListener("click", handleProcess);
dom.downloadBtn.addEventListener("click", handleDownload);
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

async function handleProcess() {
  const files = Array.from(dom.files.files || []);
  const walletRequests = collectWalletImportRequests({
    evmAddress: dom.evmWalletAddress?.value,
    solanaAddress: dom.solanaWalletAddress?.value,
  });

  if (!files.length && !walletRequests.length) {
    setStatus("CSV 파일 또는 지갑 주소를 입력하세요.");
    return;
  }

  if (!files.length && walletRequests.length) {
    setStatus("지갑 온체인 가져오기는 준비 중입니다. 현재 Binance CSV를 함께 업로드해 주세요.");
    return;
  }

  setStatus("세무 증빙 복원 파이프라인을 실행 중입니다...");
  dom.downloadBtn.disabled = true;

  try {
    clearUnifiedTransactions();
    clearRealizedProfitLots();

    const unifiedRows = [];
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

      const normalizedRows = parser.parseRows(parsed.rows, file.name, { userId: "demo-user" });
      unifiedRows.push(...normalizedRows);
      detectedFileTypes.push({
        fileName: file.name,
        type: parsed.detectedFileType,
        parsedRows: parsed.rows.length,
        normalizedRows: normalizedRows.length,
      });
    }

    unifiedRows.push(...parseWalletImportPlaceholder(walletRequests));

    if (!unifiedRows.length) {
      throw new Error("정규화된 unified transaction이 없습니다.");
    }

    insertUnifiedTransactions(unifiedRows);
    const normalizedFromTable = listUnifiedTransactions();

    const transferMatched = matchTransfers(normalizedFromTable);
    const realized = calculateRealizedProfit(transferMatched.transactions, "demo-user");

    const matchedUnified = realized.unifiedTransactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    clearUnifiedTransactions();
    insertUnifiedTransactions(matchedUnified);
    const unifiedSourceOfTruth = listUnifiedTransactions();

    insertRealizedProfitLots(realized.realizedLots);
    const realizedLots = listRealizedProfitLots();

    const fxRates = buildFxRatesForExport(unifiedSourceOfTruth);
    const summary = buildTaxSummary(unifiedSourceOfTruth, realizedLots, realized.warnings);

    const zipBlob = await buildZipEvidencePackage({
      unifiedTransactions: unifiedSourceOfTruth,
      realizedLots,
      fxRates,
      summary,
    });

    state.unifiedTransactions = unifiedSourceOfTruth;
    state.realizedLots = realizedLots;
    state.summary = summary;
    state.packageFiles = zipBlob;
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
    };

    renderSummary(state.processing, summary);
    renderLedgerPreview(unifiedSourceOfTruth);
    renderTransferReview(transferMatched);

    dom.downloadBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;
    dom.transferReviewCard.hidden = false;

    setStatus(
      [
        "처리 결과",
        `- 감지된 파일 유형: ${detectedFileTypes.map((x) => `${x.fileName}=${x.type}`).join("; ")}`,
        `- 파싱된 행 수: ${parsedRowCount}`,
        `- 정규화된 거래 수: ${unifiedSourceOfTruth.length}`,
        `- 실현손익 계산 건수: ${realized.realizedSellCount}`,
        `- 내부 전송 자동 매칭 건수: ${transferMatched.stats.matchedInternalTransferCount}`,
        `- 미매칭 입금 건수: ${transferMatched.stats.unmatchedDepositCount}`,
        `- 미매칭 출금 건수: ${transferMatched.stats.unmatchedWithdrawalCount}`,
        `- 수동 검토 필요 건수: ${transferMatched.stats.manualReviewRequiredCount}`,
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
  const items = [
    ["파싱된 행 수", processing.parsedRowCount],
    ["정규화된 거래 수", processing.normalizedCount],
    ["실현손익 계산 건수", processing.realizedSellCount],
    ["TRADE_BUY", counts.TRADE_BUY || 0],
    ["TRADE_SELL", counts.TRADE_SELL || 0],
    ["AIRDROP", counts.AIRDROP || 0],
    ["STAKING_REWARD", counts.STAKING_REWARD || 0],
    ["DEFI_REWARD", counts.DEFI_REWARD || 0],
    ["DEPOSIT", counts.DEPOSIT || 0],
    ["WITHDRAWAL", counts.WITHDRAWAL || 0],
    ["INTERNAL_TRANSFER", counts.INTERNAL_TRANSFER || 0],
    ["UNKNOWN", counts.UNKNOWN || 0],
    ["내부 전송 자동 매칭", processing.transferMatching?.matchedInternalTransferCount || 0],
    ["수동 검토 필요", processing.transferMatching?.manualReviewRequiredCount || 0],
    ["총 거래 건수", summary.totalTransactionCount],
    ["순이익 (KRW)", format(summary.netTradingProfitKrw)],
    ["총 과세대상 (KRW)", format(summary.totalTaxableAmountKrw)],
    ["증빙 파일 생성", processing.evidenceGenerated ? "성공" : "실패"],
  ];

  dom.statsGrid.innerHTML = items
    .map(([label, value]) => `<div class="stat-item"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderLedgerPreview(unifiedTransactions) {
  const rows = unifiedTransactions
    .slice(0, 30)
    .map(
      (tx) =>
        `<tr><td>${tx.timestamp}</td><td>${tx.source_type}</td><td>${tx.exchange}</td><td>${tx.event_type}</td><td>${tx.asset_in || ""}/${tx.asset_out || ""}</td><td>${round(tx.amount_in)}</td><td>${round(tx.price_usdt)}</td><td>${round(tx.price_krw)}</td><td>${tx.source_file}</td></tr>`
    )
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

function handleDownload() {
  if (!state.packageFiles) return;
  const blobUrl = URL.createObjectURL(state.packageFiles);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "tax_evidence_package.zip";
  link.click();
  URL.revokeObjectURL(blobUrl);
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
  const known = [
    "TRADE_BUY",
    "TRADE_SELL",
    "AIRDROP",
    "STAKING_REWARD",
    "DEFI_REWARD",
    "DEPOSIT",
    "WITHDRAWAL",
    "INTERNAL_TRANSFER",
    "UNKNOWN",
  ];

  const counts = {};
  for (const key of known) counts[key] = 0;

  for (const tx of unifiedTransactions) {
    const type = tx.event_type || "UNKNOWN";
    if (!(type in counts)) {
      counts.UNKNOWN += 1;
      continue;
    }
    counts[type] += 1;
  }

  return counts;
}

function formatEventCountLines(counts) {
  return [
    `- TRADE_BUY count: ${counts.TRADE_BUY || 0}`,
    `- TRADE_SELL count: ${counts.TRADE_SELL || 0}`,
    `- AIRDROP count: ${counts.AIRDROP || 0}`,
    `- STAKING_REWARD count: ${counts.STAKING_REWARD || 0}`,
    `- DEFI_REWARD count: ${counts.DEFI_REWARD || 0}`,
    `- DEPOSIT count: ${counts.DEPOSIT || 0}`,
    `- WITHDRAWAL count: ${counts.WITHDRAWAL || 0}`,
    `- INTERNAL_TRANSFER count: ${counts.INTERNAL_TRANSFER || 0}`,
    `- UNKNOWN count: ${counts.UNKNOWN || 0}`,
  ];
}

function setStatus(text) {
  dom.status.textContent = text;
}

function format(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
