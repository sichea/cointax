export function buildAuditTrailReferences() {
  return {
    title: "Audit Trail References",
    files: [
      {
        file: "transaction_ledger.csv",
        description: "Full normalized ledger across exchange and wallet activity, including pricing, labels, hashes, and ownership context.",
      },
      {
        file: "trade_profit_report.csv",
        description: "FIFO lot matching for realized gains with buy and sell transaction references.",
      },
      {
        file: "airdrop_income.csv",
        description: "Airdrop valuation details at receive time in KRW.",
      },
      {
        file: "defi_income.csv",
        description: "Staking and DeFi reward valuation details in KRW.",
      },
      {
        file: "transfer_records.csv",
        description: "Matched and unmatched transfer evidence including wallet labels and ownership context.",
      },
      {
        file: "fx_rates.csv",
        description: "Historical FX records used for KRW conversion.",
      },
      {
        file: "tax_summary.pdf",
        description: "High-level tax totals used as the summary cover sheet.",
      },
    ],
  };
}
