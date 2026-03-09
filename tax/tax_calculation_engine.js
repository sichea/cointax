import { calculateFifoCapitalGains } from "./fifo_gain_calculator.js";
import { calculateIncomeBuckets } from "./income_calculator.js";

export function calculateKoreanCryptoTaxes(unifiedTransactions, userId = "demo-user") {
  const fifo = calculateFifoCapitalGains(unifiedTransactions, userId);
  const income = calculateIncomeBuckets(fifo.transactions);

  const totalCapitalGainKrw = fifo.lots.reduce((sum, lot) => sum + (Number.isFinite(lot.profit_krw) ? lot.profit_krw : 0), 0);
  const totalTaxableIncomeKrw = totalCapitalGainKrw + income.airdropIncomeKrw + income.stakingIncomeKrw + income.defiIncomeKrw;

  return {
    unifiedTransactions: fifo.transactions,
    realizedLots: fifo.lots,
    warnings: fifo.warnings,
    realizedSellCount: fifo.realizedSellCount,
    taxSummary: {
      capital_gain_krw: round(totalCapitalGainKrw),
      airdrop_income_krw: round(income.airdropIncomeKrw),
      staking_income_krw: round(income.stakingIncomeKrw),
      defi_income_krw: round(income.defiIncomeKrw),
      total_taxable_income_krw: round(totalTaxableIncomeKrw),
      total_capital_gain_krw: round(totalCapitalGainKrw),
      total_airdrop_income_krw: round(income.airdropIncomeKrw),
      total_staking_income_krw: round(income.stakingIncomeKrw),
      total_defi_income_krw: round(income.defiIncomeKrw),
      total_non_taxable_transfers: income.totalNonTaxableTransfers,
      unknown_income_events: income.unknownIncomeEvents,
      calculation_method: "FIFO",
    },
  };
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
