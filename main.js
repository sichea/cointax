import { buildZipEvidencePackage, OUTPUT_FILES } from "./exports/zip_package_exporter.js";
import { matchTransfers } from "./matchers/transfer_matcher.js";
import { canParseBinanceSpotTrade, parseBinanceSpotTradeRows } from "./parsers/binance_spot_trade_parser.js";
import {
  canParseBinanceTransactionHistory,
  parseBinanceTransactionHistoryRows,
} from "./parsers/binance_transaction_history_parser.js";
import { canParseBybit, parseBybitRows } from "./parsers/bybit_parser.js";
import { collectWalletImportRequests, parseWalletImportPlaceholder } from "./parsers/wallet_import_placeholder.js";
import { buildFxRatesForExport } from "./pricing/fx_rate_service.js";
import { calculateRealizedProfit } from "./calculators/realized_profit_calculator.js";
import { buildTaxSummary } from "./reports/tax_summary_report.js";
import { clearUnifiedTransactions, insertUnifiedTransactions, listUnifiedTransactions } from "./db/unified_transactions_table.js";
import { clearRealizedProfitLots, insertRealizedProfitLots, listRealizedProfitLots } from "./db/realized_profit_lots_table.js";

const THEME_STORAGE_KEY = "tax-evidence-theme";

const state = {
  unifiedTransactions: [],
  realizedLots: [],
  summary: null,
  packageFiles: null,
  warnings: [],
  processing: null,
};

const PARSER_REGISTRY = [
  {
    id: "binance_spot_trade_parser",
    canParse: canParseBinanceSpotTrade,
    parseRows: parseBinanceSpotTradeRows,
  },
  {
    id: "binance_transaction_history_parser",
    canParse: canParseBinanceTransactionHistory,
    parseRows: parseBinanceTransactionHistoryRows,
  },
  {
    id: "bybit_parser",
    canParse: canParseBybit,
    parseRows: parseBybitRows,
  },
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
    setStatus("지갑 온체인 가져오기는 준비 중입니다. 현재 Binance Spot Trade CSV를 함께 업로드해 주세요.");
    return;
  }

  setStatus("세무 증빙 복원 파이프라인을 실행 중입니다...");
  dom.downloadBtn.disabled = true;

  try {
    clearUnifiedTransactions();
    clearRealizedProfitLots();

    const unifiedRows = [];
    let parsedRowCount = 0;

    for (const file of files) {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.rows.length) continue;

      parsedRowCount += parsed.rows.length;
      const parser = selectParser(parsed.headers, file.name);
      if (!parser) {
        throw new Error(`지원하지 않는 포맷입니다: ${file.name}`);
      }

      const normalizedRows = parser.parseRows(parsed.rows, file.name, { userId: "demo-user" });
      unifiedRows.push(...normalizedRows);
    }

    unifiedRows.push(...parseWalletImportPlaceholder(walletRequests));

    if (!unifiedRows.length) {
      throw new Error("정규화된 unified transaction이 없습니다.");
    }

    insertUnifiedTransactions(unifiedRows);
    const normalizedFromTable = listUnifiedTransactions();
    const transferMatched = matchTransfers(normalizedFromTable);
    const realized = calculateRealizedProfit(transferMatched, "demo-user");

    const unifiedTransactions = realized.unifiedTransactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    clearUnifiedTransactions();
    insertUnifiedTransactions(unifiedTransactions);
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
    state.processing = {
      parsedRowCount,
      normalizedCount: unifiedSourceOfTruth.length,
      realizedSellCount: realized.realizedSellCount,
      evidenceGenerated: true,
      outputFiles: OUTPUT_FILES.slice(),
    };

    renderSummary(state.processing, summary);
    renderLedgerPreview(unifiedSourceOfTruth);

    dom.downloadBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;

    setStatus(
      [
        "처리 결과",
        `- 파싱된 행 수: ${parsedRowCount}`,
        `- 정규화된 거래 수: ${unifiedSourceOfTruth.length}`,
        `- 실현손익 계산 건수: ${realized.realizedSellCount}`,
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
  const items = [
    ["파싱된 행 수", processing.parsedRowCount],
    ["정규화된 거래 수", processing.normalizedCount],
    ["실현손익 계산 건수", processing.realizedSellCount],
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
        `<tr><td>${tx.timestamp}</td><td>${tx.source_type}</td><td>${tx.exchange}</td><td>${tx.event_type}</td><td>${tx.asset_in}/${tx.asset_out}</td><td>${round(tx.amount_in)}</td><td>${round(tx.price_usdt)}</td><td>${round(tx.price_krw)}</td><td>${tx.source_file}</td></tr>`
    )
    .join("");

  dom.ledgerPreview.innerHTML = rows;
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

function selectParser(headers, fileName) {
  for (const parser of PARSER_REGISTRY) {
    if (parser.canParse(headers, fileName)) return parser;
  }
  return null;
}

function parseCsv(text) {
  const rows = [];
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
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }

    value += ch;
  }

  if (value.length || row.length) {
    row.push(value.trim());
    if (row.some((cell) => cell !== "")) rows.push(row);
  }

  if (rows.length < 2) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => normalizeHeader(h));
  const mappedRows = rows.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = cells[i] || "";
    }
    return obj;
  });

  return { headers, rows: mappedRows };
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
