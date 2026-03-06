import { AIRDROP_INCOME_HEADERS, buildAirdropIncomeRows } from "../reports/airdrop_income_report.js";
import { DEFI_INCOME_HEADERS, buildDefiIncomeRows } from "../reports/defi_income_report.js";
import { TRANSACTION_LEDGER_HEADERS, buildTransactionLedgerRows } from "../reports/transaction_ledger_report.js";
import { TRADE_PROFIT_HEADERS, buildTradeProfitRows } from "../reports/trade_profit_report.js";
import { TRANSFER_RECORDS_HEADERS, buildTransferRecordRows } from "../reports/transfer_records_report.js";
import { buildTaxSummaryPdf } from "../reports/tax_summary_report.js";

export const OUTPUT_FILES = [
  "transaction_ledger.csv",
  "trade_profit_report.csv",
  "airdrop_income.csv",
  "defi_income.csv",
  "transfer_records.csv",
  "fx_rates.csv",
  "tax_summary.pdf",
];

const FX_HEADERS = ["timestamp", "usdt_krw", "btc_krw", "eth_krw", "source"];

export async function buildEvidenceZip({ events, tradeProfitRecords, fxRates, summary }) {
  const zip = new JSZip();

  zip.file("transaction_ledger.csv", toCsvWithHeaders(TRANSACTION_LEDGER_HEADERS, buildTransactionLedgerRows(events)));
  zip.file("trade_profit_report.csv", toCsvWithHeaders(TRADE_PROFIT_HEADERS, buildTradeProfitRows(tradeProfitRecords)));
  zip.file("airdrop_income.csv", toCsvWithHeaders(AIRDROP_INCOME_HEADERS, buildAirdropIncomeRows(events)));
  zip.file("defi_income.csv", toCsvWithHeaders(DEFI_INCOME_HEADERS, buildDefiIncomeRows(events)));
  zip.file("transfer_records.csv", toCsvWithHeaders(TRANSFER_RECORDS_HEADERS, buildTransferRecordRows(events)));
  zip.file("fx_rates.csv", toCsvWithHeaders(FX_HEADERS, fxRates));
  zip.file("tax_summary.pdf", buildTaxSummaryPdf(summary));

  return zip.generateAsync({ type: "blob" });
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
