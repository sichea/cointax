import { AIRDROP_INCOME_HEADERS, buildAirdropIncomeRows } from "../reports/airdrop_income_report.js";
import { DEFI_INCOME_HEADERS, buildDefiIncomeRows } from "../reports/defi_income_report.js";
import { buildNarrativeJsonString } from "./narrative_json_exporter.js";
import { buildNarrativeTaxReportPdf } from "./narrative_pdf_exporter.js";
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
  "narrative_tax_report.pdf",
  "narrative_tax_report.json",
];

const FX_HEADERS = ["timestamp", "usdt_krw", "btc_krw", "eth_krw", "source"];

export async function buildZipEvidencePackage({ unifiedTransactions, realizedLots, fxRates, summary, narrativeReport }) {
  const zip = new JSZip();

  zip.file("transaction_ledger.csv", toCsv(TRANSACTION_LEDGER_HEADERS, buildTransactionLedgerRows(unifiedTransactions)));
  zip.file("trade_profit_report.csv", toCsv(TRADE_PROFIT_HEADERS, buildTradeProfitRows(realizedLots)));
  zip.file("airdrop_income.csv", toCsv(AIRDROP_INCOME_HEADERS, buildAirdropIncomeRows(unifiedTransactions)));
  zip.file("defi_income.csv", toCsv(DEFI_INCOME_HEADERS, buildDefiIncomeRows(unifiedTransactions)));
  zip.file("transfer_records.csv", toCsv(TRANSFER_RECORDS_HEADERS, buildTransferRecordRows(unifiedTransactions)));
  zip.file("fx_rates.csv", toCsv(FX_HEADERS, fxRates));
  zip.file("tax_summary.pdf", buildTaxSummaryPdf(summary));
  zip.file("narrative_tax_report.pdf", buildNarrativeTaxReportPdf(narrativeReport));
  zip.file("narrative_tax_report.json", buildNarrativeJsonString(narrativeReport));

  return zip.generateAsync({ type: "blob" });
}

function toCsv(headers, rows) {
  if (!rows.length) return headers.join(",");
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
