import { buildNarrativeSections } from "./narrative_section_builder.js";

export function buildNarrativeTaxReport({ unifiedTransactions = [], realizedLots = [], summary = {}, fxRates = [], userId = "demo-user" } = {}) {
  const sections = buildNarrativeSections({ unifiedTransactions, realizedLots, summary, userId });

  return {
    report_overview: sections.report_overview,
    asset_flow_summary: sections.asset_flow_summary,
    exchange_activity_summary: sections.exchange_activity_summary,
    wallet_activity_summary: sections.wallet_activity_summary,
    internal_transfer_summary: sections.internal_transfer_summary,
    trading_gain_summary: sections.trading_gain_summary,
    airdrop_income_summary: sections.airdrop_income_summary,
    defi_income_summary: sections.defi_income_summary,
    unknown_manual_review: sections.unknown_manual_review,
    pricing_methodology: {
      ...sections.pricing_methodology,
      fx_reference_count: fxRates.length,
    },
    calculation_methodology: sections.calculation_methodology,
    audit_trail_references: sections.audit_trail_references,
  };
}
