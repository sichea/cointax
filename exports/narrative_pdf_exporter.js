export function buildNarrativeTaxReportPdf(report) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(15);
  doc.text("Narrative Korean Crypto Tax Evidence Report", 14, y);
  y += 10;

  doc.setFontSize(10.5);
  y = addSection(doc, y, report.report_overview.title, [
    `User: ${report.report_overview.user_identifier}`,
    `Tax year: ${report.report_overview.tax_year}`,
    `Generated at (UTC): ${report.report_overview.generated_at}`,
    report.report_overview.narrative,
    `Transactions: ${report.report_overview.total_transaction_count}, Exchange events: ${report.report_overview.total_exchange_events}, On-chain events: ${report.report_overview.total_onchain_events}`,
    `Internal transfers: ${report.report_overview.total_internal_transfers}, Taxable events: ${report.report_overview.total_taxable_events}, Manual review: ${report.report_overview.total_unknown_manual_review_events}`,
  ]);

  y = addSection(doc, y, report.asset_flow_summary.title, report.asset_flow_summary.paragraphs || []);
  y = addSection(doc, y, report.internal_transfer_summary.title, [
    ...(report.internal_transfer_summary.paragraphs || []),
    ...((report.internal_transfer_summary.examples || []).slice(0, 4).map((item) => `${item.asset} ${item.amount} | ${item.from} -> ${item.to} | ${item.reason}`)),
  ]);
  y = addSection(doc, y, report.trading_gain_summary.title, [
    ...(report.trading_gain_summary.paragraphs || []),
    ...((report.trading_gain_summary.items || []).slice(0, 4).map((item) => `${item.asset}: ${formatNumber(item.total_profit_krw)} KRW realized gain`)),
  ]);
  y = addSection(doc, y, report.airdrop_income_summary.title, [
    ...((report.airdrop_income_summary.items || []).slice(0, 4).map((item) => `${item.asset} ${item.amount} received on ${item.receive_timestamp} | ${formatNumber(item.income_krw)} KRW | ${item.wallet}`)),
  ]);
  y = addSection(doc, y, report.defi_income_summary.title, [
    ...((report.defi_income_summary.items || []).slice(0, 4).map((item) => `${item.event_type} ${item.asset} ${item.amount} via ${item.protocol} | ${formatNumber(item.income_krw)} KRW`)),
  ]);
  y = addSection(doc, y, report.unknown_manual_review.title, [
    ...(report.unknown_manual_review.paragraphs || []),
    ...((report.unknown_manual_review.items || []).slice(0, 5).map((item) => `${item.chain} ${item.tx_hash || "(no hash)"} | ${item.wallet_label} | ${truncate(item.reason, 110)}`)),
  ]);
  y = addSection(doc, y, report.pricing_methodology.title, report.pricing_methodology.bullets || []);
  y = addSection(doc, y, report.calculation_methodology.title, report.calculation_methodology.bullets || []);
  y = addSection(doc, y, report.audit_trail_references.title, (report.audit_trail_references.files || []).map((item) => `${item.file}: ${item.description}`));

  return doc.output("arraybuffer");
}

function addSection(doc, y, title, lines) {
  y = ensurePage(doc, y, 22);
  doc.setFontSize(12);
  doc.text(title, 14, y);
  y += 7;
  doc.setFontSize(10.5);
  const safeLines = lines.length ? lines : ["No items available."];
  for (const line of safeLines) {
    const wrapped = doc.splitTextToSize(`- ${line}`, 180);
    y = ensurePage(doc, y, wrapped.length * 6 + 4);
    doc.text(wrapped, 16, y);
    y += wrapped.length * 6;
  }
  return y + 4;
}

function ensurePage(doc, y, neededHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + neededHeight <= pageHeight - 12) return y;
  doc.addPage();
  return 18;
}

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(Number(value)) ? Number(value) : 0);
}
