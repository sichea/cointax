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
      timestamp: ["date_utc", "time", "timestamp", "date", "create_time"],
      symbol: ["pair", "symbol", "market", "trading_pair"],
      side: ["side", "type", "direction"],
      price: ["price", "avg_price", "executed_price"],
      amount: ["amount", "executed", "filled", "executed_qty", "quantity", "qty"],
      fee: ["fee", "commission", "trading_fee"],
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
      fee: ["exec_fee", "fee", "trading_fee", "commission"],
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
    setStatus("Select Binance/Bybit CSV file(s) first.");
    return;
  }

  setStatus("Parsing CSV files...");
  dom.downloadBtn.disabled = true;

  try {
    const allRows = [];

    for (const file of files) {
      const exchange = guessExchange(file.name);
      if (!EXCHANGE_PARSERS[exchange]) {
        throw new Error(`Unsupported exchange file: ${file.name}. Only Binance and Bybit are supported in this step.`);
      }

      const text = await file.text();
      const parsedRows = parseCsv(text);
      if (!parsedRows.length) {
        continue;
      }

      const normalized = normalizeRowsForExchange(parsedRows, exchange, file.name);
      allRows.push(...normalized);
    }

    if (!allRows.length) {
      throw new Error("No valid Binance/Bybit transaction rows were found.");
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
      ? ` Warning: ${fifoResult.warnings.length} unmatched sell event(s).`
      : "";
    setStatus(`Processed ${allRows.length} transactions from ${files.length} file(s).${warningText}`);
  } catch (error) {
    setStatus(`Processing failed: ${error.message}`);
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
    return [];
  }

  const headers = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = cells[i] || "";
    }
    return obj;
  });
}

function normalizeRowsForExchange(parsedRows, exchange, sourceName) {
  const config = EXCHANGE_PARSERS[exchange];
  const sample = parsedRows[0] || {};

  const columns = {
    transactionId: findColumn(sample, config.columns.transactionId),
    timestamp: findColumn(sample, config.columns.timestamp),
    symbol: findColumn(sample, config.columns.symbol),
    side: findColumn(sample, config.columns.side),
    price: findColumn(sample, config.columns.price),
    amount: findColumn(sample, config.columns.amount),
    fee: findColumn(sample, config.columns.fee),
  };

  const required = ["timestamp", "symbol", "side", "price", "amount"];
  for (const key of required) {
    if (!columns[key]) {
      throw new Error(`${exchange} CSV is missing required column for '${key}' in ${sourceName}`);
    }
  }

  return parsedRows
    .map((row, index) => {
      const parsedSide = normalizeSide(row[columns.side]);
      if (!parsedSide) {
        return null;
      }

      const [baseAsset, quoteAsset] = extractPair(row[columns.symbol]);
      const timestamp = normalizeDate(row[columns.timestamp]);
      const price = toNumber(row[columns.price]);
      const amount = toNumber(row[columns.amount]);
      const fee = columns.fee ? toNumber(row[columns.fee]) : 0;

      if (!baseAsset || !quoteAsset) {
        return null;
      }
      if (!Number.isFinite(price) || !Number.isFinite(amount) || amount <= 0) {
        return null;
      }

      const externalId = columns.transactionId ? row[columns.transactionId] : "";

      return {
        transaction_id: externalId || `${exchange}-${sourceName}-${index + 1}`,
        user_id: "demo-user",
        exchange,
        timestamp,
        base_asset: baseAsset,
        quote_asset: quoteAsset,
        side: parsedSide,
        price,
        amount,
        fee: Number.isFinite(fee) ? fee : 0,
      };
    })
    .filter(Boolean);
}

function findColumn(sampleRow, aliases) {
  const keys = Object.keys(sampleRow);
  for (const key of keys) {
    if (aliases.includes(key)) {
      return key;
    }
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[()\-]/g, "_")
    .replace(/[\/]/g, "_");
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
        `Unmatched SELL quantity ${round(sellRemaining)} ${tx.base_asset} on ${tx.timestamp} (${tx.exchange}).`
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
    ["Total Trades", summary.totalTrades],
    ["PnL Records", summary.totalPnlRows],
    ["Unmatched Sells", summary.unmatchedSells],
    ["Total Profit", formatMoney(summary.totalProfit)],
    ["Total Loss", formatMoney(summary.totalLoss)],
    ["Net Profit", formatMoney(summary.netProfit)],
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
  doc.text("Crypto Tax Summary", 14, 20);

  doc.setFontSize(11);
  doc.text(`Total Trades: ${summary.totalTrades}`, 14, 34);
  doc.text(`PnL Rows: ${summary.totalPnlRows}`, 14, 42);
  doc.text(`Unmatched Sells: ${summary.unmatchedSells}`, 14, 50);
  doc.text(`Total Profit: ${formatMoney(summary.totalProfit)}`, 14, 58);
  doc.text(`Total Loss: ${formatMoney(summary.totalLoss)}`, 14, 66);
  doc.text(`Net Profit: ${formatMoney(summary.netProfit)}`, 14, 74);
  doc.text(`Generated At (UTC): ${new Date().toISOString()}`, 14, 86);

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
