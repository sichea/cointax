const EVENT_TYPES = Object.freeze({
  TRADE_BUY: "TRADE_BUY",
  TRADE_SELL: "TRADE_SELL",
  AIRDROP: "AIRDROP",
  STAKING_REWARD: "STAKING_REWARD",
  DEFI_REWARD: "DEFI_REWARD",
  TRANSFER_IN: "TRANSFER_IN",
  TRANSFER_OUT: "TRANSFER_OUT",
  INTERNAL_TRANSFER: "INTERNAL_TRANSFER",
  DEPOSIT: "DEPOSIT",
  WITHDRAWAL: "WITHDRAWAL",
  UNKNOWN: "UNKNOWN",
});

const OUTPUT_FILES = [
  "transaction_ledger.csv",
  "trade_profit_report.csv",
  "airdrop_income.csv",
  "defi_income.csv",
  "transfer_records.csv",
  "fx_rates.csv",
  "tax_summary.pdf",
];

const DEFAULT_USDT_KRW = 1300;
const THEME_STORAGE_KEY = "tax-evidence-theme";
const USD_STABLE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "DAI"]);

const state = {
  events: [],
  tradeProfitRecords: [],
  summary: null,
  packageFiles: null,
  warnings: [],
  processing: null,
};

const EXCHANGE_PARSERS = {
  Binance: {
    columns: {
      transactionId: ["id", "trade_id", "order_id"],
      timestamp: ["Date(UTC)", "date(utc)", "date_utc", "time", "timestamp", "date", "create_time"],
      symbol: ["Pair", "pair", "symbol", "market", "trading_pair"],
      baseAsset: ["Base Asset", "base asset", "base_asset", "base"],
      quoteAsset: ["Quote Asset", "quote asset", "quote_asset", "quote"],
      side: ["Type", "side", "type", "direction"],
      price: ["Price", "price", "avg_price", "executed_price"],
      amount: ["Amount", "amount", "executed", "filled", "executed_qty", "quantity", "qty"],
      total: ["Total", "total", "value", "filled_value"],
      fee: ["Fee", "fee", "commission", "trading_fee"],
      feeAsset: ["Fee Coin", "fee coin", "fee_asset", "commission_asset"],
      txHash: ["tx hash", "tx_hash", "hash"],
      walletSource: ["from", "wallet source", "source"],
      walletDestination: ["to", "wallet destination", "destination"],
    },
    detector: {
      required: ["timestamp", "side", "price", "amount"],
      pairFallback: ["symbol", "baseAsset", "quoteAsset"],
    },
  },
};

const dom = {
  files: document.getElementById("csvFiles"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  themeToggle: document.getElementById("themeToggle"),
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
  if (!files.length) {
    setStatus("Binance Spot Trade History CSV 파일을 먼저 선택하세요.");
    return;
  }

  setStatus("CSV 파일을 분석하고 세무 증빙자료를 생성 중입니다...");
  dom.downloadBtn.disabled = true;

  try {
    const normalizedEvents = [];
    let parsedRowCount = 0;

    for (const file of files) {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.rows.length) {
        continue;
      }

      parsedRowCount += parsed.rows.length;
      const exchange = detectExchangeFormat(parsed.headers, file.name);
      if (!EXCHANGE_PARSERS[exchange]) {
        throw new Error(`지원하지 않는 포맷입니다: ${file.name}. 현재 MVP는 Binance Spot Trade History만 지원합니다.`);
      }

      const mappedEvents = normalizeRowsForExchange(parsed.rows, exchange, file.name, parsed.headers);
      normalizedEvents.push(...mappedEvents);
    }

    if (!normalizedEvents.length) {
      throw new Error("유효한 Binance Spot 거래 내역을 찾지 못했습니다.");
    }

    normalizedEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const fifoResult = calculateFifoRealizedPnl(normalizedEvents);
    const fxRates = buildFxRates(normalizedEvents);
    const summary = buildTaxSummary(normalizedEvents, fifoResult.records, fifoResult.warnings);

    const evidencePackage = await buildEvidencePackage({
      events: normalizedEvents,
      tradeProfitRecords: fifoResult.records,
      fxRates,
      summary,
    });

    state.events = normalizedEvents;
    state.tradeProfitRecords = fifoResult.records;
    state.summary = summary;
    state.packageFiles = evidencePackage;
    state.warnings = fifoResult.warnings;
    state.processing = {
      parsedRowCount,
      normalizedCount: normalizedEvents.length,
      realizedSellCount: fifoResult.realizedSellCount,
      evidenceGenerated: true,
      outputFiles: OUTPUT_FILES.slice(),
    };

    renderSummary({
      summary,
      parsedRowCount,
      normalizedCount: normalizedEvents.length,
      realizedSellCount: fifoResult.realizedSellCount,
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
        "- 증빙 파일 생성: 성공",
        `- 생성된 증빙 파일 목록: ${OUTPUT_FILES.join(", ")}`,
      ].join("\n")
    );
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
  link.download = "tax_evidence_package.zip";
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function setStatus(text) {
  dom.status.textContent = text;
}

function detectExchangeFormat(headers, fileName = "") {
  const headerSet = new Set((headers || []).map((h) => normalizeHeader(h)));

  const binance = EXCHANGE_PARSERS.Binance;
  if (isMatchingFormat(headerSet, binance.columns, binance.detector)) {
    return "Binance";
  }

  if (fileName.toLowerCase().includes("binance")) {
    return "Binance";
  }

  return "Unknown";
}

function isMatchingFormat(headerSet, columns, detector) {
  for (const required of detector.required) {
    const aliases = columns[required] || [];
    if (!aliases.some((alias) => headerSet.has(normalizeHeader(alias)))) {
      return false;
    }
  }

  const hasSymbol = (columns[detector.pairFallback[0]] || []).some((alias) => headerSet.has(normalizeHeader(alias)));
  const hasBase = (columns[detector.pairFallback[1]] || []).some((alias) => headerSet.has(normalizeHeader(alias)));
  const hasQuote = (columns[detector.pairFallback[2]] || []).some((alias) => headerSet.has(normalizeHeader(alias)));

  return hasSymbol || (hasBase && hasQuote);
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
    txHash: findColumn(sample, config.columns.txHash || []),
    walletSource: findColumn(sample, config.columns.walletSource || []),
    walletDestination: findColumn(sample, config.columns.walletDestination || []),
  };

  const normalizedEvents = parsedRows
    .map((row, index) => mapBinanceTradeRow(row, columns, exchange, sourceName, index))
    .filter(Boolean);

  if (!normalizedEvents.length && parsedRows.length) {
    const detectedText = detected.length ? detected.join(", ") : "(none)";
    throw new Error(
      `${exchange} CSV(${sourceName})를 정규 스키마로 매핑하지 못했습니다. 감지된 헤더: ${detectedText}`
    );
  }

  return normalizedEvents;
}

function mapBinanceTradeRow(row, columns, exchange, sourceName, index) {
  const parsedSide = columns.side ? normalizeSide(row[columns.side]) : "";
  if (!parsedSide) {
    return null;
  }

  const pairValue = columns.symbol ? row[columns.symbol] : "";
  const explicitBase = columns.baseAsset ? String(row[columns.baseAsset] || "").trim().toUpperCase() : "";
  const explicitQuote = columns.quoteAsset ? String(row[columns.quoteAsset] || "").trim().toUpperCase() : "";
  const [pairBase, pairQuote] = extractPair(pairValue);
  const baseAsset = explicitBase || pairBase;
  const quoteAsset = explicitQuote || pairQuote;

  const timestamp = columns.timestamp ? normalizeDate(row[columns.timestamp]) : "";
  const amount = columns.amount ? toNumber(row[columns.amount]) : NaN;
  const priceInQuote = columns.price ? toNumber(row[columns.price]) : NaN;
  const totalInQuoteRaw = columns.total ? toNumber(row[columns.total]) : NaN;
  const totalInQuote = Number.isFinite(totalInQuoteRaw) ? totalInQuoteRaw : priceInQuote * amount;
  const fee = columns.fee ? toNumber(row[columns.fee]) : 0;
  const feeAsset = columns.feeAsset ? String(row[columns.feeAsset] || "").trim().toUpperCase() : "";

  const usdtKrw = getUsdtKrwAt(timestamp);
  const priceUsdt = convertQuoteValueToUsdt(priceInQuote, quoteAsset, usdtKrw);
  const totalUsdtRaw = convertQuoteValueToUsdt(totalInQuote, quoteAsset, usdtKrw);
  const totalUsdt = Number.isFinite(totalUsdtRaw) ? totalUsdtRaw : priceUsdt * amount;
  const feeUsdt = convertFeeToUsdt({
    fee,
    feeAsset,
    baseAsset,
    quoteAsset,
    priceUsdt,
    usdtKrw,
  });

  const eventType = parsedSide === "BUY" ? EVENT_TYPES.TRADE_BUY : EVENT_TYPES.TRADE_SELL;
  const txHash = columns.txHash ? String(row[columns.txHash] || "").trim() : "";
  const walletOrSource = columns.walletSource ? String(row[columns.walletSource] || "").trim() : exchange;
  const walletOrDestination = columns.walletDestination ? String(row[columns.walletDestination] || "").trim() : exchange;
  const externalId = columns.transactionId ? String(row[columns.transactionId] || "").trim() : "";

  const normalizedEvent = {
    id: externalId || `${exchange}-${sourceName}-${index + 1}`,
    event_type: eventType,
    transaction_type: eventType,
    timestamp,
    exchange,
    wallet_or_source: walletOrSource || exchange,
    wallet_or_destination: walletOrDestination || exchange,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    amount,
    price_usdt: priceUsdt,
    price_krw: Number.isFinite(priceUsdt) ? priceUsdt * usdtKrw : NaN,
    total_usdt: totalUsdt,
    total_krw: Number.isFinite(totalUsdt) ? totalUsdt * usdtKrw : NaN,
    fee: Number.isFinite(fee) ? fee : 0,
    fee_asset: feeAsset,
    fee_usdt: Number.isFinite(feeUsdt) ? feeUsdt : 0,
    tx_hash: txHash,
    source_file: sourceName,
    note: `${exchange} Spot Trade History`,
  };

  if (!isValidNormalizedEvent(normalizedEvent)) {
    return null;
  }

  return normalizedEvent;
}

function isValidNormalizedEvent(event) {
  if (!event.timestamp || !event.base_asset || !event.quote_asset) {
    return false;
  }
  if (![EVENT_TYPES.TRADE_BUY, EVENT_TYPES.TRADE_SELL].includes(event.event_type)) {
    return false;
  }
  if (!Number.isFinite(event.amount) || event.amount <= 0) {
    return false;
  }
  if (!Number.isFinite(event.price_usdt) || !Number.isFinite(event.total_usdt)) {
    return false;
  }
  return true;
}

function calculateFifoRealizedPnl(events) {
  const inventory = new Map();
  const records = [];
  const warnings = [];
  const realizedSellIds = new Set();

  const tradeEvents = events.filter((event) =>
    [EVENT_TYPES.TRADE_BUY, EVENT_TYPES.TRADE_SELL].includes(event.event_type)
  );

  for (const event of tradeEvents) {
    const asset = event.base_asset;
    if (!inventory.has(asset)) {
      inventory.set(asset, []);
    }

    const lots = inventory.get(asset);

    if (event.event_type === EVENT_TYPES.TRADE_BUY) {
      const buyFeeUsdt = event.fee_asset === event.quote_asset ? event.fee_usdt : 0;
      const buyFeeKrw = buyFeeUsdt * getUsdtKrwAt(event.timestamp);
      const unitCostUsdt = (event.total_usdt + buyFeeUsdt) / event.amount;
      const unitCostKrw = (event.total_krw + buyFeeKrw) / event.amount;

      lots.push({
        buy_id: event.id,
        buy_time: event.timestamp,
        buy_exchange_or_wallet: event.exchange,
        remaining: event.amount,
        unit_cost_usdt: unitCostUsdt,
        unit_cost_krw: unitCostKrw,
      });
      continue;
    }

    let sellRemaining = event.amount;
    const sellFeeUsdt = event.fee_asset === event.quote_asset ? event.fee_usdt : 0;
    const sellFeeKrw = sellFeeUsdt * getUsdtKrwAt(event.timestamp);
    const unitProceedsUsdt = (event.total_usdt - sellFeeUsdt) / event.amount;
    const unitProceedsKrw = (event.total_krw - sellFeeKrw) / event.amount;

    while (sellRemaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedAmount = Math.min(sellRemaining, lot.remaining);

      const costUsdt = matchedAmount * lot.unit_cost_usdt;
      const proceedsUsdt = matchedAmount * unitProceedsUsdt;
      const profitUsdt = proceedsUsdt - costUsdt;

      const costKrw = matchedAmount * lot.unit_cost_krw;
      const proceedsKrw = matchedAmount * unitProceedsKrw;
      const profitKrw = proceedsKrw - costKrw;

      records.push({
        asset,
        buy_time: lot.buy_time,
        sell_time: event.timestamp,
        buy_exchange_or_wallet: lot.buy_exchange_or_wallet,
        sell_exchange_or_wallet: event.exchange,
        buy_price_usdt: round(lot.unit_cost_usdt),
        sell_price_usdt: round(unitProceedsUsdt),
        buy_price_krw: round(lot.unit_cost_krw),
        sell_price_krw: round(unitProceedsKrw),
        amount: round(matchedAmount),
        profit_usdt: round(profitUsdt),
        profit_krw: round(profitKrw),
        calculation_method: "FIFO",
      });

      lot.remaining -= matchedAmount;
      sellRemaining -= matchedAmount;
      realizedSellIds.add(event.id);

      if (lot.remaining <= 0) {
        lots.shift();
      }
    }

    if (sellRemaining > 0) {
      warnings.push(
        `${event.timestamp} ${asset} 매도 ${round(sellRemaining)} 수량은 매수 내역과 FIFO 매칭되지 않았습니다.`
      );
    }
  }

  return {
    records,
    warnings,
    realizedSellCount: realizedSellIds.size,
  };
}

function buildTaxSummary(events, tradeProfitRecords, warnings) {
  const totalTradingProfitUsdt = tradeProfitRecords
    .filter((row) => row.profit_usdt > 0)
    .reduce((sum, row) => sum + row.profit_usdt, 0);

  const totalTradingLossUsdt = Math.abs(
    tradeProfitRecords
      .filter((row) => row.profit_usdt < 0)
      .reduce((sum, row) => sum + row.profit_usdt, 0)
  );

  const totalTradingProfitKrw = tradeProfitRecords
    .filter((row) => row.profit_krw > 0)
    .reduce((sum, row) => sum + row.profit_krw, 0);

  const totalTradingLossKrw = Math.abs(
    tradeProfitRecords
      .filter((row) => row.profit_krw < 0)
      .reduce((sum, row) => sum + row.profit_krw, 0)
  );

  const netTradingProfitUsdt = totalTradingProfitUsdt - totalTradingLossUsdt;
  const netTradingProfitKrw = totalTradingProfitKrw - totalTradingLossKrw;

  const totalAirdropIncomeUsdt = 0;
  const totalAirdropIncomeKrw = 0;
  const totalDefiIncomeUsdt = 0;
  const totalDefiIncomeKrw = 0;

  return {
    totalTransactionCount: events.length,
    totalTradingProfitUsdt: round(totalTradingProfitUsdt),
    totalTradingLossUsdt: round(totalTradingLossUsdt),
    netTradingProfitUsdt: round(netTradingProfitUsdt),
    totalTradingProfitKrw: round(totalTradingProfitKrw),
    totalTradingLossKrw: round(totalTradingLossKrw),
    netTradingProfitKrw: round(netTradingProfitKrw),
    totalAirdropIncomeUsdt,
    totalAirdropIncomeKrw,
    totalDefiIncomeUsdt,
    totalDefiIncomeKrw,
    totalTaxableAmountUsdt: round(netTradingProfitUsdt + totalAirdropIncomeUsdt + totalDefiIncomeUsdt),
    totalTaxableAmountKrw: round(netTradingProfitKrw + totalAirdropIncomeKrw + totalDefiIncomeKrw),
    unmatchedSellWarnings: warnings.length,
  };
}

function renderSummary({ summary, parsedRowCount, normalizedCount, realizedSellCount, outputFiles }) {
  const items = [
    ["파싱된 행 수", parsedRowCount],
    ["정규화된 거래 수", normalizedCount],
    ["실현손익 계산 건수", realizedSellCount],
    ["총 거래 건수", summary.totalTransactionCount],
    ["순이익 (USDT)", round(summary.netTradingProfitUsdt)],
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
        `<tr><td>${event.timestamp}</td><td>${event.exchange}</td><td>${event.transaction_type}</td><td>${event.base_asset}/${event.quote_asset}</td><td>${event.amount}</td><td>${round(event.price_usdt)}</td><td>${round(event.price_krw)}</td><td>${event.source_file}</td></tr>`
    )
    .join("");

  dom.ledgerPreview.innerHTML = rows;
}

async function buildEvidencePackage({ events, tradeProfitRecords, fxRates, summary }) {
  const zip = new JSZip();

  zip.file(
    "transaction_ledger.csv",
    toCsvWithHeaders(
      [
        "timestamp",
        "exchange",
        "wallet_or_source",
        "wallet_or_destination",
        "transaction_type",
        "base_asset",
        "quote_asset",
        "amount",
        "price_usdt",
        "price_krw",
        "fee",
        "fee_asset",
        "tx_hash",
        "source_file",
        "note",
      ],
      buildTransactionLedgerRows(events)
    )
  );

  zip.file(
    "trade_profit_report.csv",
    toCsvWithHeaders(
      [
        "asset",
        "buy_time",
        "sell_time",
        "buy_exchange_or_wallet",
        "sell_exchange_or_wallet",
        "buy_price_usdt",
        "sell_price_usdt",
        "buy_price_krw",
        "sell_price_krw",
        "amount",
        "profit_usdt",
        "profit_krw",
        "calculation_method",
      ],
      buildTradeProfitRows(tradeProfitRecords)
    )
  );

  zip.file(
    "airdrop_income.csv",
    toCsvWithHeaders(
      [
        "timestamp",
        "asset",
        "amount",
        "source",
        "tx_hash",
        "price_usdt_at_receive",
        "price_krw_at_receive",
        "income_usdt",
        "income_krw",
        "note",
      ],
      []
    )
  );

  zip.file(
    "defi_income.csv",
    toCsvWithHeaders(
      [
        "timestamp",
        "protocol",
        "income_type",
        "asset",
        "amount",
        "price_usdt_at_receive",
        "price_krw_at_receive",
        "income_usdt",
        "income_krw",
        "tx_hash",
        "note",
      ],
      []
    )
  );

  zip.file(
    "transfer_records.csv",
    toCsvWithHeaders(
      [
        "timestamp",
        "asset",
        "amount",
        "from_exchange_or_wallet",
        "to_exchange_or_wallet",
        "tx_hash",
        "note",
      ],
      []
    )
  );

  zip.file(
    "fx_rates.csv",
    toCsvWithHeaders(["timestamp", "usdt_krw", "btc_krw", "eth_krw", "source"], fxRates)
  );

  zip.file("tax_summary.pdf", buildPdfSummary(summary));

  return zip.generateAsync({ type: "blob" });
}

function buildTransactionLedgerRows(events) {
  return events.map((event) => ({
    timestamp: event.timestamp,
    exchange: event.exchange,
    wallet_or_source: event.wallet_or_source,
    wallet_or_destination: event.wallet_or_destination,
    transaction_type: event.transaction_type,
    base_asset: event.base_asset,
    quote_asset: event.quote_asset,
    amount: round(event.amount),
    price_usdt: round(event.price_usdt),
    price_krw: round(event.price_krw),
    fee: round(event.fee),
    fee_asset: event.fee_asset,
    tx_hash: event.tx_hash,
    source_file: event.source_file,
    note: event.note,
  }));
}

function buildTradeProfitRows(records) {
  return records.map((row) => ({
    asset: row.asset,
    buy_time: row.buy_time,
    sell_time: row.sell_time,
    buy_exchange_or_wallet: row.buy_exchange_or_wallet,
    sell_exchange_or_wallet: row.sell_exchange_or_wallet,
    buy_price_usdt: round(row.buy_price_usdt),
    sell_price_usdt: round(row.sell_price_usdt),
    buy_price_krw: round(row.buy_price_krw),
    sell_price_krw: round(row.sell_price_krw),
    amount: round(row.amount),
    profit_usdt: round(row.profit_usdt),
    profit_krw: round(row.profit_krw),
    calculation_method: row.calculation_method,
  }));
}

function buildFxRates(events) {
  const byTimestamp = new Map();

  for (const event of events) {
    const timestamp = event.timestamp;
    if (!byTimestamp.has(timestamp)) {
      byTimestamp.set(timestamp, {
        timestamp,
        usdt_krw: round(getUsdtKrwAt(timestamp)),
        btc_krw: "",
        eth_krw: "",
        source: "MVP_FIXED_USDT_KRW",
      });
    }

    const row = byTimestamp.get(timestamp);
    if (event.base_asset === "BTC" && Number.isFinite(event.price_krw)) {
      row.btc_krw = round(event.price_krw);
    }
    if (event.base_asset === "ETH" && Number.isFinite(event.price_krw)) {
      row.eth_krw = round(event.price_krw);
    }
  }

  return Array.from(byTimestamp.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function toCsvWithHeaders(headers, rows) {
  if (!rows.length) {
    return headers.join(",");
  }

  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","));
  return `${headers.join(",")}\n${body.join("\n")}`;
}

function escapeCsv(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildPdfSummary(summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(15);
  doc.text("코인 세무 제출용 증빙자료 요약", 14, 18);

  doc.setFontSize(11);
  doc.text(`총 거래 건수: ${summary.totalTransactionCount}`, 14, 30);
  doc.text(`총 거래 이익 (KRW): ${formatNumber(summary.totalTradingProfitKrw)}`, 14, 38);
  doc.text(`총 거래 손실 (KRW): ${formatNumber(summary.totalTradingLossKrw)}`, 14, 46);
  doc.text(`순 거래 손익 (KRW): ${formatNumber(summary.netTradingProfitKrw)}`, 14, 54);
  doc.text(`총 에어드랍 소득 (KRW): ${formatNumber(summary.totalAirdropIncomeKrw)}`, 14, 62);
  doc.text(`총 DeFi/스테이킹 소득 (KRW): ${formatNumber(summary.totalDefiIncomeKrw)}`, 14, 70);
  doc.text(`총 과세대상 금액 (KRW): ${formatNumber(summary.totalTaxableAmountKrw)}`, 14, 78);

  doc.text("기준 환율/가격 산정 기준:", 14, 92);
  doc.text("- MVP에서는 USDT/KRW 기준값을 사용하고, 거래시각별 KRW 환산값을 함께 저장합니다.", 18, 100);
  doc.text("- 자산 KRW 기준가격은 price_usdt * usdt_krw로 산정합니다.", 18, 108);

  doc.text("손익 계산 방법:", 14, 122);
  doc.text("- 실현손익은 FIFO(선입선출) 방식으로 계산합니다.", 18, 130);

  doc.text(`생성 시각(UTC): ${new Date().toISOString()}`, 14, 144);

  return doc.output("arraybuffer");
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
    .replace(/[\uFEFF]/g, "")
    .replace(/[\t ]+/g, " ")
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
    return "";
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

  const knownQuotes = ["USDT", "USDC", "BUSD", "FDUSD", "USD", "KRW", "BTC", "ETH"];
  for (const quote of knownQuotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return [normalized.slice(0, -quote.length), quote];
    }
  }

  return ["", ""];
}

function convertQuoteValueToUsdt(value, quoteAsset, usdtKrw) {
  if (!Number.isFinite(value)) return NaN;
  const quote = String(quoteAsset || "").toUpperCase();
  if (USD_STABLE_ASSETS.has(quote)) return value;
  if (quote === "KRW") return value / usdtKrw;
  return NaN;
}

function convertFeeToUsdt({ fee, feeAsset, baseAsset, quoteAsset, priceUsdt, usdtKrw }) {
  if (!Number.isFinite(fee) || fee === 0) return 0;

  const feeCoin = String(feeAsset || "").toUpperCase();
  const quote = String(quoteAsset || "").toUpperCase();
  const base = String(baseAsset || "").toUpperCase();

  if (feeCoin === quote) {
    return convertQuoteValueToUsdt(fee, quote, usdtKrw);
  }
  if (feeCoin === base && Number.isFinite(priceUsdt)) {
    return fee * priceUsdt;
  }
  if (USD_STABLE_ASSETS.has(feeCoin)) {
    return fee;
  }
  if (feeCoin === "KRW") {
    return fee / usdtKrw;
  }
  return 0;
}

function getUsdtKrwAt() {
  return DEFAULT_USDT_KRW;
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function formatNumber(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}
