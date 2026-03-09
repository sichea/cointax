import { calculateKoreanCryptoTaxes } from "../tax/tax_calculation_engine.js?v=f0469f8";

export function calculateRealizedProfit(unifiedTransactions, userId = "demo-user") {
  return calculateKoreanCryptoTaxes(unifiedTransactions, userId);
}
