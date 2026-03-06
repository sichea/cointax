export function buildTaxSummary(unifiedTransactions, realizedLots, warnings) {
  const totalTradingProfitKrw = realizedLots.filter((lot) => lot.profit_krw > 0).reduce((sum, lot) => sum + lot.profit_krw, 0);
  const totalTradingLossKrw = Math.abs(realizedLots.filter((lot) => lot.profit_krw < 0).reduce((sum, lot) => sum + lot.profit_krw, 0));

  const totalTradingProfitUsdt = realizedLots.filter((lot) => lot.profit_usdt > 0).reduce((sum, lot) => sum + lot.profit_usdt, 0);
  const totalTradingLossUsdt = Math.abs(realizedLots.filter((lot) => lot.profit_usdt < 0).reduce((sum, lot) => sum + lot.profit_usdt, 0));

  const totalAirdropIncomeKrw = unifiedTransactions
    .filter((tx) => tx.income_category === "AIRDROP_INCOME")
    .reduce((sum, tx) => sum + safeNum(tx.amount_in_krw), 0);

  const totalDefiIncomeKrw = unifiedTransactions
    .filter((tx) => tx.income_category === "DEFI_INCOME" || tx.income_category === "STAKING_INCOME")
    .reduce((sum, tx) => sum + safeNum(tx.amount_in_krw), 0);

  const netTradingProfitKrw = totalTradingProfitKrw - totalTradingLossKrw;
  const netTradingProfitUsdt = totalTradingProfitUsdt - totalTradingLossUsdt;

  return {
    totalTransactionCount: unifiedTransactions.length,
    totalTradingProfitUsdt: round(totalTradingProfitUsdt),
    totalTradingLossUsdt: round(totalTradingLossUsdt),
    netTradingProfitUsdt: round(netTradingProfitUsdt),
    totalTradingProfitKrw: round(totalTradingProfitKrw),
    totalTradingLossKrw: round(totalTradingLossKrw),
    netTradingProfitKrw: round(netTradingProfitKrw),
    totalAirdropIncomeKrw: round(totalAirdropIncomeKrw),
    totalDefiIncomeKrw: round(totalDefiIncomeKrw),
    totalTaxableAmountKrw: round(netTradingProfitKrw + totalAirdropIncomeKrw + totalDefiIncomeKrw),
    unmatchedSellWarnings: warnings.length,
  };
}

export function buildTaxSummaryPdf(summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(15);
  doc.text("코인 세무 제출용 증빙자료 요약", 14, 18);

  doc.setFontSize(11);
  doc.text(`총 거래 건수: ${summary.totalTransactionCount}`, 14, 30);
  doc.text(`총 거래 이익 (KRW): ${format(summary.totalTradingProfitKrw)}`, 14, 38);
  doc.text(`총 거래 손실 (KRW): ${format(summary.totalTradingLossKrw)}`, 14, 46);
  doc.text(`순 거래 손익 (KRW): ${format(summary.netTradingProfitKrw)}`, 14, 54);
  doc.text(`총 에어드랍 소득 (KRW): ${format(summary.totalAirdropIncomeKrw)}`, 14, 62);
  doc.text(`총 DeFi/스테이킹 소득 (KRW): ${format(summary.totalDefiIncomeKrw)}`, 14, 70);
  doc.text(`총 과세대상 금액 (KRW): ${format(summary.totalTaxableAmountKrw)}`, 14, 78);

  doc.text("기준 가격/환율 설명:", 14, 92);
  doc.text("- unified ledger에 USDT/KRW 환율 및 가격 기준(source)을 함께 저장합니다.", 18, 100);
  doc.text("- 모든 보고서는 unified_transactions를 단일 원천으로 생성됩니다.", 18, 108);

  doc.text("실현손익 계산 방법:", 14, 122);
  doc.text("- FIFO 방식으로 buy/sell lot를 매칭했습니다.", 18, 130);

  doc.text(`생성 시각(UTC): ${new Date().toISOString()}`, 14, 144);

  return doc.output("arraybuffer");
}

function safeNum(value) {
  return Number.isFinite(value) ? value : 0;
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function format(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}
