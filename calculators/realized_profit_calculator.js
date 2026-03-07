import { calculateKoreanCryptoTaxes } from "../tax/tax_calculation_engine.js";

export function calculateRealizedProfit(unifiedTransactions, userId = "demo-user") {
  return calculateKoreanCryptoTaxes(unifiedTransactions, userId);
}
