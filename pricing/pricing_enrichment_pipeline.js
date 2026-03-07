import { resolveTransactionPricing } from "./historical_price_resolver.js";
import { PRICING_SOURCE_MISSING } from "./price_service.js";

export function enrichTransactionsWithPricing(unifiedTransactions) {
  let pricedCount = 0;
  let missingPriceCount = 0;

  const transactions = unifiedTransactions.map((tx) => {
    const pricing = resolveTransactionPricing(tx);
    const enriched = {
      ...tx,
      ...pricing,
      updated_at: new Date().toISOString(),
    };

    if (pricing.pricing_source === PRICING_SOURCE_MISSING) {
      missingPriceCount += 1;
    } else {
      pricedCount += 1;
    }

    return enriched;
  });

  return {
    transactions,
    summary: {
      pricedCount,
      missingPriceCount,
      fxRateApplied: "USDT/KRW",
      pricingSource: pricedCount ? "historical price service" : PRICING_SOURCE_MISSING,
    },
  };
}
