const state = {
  transactions: [],
  pnlRecords: [],
  summary: null,
  packageFiles: null,
  warnings: [],
};

const EXCHANGE_PARSERS = {
  Binance: {
    columns: {
      transactionId: ["id", "trade_id", "order_id"],
      timestamp: ["Date(UTC)", "date(utc)", "date_utc", "time", "timestamp", "date", "create_time"],
      symbol: ["Pair", "pair", "symbol", "market", "trading_pair"],
      baseAsset: ["Base Asset", "base asset", "base_asset", "base"],
      quoteAsset: ["Quote Asset", "quote asset", "quote_asset", "quote"],
      side: ["side", "type", "direction"],
      price: ["price", "avg_price", "executed_price"],
      amount: ["amount", "executed", "filled", "executed_qty", "quantity", "qty"],
      total: ["total", "value", "filled_value"],
      fee: ["fee", "commission", "trading_fee"],
      feeAsset: ["Fee Coin", "fee coin", "fee_asset", "commission_asset"],
    },
  },
  Bybit: {
    columns: {
      transactionId: ["exec_id", "trade_id", "order_id", "id"],
      timestamp: ["exec_time", "trade_time", "time", "timestamp", "created_time"],
      symbol: ["symbol", "pair", "market", "trading_pair"],
      side: ["side", "direction", "trade_type", "type"],
      price: ["exec_price", "price", "avg_price", "order_price"],
      amount: ["exec_qty", "qty", "size", "executed_qty", "quantity", "filled"],
      total: ["total", "value", "filled_value"],
      fee: ["exec_fee", "fee", "trading_fee", "commission"],
      feeAsset: ["fee_coin", "fee coin", "fee_asset", "commission_asset"],
    },
  },
};

const dom = {
  files: document.getElementById("csvFiles"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  status: document.getElementById("status"),
  statsCard: document.getElementById("statsCard"),
  statsGrid: document.getElementById("statsGrid"),
  previewCard: document.getElementById("previewCard"),
  ledgerPreview: document.getElementById("ledgerPreview"),
};

dom.processBtn.addEventListener("click", handleProcess);
dom.downloadBtn.addEventListener("click", handleDownload);

async function handleProcess() {
  const files = Array.from(dom.files.files || []);
  if (!files.length) {
    setStatus("Binance/Bybit CSV 파일을 먼저 선택하세요.");
    return;
  }

  setStatus("CSV 파일을 분석 중입니다...");
  dom.downloadBtn.disabled = true;

  try {
    const allRows = [];

    for (const file of files) {
      const exchange = guessExchange(file.name);
      if (!EXCHANGE_PARSERS[exchange]) {
        throw new Error(`지원하지 않는 거래소 파일입니다: ${file.name}. 현재는 Binance, Bybit만 지원합니다.`);
      }

      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.rows.length) {
        continue;
      }

      const normalized = normalizeRowsForExchange(parsed.rows, exchange, file.name, parsed.headers);
      allRows.push(...normalized);
    }

    if (!allRows.length) {
      throw new Error("유효한 Binance/Bybit 거래 내역을 찾지 못했습니다.");
    }

    allRows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const fifoResult = calculateFifoPnl(allRows);
    const summary = buildSummary(allRows, fifoResult.records, fifoResult.warnings);
    const packageFiles = await buildEvidencePackage(allRows, fifoResult.records, summary);

    state.transactions = allRows;
    state.pnlRecords = fifoResult.records;
    state.summary = summary;
    state.packageFiles = packageFiles;
    state.warnings = fifoResult.warnings;

    renderSummary(summary);
    renderLedgerPreview(allRows);

    dom.downloadBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;

    const warningText = fifoResult.warnings.length
      ? ` 경고: 매수 매칭이 안 된 매도 ${fifoResult.warnings.length}건이 있습니다.`
      : "";
    setStatus(`${files.length}개 파일에서 총 ${allRows.length}건 거래를 처리했습니다.${warningText}`);
  } catch (error) {
    setStatus(`처리에 실패했습니다: ${error.message}`);
    console.error(error);
  }
}

function handleDownload() {
  if (!state.packageFiles) {
    return;
  }

  const blobUrl = URL.createObjectURL(state.packageFiles);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "crypto_tax_package.zip";
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function setStatus(text) {
  dom.status.textContent = text;
}

function guessExchange(fileName = "") {
  const lower = fileName.toLowerCase();
  if (lower.includes("binance")) return "Binance";
  if (lower.includes("bybit")) return "Bybit";
  return "Unknown";
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

function normalizeRowsForExchange(parsedRows, exchange, sourceName, detectedHeaders = []) {
  const config = EXCHANGE_PARSERS[exchange];
  const sample = parsedRows[0] || {};
  const detected = detectedHeaders.length ? detectedHeaders : Object.keys(sample);

  const columns = {
    transactionId: findColumn(sample, config.columns.transactionId),
    timestamp: findColumn(sample, config.columns.timestamp),
    symbol: findColumn(sample, config.columns.symbol),
    baseAsset: findColumn(sample, config.columns.baseAsset || []),
    quoteAsset: findColumn(sample, config.columns.quoteAsset || []),
    side: findColumn(sample, config.columns.side),
    price: findColumn(sample, config.columns.price),
    amount: findColumn(sample, config.columns.amount),
    total: findColumn(sample, config.columns.total || []),
    fee: findColumn(sample, config.columns.fee),
    feeAsset: findColumn(sample, config.columns.feeAsset || []),
  };
  const normalizedRows = parsedRows
    .map((row, index) => {
      const parsedSide = columns.side ? normalizeSide(row[columns.side]) : "";
      const pairValue = columns.symbol ? row[columns.symbol] : "";
      const explicitBase = columns.baseAsset ? String(row[columns.baseAsset] || "").trim().toUpperCase() : "";
      const explicitQuote = columns.quoteAsset ? String(row[columns.quoteAsset] || "").trim().toUpperCase() : "";
      const [pairBase, pairQuote] = extractPair(pairValue);
      const baseAsset = explicitBase || pairBase;
      const quoteAsset = explicitQuote || pairQuote;

      const timestamp = columns.timestamp ? normalizeDate(row[columns.timestamp]) : "";
      const price = columns.price ? toNumber(row[columns.price]) : NaN;
      const amount = columns.amount ? toNumber(row[columns.amount]) : NaN;
      const totalRaw = columns.total ? toNumber(row[columns.total]) : NaN;
      const total = Number.isFinite(totalRaw) ? totalRaw : price * amount;
      const fee = columns.fee ? toNumber(row[columns.fee]) : 0;
      const feeAsset = columns.feeAsset ? String(row[columns.feeAsset] || "").trim().toUpperCase() : "";
      const externalId = columns.transactionId ? row[columns.transactionId] : "";

      const normalizedTx = {
        transaction_id: externalId || `${exchange}-${sourceName}-${index + 1}`,
        user_id: "demo-user",
        exchange,
        timestamp,
        base_asset: baseAsset,
        quote_asset: quoteAsset,
        side: parsedSide,
        price,
        amount,
        total,
        fee: Number.isFinite(fee) ? fee : 0,
        fee_asset: feeAsset,
      };

      if (!isValidNormalizedTransaction(normalizedTx)) {
        return null;
      }
      return normalizedTx;
    })
    .filter(Boolean);

  if (!normalizedRows.length && parsedRows.length) {
    const detectedText = detected.length ? detected.join(", ") : "(none)";
    throw new Error(
      `${exchange} CSV(${sourceName})를 정규 스키마로 매핑하지 못했습니다. 감지된 헤더: ${detectedText}`
    );
  }

  return normalizedRows;
}

function isValidNormalizedTransaction(tx) {
  if (!tx.timestamp || !tx.base_asset || !tx.quote_asset || !tx.side) {
    return false;
  }
  if (!Number.isFinite(tx.price) || !Number.isFinite(tx.amount) || !Number.isFinite(tx.total)) {
    return false;
  }
  if (tx.amount <= 0) {
    return false;
  }
  return true;
}

function findColumn(sampleRow, aliases) {
  const keys = Object.keys(sampleRow);
  const aliasSet = new Set((aliases || []).map((alias) => normalizeHeader(alias)));
  for (const key of keys) {
    if (aliasSet.has(normalizeHeader(key))) {
      return key;
    }
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeSide(value) {
  const side = String(value || "").trim().toUpperCase();
  if (side.includes("BUY")) return "BUY";
  if (side.includes("SELL")) return "SELL";
  return "";
}

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toNumber(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function extractPair(symbol) {
  const normalized = String(symbol || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "/");

  if (normalized.includes("/")) {
    const [base, quote] = normalized.split("/");
    return [base || "", quote || ""];
  }

  const knownQuotes = ["USDT", "USDC", "USD", "BUSD", "KRW", "BTC", "ETH"];
  for (const quote of knownQuotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return [normalized.slice(0, -quote.length), quote];
    }
  }

  return ["", ""];
}

function calculateFifoPnl(transactions) {
  const inventory = new Map();
  const records = [];
  const warnings = [];

  for (const tx of transactions) {
    const pair = `${tx.base_asset}/${tx.quote_asset}`;
    if (!inventory.has(pair)) {
      inventory.set(pair, []);
    }

    const lots = inventory.get(pair);

    if (tx.side === "BUY") {
      const unitCost = (tx.price * tx.amount + tx.fee) / tx.amount;
      lots.push({
        transaction_id: tx.transaction_id,
        timestamp: tx.timestamp,
        remaining: tx.amount,
        unitCost,
      });
      continue;
    }

    let sellRemaining = tx.amount;
    const sellUnitProceeds = (tx.price * tx.amount - tx.fee) / tx.amount;

    while (sellRemaining > 0 && lots.length > 0) {
      const buyLot = lots[0];
      const matchedQty = Math.min(sellRemaining, buyLot.remaining);
      const costBasis = matchedQty * buyLot.unitCost;
      const proceeds = matchedQty * sellUnitProceeds;
      const profit = proceeds - costBasis;

      records.push({
        asset: pair,
        buy_tx_id: buyLot.transaction_id,
        sell_tx_id: tx.transaction_id,
        buy_price: round(buyLot.unitCost),
        sell_price: round(sellUnitProceeds),
        quantity: round(matchedQty),
        cost_basis: round(costBasis),
        proceeds: round(proceeds),
        profit: round(profit),
        timestamp: tx.timestamp,
      });

      buyLot.remaining -= matchedQty;
      sellRemaining -= matchedQty;

      if (buyLot.remaining <= 0) {
        lots.shift();
      }
    }

    if (sellRemaining > 0) {
      warnings.push(
        `${tx.timestamp} (${tx.exchange})에 ${tx.base_asset} 매도 ${round(sellRemaining)} 수량이 매수 내역과 매칭되지 않았습니다.`
      );
    }
  }

  return { records, warnings };
}

function buildSummary(transactions, pnlRecords, warnings) {
  const totalProfit = pnlRecords
    .filter((r) => r.profit > 0)
    .reduce((acc, r) => acc + r.profit, 0);

  const totalLoss = pnlRecords
    .filter((r) => r.profit < 0)
    .reduce((acc, r) => acc + Math.abs(r.profit), 0);

  return {
    totalTrades: transactions.length,
    totalPnlRows: pnlRecords.length,
    unmatchedSells: warnings.length,
    totalProfit: round(totalProfit),
    totalLoss: round(totalLoss),
    netProfit: round(totalProfit - totalLoss),
  };
}

function renderSummary(summary) {
  const items = [
    ["총 거래 건수", summary.totalTrades],
    ["손익 레코드", summary.totalPnlRows],
    ["미매칭 매도", summary.unmatchedSells],
    ["총 이익", formatMoney(summary.totalProfit)],
    ["총 손실", formatMoney(summary.totalLoss)],
    ["순이익", formatMoney(summary.netProfit)],
  ];

  dom.statsGrid.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="stat-item"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
}

function renderLedgerPreview(transactions) {
  const rows = transactions
    .slice(0, 30)
    .map(
      (tx) =>
        `<tr><td>${tx.timestamp}</td><td>${tx.exchange}</td><td>${tx.base_asset}/${tx.quote_asset}</td><td>${tx.side}</td><td>${tx.price}</td><td>${tx.amount}</td><td>${tx.fee}</td></tr>`
    )
    .join("");

  dom.ledgerPreview.innerHTML = rows;
}

async function buildEvidencePackage(transactions, pnlRecords, summary) {
  const zip = new JSZip();

  zip.file("transactions.csv", toCsv(transactions));
  zip.file("profit_loss.csv", toCsv(pnlRecords));
  zip.file("income_report.csv", buildIncomeCsv(summary));
  zip.file("tax_summary.pdf", buildPdfSummary(summary));

  return zip.generateAsync({ type: "blob" });
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(","));
  return `${headers.join(",")}\n${body.join("\n")}`;
}

function escapeCsv(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildIncomeCsv(summary) {
  const lines = [
    "income_type,amount",
    `trading_profit,${summary.netProfit}`,
    "staking_income,0",
    "airdrop_income,0",
  ];
  return lines.join("\n");
}

function buildPdfSummary(summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("코인 세금 요약", 14, 20);

  doc.setFontSize(11);
  doc.text(`총 거래 건수: ${summary.totalTrades}`, 14, 34);
  doc.text(`손익 레코드: ${summary.totalPnlRows}`, 14, 42);
  doc.text(`미매칭 매도: ${summary.unmatchedSells}`, 14, 50);
  doc.text(`총 이익: ${formatMoney(summary.totalProfit)}`, 14, 58);
  doc.text(`총 손실: ${formatMoney(summary.totalLoss)}`, 14, 66);
  doc.text(`순이익: ${formatMoney(summary.netProfit)}`, 14, 74);
  doc.text(`생성 시각(UTC): ${new Date().toISOString()}`, 14, 86);

  return doc.output("arraybuffer");
}

function formatMoney(num) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num || 0);
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
