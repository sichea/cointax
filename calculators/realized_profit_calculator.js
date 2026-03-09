import { calculateKoreanCryptoTaxes } from "../tax/tax_calculation_engine.js?v=b2fe5e0";

export function calculateRealizedProfit(unifiedTransactions, userId = "demo-user") {
  return calculateKoreanCryptoTaxes(unifiedTransactions, userId);
}
