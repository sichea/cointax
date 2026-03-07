export function buildPricingMethodologySection(summary = {}) {
  return {
    title: "Pricing and FX Methodology",
    bullets: [
      "Historical asset prices are resolved in USDT using the nearest available timestamp within the configured tolerance window.",
      "KRW conversion uses a USDT/KRW reference rate and falls back to USD/KRW only if a direct USDT/KRW rate is unavailable.",
      "If price or FX data is missing, the record is left unpriced and flagged with a missing pricing source rather than fabricated.",
      `Priced transactions: ${summary.pricedTransactionCount || 0}. Missing pricing: ${summary.missingPricingCount || 0}.`,
    ],
  };
}

export function buildCalculationMethodologySection() {
  return {
    title: "Calculation Methodology",
    bullets: [
      "Exchange CSV rows and on-chain wallet activity are normalized into a single unified transaction ledger.",
      "On-chain events are classified conservatively into transfers, swaps, rewards, airdrops, liquidity events, bridge-like events, or UNKNOWN when confidence is insufficient.",
      "Registered user-owned addresses are used to identify internal movements and prevent non-taxable transfers from being misread as income.",
      "Historical pricing and USDT/KRW FX rates are applied before tax calculations so KRW valuations are traceable.",
      "Realized capital gains are calculated using FIFO cost basis.",
      "Airdrops, staking rewards, and DeFi rewards are treated as income at receipt-time market value in KRW.",
      "UNKNOWN events are surfaced for manual review and are not automatically converted into taxable income.",
    ],
  };
}
