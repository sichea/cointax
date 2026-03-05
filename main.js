const state = {
  transactions: [],
  pnlRecords: [],
  summary: null,
  packageFiles: null,
};

const aliasMap = {
  timestamp: ["timestamp", "time", "date", "datetime", "created_at", "executed"],
  symbol: ["symbol", "market", "pair", "trading_pair", "coin_pair"],
  side: ["side", "type", "trade_type", "order_side"],
  price: ["price", "avg_price", "execution_price", "filled_price"],
  amount: ["amount", "qty", "quantity", "filled", "executed_qty", "size"],
  fee: ["fee", "commission", "trading_fee", "fee_amount"],
  base_asset: ["base_asset", "base", "coin"],
  quote_asset: ["quote_asset", "quote", "settle", "currency"],
};

const requiredKeys = ["timestamp", "side", "price", "amount"];

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
    setStatus("Select one or more CSV files first.");
    return;
  }

  setStatus("Parsing CSV files...");
  dom.downloadBtn.disabled = true;

  try {
    const allRows = [];

    for (const file of files) {
      const exchange = guessExchange(file.name);
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.length) {
        continue;
      }

      const normalized = normalizeRows(parsed, exchange, file.name);
      allRows.push(...normalized);
    }

    if (!allRows.length) {
      throw new Error("No valid transaction rows were found in the uploaded files.");
    }

    allRows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const pnlRecords = calculateFifoPnl(allRows);
    const summary = buildSummary(allRows, pnlRecords);
    const packageFiles = await buildEvidencePackage(allRows, pnlRecords, summary);

    state.transactions = allRows;
    state.pnlRecords = pnlRecords;
    state.summary = summary;
    state.packageFiles = packageFiles;

    renderSummary(summary);
    renderLedgerPreview(allRows);

    dom.downloadBtn.disabled = false;
    dom.statsCard.hidden = false;
    dom.previewCard.hidden = false;
    setStatus(`Processed ${allRows.length} transactions from ${files.length} file(s).`);
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
  if (lower.includes("upbit")) return "Upbit";
  if (lower.includes("bithumb")) return "Bithumb";
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

function normalizeRows(parsedRows, exchange, sourceName) {
  const mappedKeys = {};
  const first = parsedRows[0] || {};

  for (const key of Object.keys(aliasMap)) {
    const aliases = aliasMap[key];
    mappedKeys[key] = findMappedHeader(first, aliases);
  }

  for (const key of requiredKeys) {
    if (!mappedKeys[key]) {
      throw new Error(`Missing required column for ${key} in file: ${sourceName}`);
    }
  }

  return parsedRows
    .map((row, idx) => {
      const symbol = row[mappedKeys.symbol] || "";
      const [baseAsset, quoteAsset] = extractPair(
        symbol,
        row[mappedKeys.base_asset],
        row[mappedKeys.quote_asset]
      );

      const sideRaw = (row[mappedKeys.side] || "").toUpperCase();
      const side = sideRaw.includes("SELL") ? "SELL" : "BUY";

      const transaction = {
        transaction_id: `${exchange}-${sourceName}-${idx + 1}`,
        user_id: "demo-user",
        exchange,
        timestamp: normalizeDate(row[mappedKeys.timestamp]),
        base_asset: baseAsset,
        quote_asset: quoteAsset,
        side,
        price: toNumber(row[mappedKeys.price]),
        amount: toNumber(row[mappedKeys.amount]),
        fee: toNumber(row[mappedKeys.fee] || "0"),
      };

      if (!Number.isFinite(transaction.price) || !Number.isFinite(transaction.amount)) {
        return null;
      }
      if (!transaction.base_asset || !transaction.quote_asset) {
        return null;
      }

      return transaction;
    })
    .filter(Boolean);
}

function findMappedHeader(sampleRow, aliases) {
  const keys = Object.keys(sampleRow);
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (aliases.includes(normalized)) {
      return key;
    }
  }
  return "";
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[()\-]/g, "_");
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

function extractPair(symbol, baseAsset, quoteAsset) {
  if (baseAsset && quoteAsset) {
    return [String(baseAsset).toUpperCase(), String(quoteAsset).toUpperCase()];
  }

  const normalized = String(symbol || "")
    .toUpperCase()
    .replace("-", "/")
    .replace("_", "/")
    .replace(" ", "");

  if (normalized.includes("/")) {
    const [base, quote] = normalized.split("/");
    return [base || "", quote || ""];
  }

  const knownQuote = ["USDT", "USDC", "USD", "KRW", "BTC", "ETH"];
  for (const quote of knownQuote) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return [normalized.slice(0, -quote.length), quote];
    }
  }

  return ["", ""];
}

function calculateFifoPnl(transactions) {
  const inventory = new Map();
  const pnlRecords = [];

  for (const tx of transactions) {
    const key = `${tx.base_asset}/${tx.quote_asset}`;

    if (!inventory.has(key)) {
      inventory.set(key, []);
    }

    if (tx.side === "BUY") {
      inventory.get(key).push({
        remaining: tx.amount,
        price: tx.price,
        timestamp: tx.timestamp,
      });
      continue;
    }

    let sellRemaining = tx.amount;
    const lots = inventory.get(key);

    while (sellRemaining > 0 && lots.length) {
      const firstLot = lots[0];
      const matchedAmount = Math.min(sellRemaining, firstLot.remaining);
      const profit = (tx.price - firstLot.price) * matchedAmount;

      pnlRecords.push({
        asset: key,
        buy_price: firstLot.price,
        sell_price: tx.price,
        quantity: matchedAmount,
        profit,
        timestamp: tx.timestamp,
      });

      firstLot.remaining -= matchedAmount;
      sellRemaining -= matchedAmount;

      if (firstLot.remaining <= 0) {
        lots.shift();
      }
    }
  }

  return pnlRecords;
}

function buildSummary(transactions, pnlRecords) {
  const totalProfit = pnlRecords
    .filter((r) => r.profit > 0)
    .reduce((acc, r) => acc + r.profit, 0);

  const totalLoss = pnlRecords
    .filter((r) => r.profit < 0)
    .reduce((acc, r) => acc + Math.abs(r.profit), 0);

  const netProfit = totalProfit - totalLoss;

  return {
    totalTrades: transactions.length,
    totalPnlRows: pnlRecords.length,
    totalProfit,
    totalLoss,
    netProfit,
  };
}

function renderSummary(summary) {
  const items = [
    ["Total Trades", summary.totalTrades],
    ["PnL Records", summary.totalPnlRows],
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

  const pdfBytes = buildPdfSummary(summary);
  zip.file("tax_summary.pdf", pdfBytes);

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
    `trading_profit,${round(summary.netProfit)}`,
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
  doc.text(`Total Profit: ${formatMoney(summary.totalProfit)}`, 14, 42);
  doc.text(`Total Loss: ${formatMoney(summary.totalLoss)}`, 14, 50);
  doc.text(`Net Profit: ${formatMoney(summary.netProfit)}`, 14, 58);
  doc.text(`Generated At (UTC): ${new Date().toISOString()}`, 14, 70);

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
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
