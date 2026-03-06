export function buildTaxSummary(events, tradeProfitRecords, warnings) {
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
    calculationMethod: "FIFO",
    pricingBasis: "MVP fixed USDT/KRW reference",
  };
}

export function buildTaxSummaryPdf(summary) {
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
  doc.text("- USDT/KRW 기준값을 사용하며, 거래시각 기준으로 KRW 환산값을 저장합니다.", 18, 100);
  doc.text("- 자산 KRW 기준가격은 price_usdt * usdt_krw를 사용합니다.", 18, 108);

  doc.text("손익 계산 방법:", 14, 122);
  doc.text("- 실현손익은 FIFO(선입선출) 방식입니다.", 18, 130);

  doc.text(`생성 시각(UTC): ${new Date().toISOString()}`, 14, 144);

  return doc.output("arraybuffer");
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function formatNumber(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}
