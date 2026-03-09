import { resolveTransactionPricing } from "./historical_price_resolver.js";
import { PRICING_SOURCE_MISSING } from "./price_service.js";

export async function enrichTransactionsWithPricing(unifiedTransactions) {
  let pricedCount = 0;
  let missingPriceCount = 0;
  const pricingSources = new Set();

  const transactions = await Promise.all(unifiedTransactions.map(async (tx) => {
    const pricing = await resolveTransactionPricing(tx);
    const enriched = {
      ...tx,
      ...pricing,
      updated_at: new Date().toISOString(),
    };

    if (pricing.pricing_source === PRICING_SOURCE_MISSING) {
      missingPriceCount += 1;
    } else {
      pricedCount += 1;
      pricingSources.add(pricing.pricing_source);
    }

    return enriched;
  }));

  return {
    transactions,
    summary: {
      pricedCount,
      missingPriceCount,
      priced_transactions: pricedCount,
      missing_pricing_count: missingPriceCount,
      fxRateApplied: "USDT/KRW",
      pricingSource: pricedCount ? Array.from(pricingSources).sort().join(", ") : PRICING_SOURCE_MISSING,
      pricing_source: pricedCount ? Array.from(pricingSources).sort().join(", ") : PRICING_SOURCE_MISSING,
    },
  };
}
