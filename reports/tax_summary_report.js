export function buildTaxSummary(unifiedTransactions, realizedLots, warnings) {
  const totalCapitalGainKrw = realizedLots.reduce((sum, lot) => sum + safeNum(lot.profit_krw), 0);
  const totalCapitalGainUsdt = realizedLots.reduce((sum, lot) => sum + safeNum(lot.profit_usdt), 0);

  const totalAirdropIncomeKrw = unifiedTransactions
    .filter((tx) => tx.income_category === "AIRDROP_INCOME")
    .reduce((sum, tx) => sum + incomeValueKrw(tx), 0);

  const totalStakingIncomeKrw = unifiedTransactions
    .filter((tx) => tx.income_category === "STAKING_INCOME")
    .reduce((sum, tx) => sum + incomeValueKrw(tx), 0);

  const totalDefiIncomeKrw = unifiedTransactions
    .filter((tx) => tx.income_category === "DEFI_INCOME")
    .reduce((sum, tx) => sum + incomeValueKrw(tx), 0);

  const totalNonTaxableTransfers = unifiedTransactions.filter((tx) =>
    tx.event_type === "TRANSFER_IN"
    || tx.event_type === "TRANSFER_OUT"
    || tx.event_type === "INTERNAL_TRANSFER"
    || tx.event_type === "DEPOSIT"
    || tx.event_type === "WITHDRAWAL"
  ).length;

  const unknownIncomeEvents = unifiedTransactions.filter((tx) => tx.event_type === "UNKNOWN").length;

  const totalTaxableIncomeKrw = totalCapitalGainKrw + totalAirdropIncomeKrw + totalStakingIncomeKrw + totalDefiIncomeKrw;

  return {
    totalTransactionCount: unifiedTransactions.length,
    totalTradingProfitUsdt: round(totalCapitalGainUsdt),
    totalTradingLossUsdt: 0,
    netTradingProfitUsdt: round(totalCapitalGainUsdt),
    totalTradingProfitKrw: round(totalCapitalGainKrw),
    totalTradingLossKrw: 0,
    netTradingProfitKrw: round(totalCapitalGainKrw),
    capital_gain_krw: round(totalCapitalGainKrw),
    airdrop_income_krw: round(totalAirdropIncomeKrw),
    staking_income_krw: round(totalStakingIncomeKrw),
    defi_income_krw: round(totalDefiIncomeKrw),
    total_taxable_income_krw: round(totalTaxableIncomeKrw),
    totalCapitalGainKrw: round(totalCapitalGainKrw),
    totalAirdropIncomeKrw: round(totalAirdropIncomeKrw),
    totalStakingIncomeKrw: round(totalStakingIncomeKrw),
    totalDefiIncomeKrw: round(totalDefiIncomeKrw),
    totalTaxableAmountKrw: round(totalTaxableIncomeKrw),
    totalNonTaxableTransfers,
    unknownIncomeEvents,
    pricedTransactionCount: unifiedTransactions.filter((tx) => Number.isFinite(tx.price_krw)).length,
    missingPricingCount: unifiedTransactions.filter((tx) => !Number.isFinite(tx.price_krw)).length,
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
  doc.text(`총 에어드랍 소득 (KRW): ${format(summary.airdrop_income_krw)}`, 14, 62);
  doc.text(`총 스테이킹 소득 (KRW): ${format(summary.staking_income_krw)}`, 14, 70);
  doc.text(`총 DeFi 소득 (KRW): ${format(summary.defi_income_krw)}`, 14, 78);
  doc.text(`총 과세대상 금액 (KRW): ${format(summary.total_taxable_income_krw)}`, 14, 86);
  doc.text(`비과세 내부이동 건수: ${summary.totalNonTaxableTransfers}`, 14, 94);
  doc.text(`수동 검토 필요 UNKNOWN 건수: ${summary.unknownIncomeEvents}`, 14, 102);
  doc.text(`가격 계산 완료 건수: ${summary.pricedTransactionCount}`, 14, 110);
  doc.text(`가격 누락 건수: ${summary.missingPricingCount}`, 14, 118);

  doc.text("기준 가격/환율 설명:", 14, 132);
  doc.text("- unified ledger에 USDT/KRW 환율 및 가격 기준(source)을 함께 저장합니다.", 18, 140);
  doc.text("- 모든 보고서는 unified_transactions를 단일 원천으로 생성됩니다.", 18, 148);

  doc.text("실현손익 계산 방법:", 14, 162);
  doc.text("- FIFO 방식으로 buy/sell lot를 매칭했습니다.", 18, 170);

  doc.text(`생성 시각(UTC): ${new Date().toISOString()}`, 14, 184);

  return doc.output("arraybuffer");
}

function safeNum(value) {
  return Number.isFinite(value) ? value : 0;
}

function incomeValueKrw(tx) {
  const amount = Number(tx.amount_in);
  const priceKrw = Number(tx.price_krw);
  if (Number.isFinite(amount) && amount > 0 && Number.isFinite(priceKrw)) {
    return amount * priceKrw;
  }
  return safeNum(Number(tx.amount_in_krw));
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function format(num) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(num) ? num : 0);
}
