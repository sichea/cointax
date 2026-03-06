import { calculateFifoRealizedPnl } from "./calculators/fifo_calculator.js";
import { buildEvidenceZip, OUTPUT_FILES } from "./exports/zip_exporter.js";
import { matchTransfers } from "./matchers/transfer_matcher.js";
import { normalizeTransactions } from "./normalizers/transaction_normalizer.js";
import { canParseBinanceSpot, parseBinanceSpotRows } from "./parsers/binance_spot_parser.js";
import { canParseBinanceTransaction, parseBinanceTransactionRows } from "./parsers/binance_transaction_parser.js";
import { canParseBybit, parseBybitRows } from "./parsers/bybit_parser.js";
import { collectWalletImportRequests, parseWalletImportsPlaceholder } from "./parsers/wallet_import_placeholder.js";
import { buildFxRates } from "./pricing/fx_rate_service.js";
import { buildTaxSummary } from "./reports/tax_summary_report.js";

const THEME_STORAGE_KEY = "tax-evidence-theme";

const state = {
  events: [],
  tradeProfitRecords: [],
  summary: null,
  packageFiles: null,
  warnings: [],
  processing: null,
  walletImportRequests: [],
};

const PARSER_REGISTRY = [
  {
    id: "binance_spot_parser",
    canParse: canParseBinanceSpot,
    parseRows: parseBinanceSpotRows,
  },
  {
    id: "binance_transaction_parser",
    canParse: canParseBinanceTransaction,
    parseRows: parseBinanceTransactionRows,
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
  const walletImportRequests = collectWalletImportRequests({
    evmAddress: dom.evmWalletAddress?.value,
    solanaAddress: dom.solanaWalletAddress?.value,
  });
  state.walletImportRequests = walletImportRequests;

  if (!files.length && !walletImportRequests.length) {
    setStatus("Binance Spot Trade History CSV 파일 또는 지갑 주소를 입력하세요.");
    return;
  }

  if (!files.length && walletImportRequests.length) {
    setStatus("지갑 온체인 가져오기는 준비 중입니다. 현재는 Binance Spot Trade History CSV를 함께 업로드해 주세요.");
    return;
  }

  setStatus("세무 증빙 복원 파이프라인을 실행 중입니다...");
  dom.downloadBtn.disabled = true;

  try {
    const rawRecords = [];
    let parsedRowCount = 0;

    for (const file of files) {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.rows.length) {
        continue;
      }

      parsedRowCount += parsed.rows.length;

      const parser = selectParser(parsed.headers, file.name);
      if (!parser) {
        throw new Error(`지원하지 않는 포맷입니다: ${file.name}. 현재 MVP는 Binance Spot Trade History CSV만 지원합니다.`);
      }

      const parsedRecords = parser.parseRows(parsed.rows, file.name);
      rawRecords.push(...parsedRecords);
    }

    const walletRecords = parseWalletImportsPlaceholder(walletImportRequests);
    rawRecords.push(...walletRecords);

    const normalizedEvents = normalizeTransactions(rawRecords);
    if (!normalizedEvents.length) {
      throw new Error("유효한 정규화 거래를 생성하지 못했습니다. CSV 헤더/값을 확인해 주세요.");
    }

    normalizedEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const fifoResult = calculateFifoRealizedPnl(normalizedEvents);
    const transferMatches = matchTransfers(normalizedEvents);
    const fxRates = buildFxRates(normalizedEvents);
    const summary = buildTaxSummary(normalizedEvents, fifoResult.records, fifoResult.warnings);

    const packageBlob = await buildEvidenceZip({
      events: normalizedEvents,
      tradeProfitRecords: fifoResult.records,
      fxRates,
      summary,
    });

    state.events = normalizedEvents;
    state.tradeProfitRecords = fifoResult.records;
    state.summary = summary;
    state.packageFiles = packageBlob;
    state.warnings = fifoResult.warnings;
    state.processing = {
      parsedRowCount,
      normalizedCount: normalizedEvents.length,
      realizedSellCount: fifoResult.realizedSellCount,
      transferMatchCount: transferMatches.length,
      walletImportRequestCount: walletImportRequests.length,
      evidenceGenerated: true,
      outputFiles: OUTPUT_FILES.slice(),
    };

    renderSummary({
      summary,
      parsedRowCount,
      normalizedCount: normalizedEvents.length,
      realizedSellCount: fifoResult.realizedSellCount,
      transferMatchCount: transferMatches.length,
      outputFiles: OUTPUT_FILES,
    });

    renderLedgerPreview(normalizedEvents);
    dom.downloadBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;

    setStatus(
      [
        "처리 결과",
        `- 파싱된 행 수: ${parsedRowCount}`,
        `- 정규화된 거래 수: ${normalizedEvents.length}`,
        `- 실현손익 계산 건수: ${fifoResult.realizedSellCount}`,
        `- 전송 매칭 건수(준비중): ${transferMatches.length}`,
        `- 지갑 주소 입력 수(준비중): ${walletImportRequests.length}`,
        "- 증빙 파일 생성: 성공",
        `- 생성된 증빙 파일 목록: ${OUTPUT_FILES.join(", ")}`,
      ].join("\n")
    );
  } catch (error) {
    setStatus(`처리에 실패했습니다: ${error.message}`);
    console.error(error);
  }
}

function selectParser(headers, fileName) {
  for (const parser of PARSER_REGISTRY) {
    if (parser.canParse(headers, fileName)) {
      return parser;
    }
  }
  return null;
}

function handleDownload() {
  if (!state.packageFiles) {
    return;
  }

  const blobUrl = URL.createObjectURL(state.packageFiles);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "tax_evidence_package.zip";
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function setStatus(text) {
  dom.status.textContent = text;
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
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(value.trim());
      value = "";
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += ch;
  }

  if (value.length || row.length) {
    row.push(value.trim());
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
  }

  if (rows.length < 2) {
    return { headers: [], rows: [] };
  }

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

function renderSummary({ summary, parsedRowCount, normalizedCount, realizedSellCount, transferMatchCount, outputFiles }) {
  const items = [
    ["파싱된 행 수", parsedRowCount],
    ["정규화된 거래 수", normalizedCount],
    ["실현손익 계산 건수", realizedSellCount],
    ["전송 매칭 건수(준비중)", transferMatchCount],
    ["총 거래 건수", summary.totalTransactionCount],
    ["순이익 (USDT)", summary.netTradingProfitUsdt],
    ["순이익 (KRW)", formatNumber(summary.netTradingProfitKrw)],
    ["총 과세대상 (KRW)", formatNumber(summary.totalTaxableAmountKrw)],
    ["증빙 파일 생성", "성공"],
    ["증빙 파일 수", outputFiles.length],
  ];

  dom.statsGrid.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="stat-item"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
}

function renderLedgerPreview(events) {
  const rows = events
    .slice(0, 30)
    .map(
      (event) =>
        `<tr><td>${event.timestamp}</td><td>${event.source_type}</td><td>${event.exchange}</td><td>${event.transaction_type}</td><td>${event.base_asset}/${event.quote_asset}</td><td>${event.amount}</td><td>${round(event.price_usdt)}</td><td>${round(event.price_krw)}</td><td>${event.source_file}</td></tr>`
    )
    .join("");

  dom.ledgerPreview.innerHTML = rows;
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function formatNumber(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}
