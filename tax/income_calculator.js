export function calculateIncomeBuckets(unifiedTransactions) {
  const airdropRows = unifiedTransactions.filter((tx) => tx.event_type === "AIRDROP");
  const stakingRows = unifiedTransactions.filter((tx) => tx.event_type === "STAKING_REWARD");
  const defiRows = unifiedTransactions.filter((tx) => tx.event_type === "DEFI_REWARD");
  const nonTaxableTransfers = unifiedTransactions.filter((tx) =>
    tx.event_type === "TRANSFER_IN"
    || tx.event_type === "TRANSFER_OUT"
    || tx.event_type === "INTERNAL_TRANSFER"
    || tx.event_type === "DEPOSIT"
    || tx.event_type === "WITHDRAWAL"
  );
  const unknownIncomeEvents = unifiedTransactions.filter((tx) =>
    tx.event_type === "UNKNOWN" && (tx.income_category === "UNKNOWN" || tx.source_type === "WALLET_ONCHAIN")
  );

  return {
    airdropIncomeKrw: sumAmount(airdropRows, "amount_in_krw"),
    stakingIncomeKrw: sumAmount(stakingRows, "amount_in_krw"),
    defiIncomeKrw: sumAmount(defiRows, "amount_in_krw"),
    totalNonTaxableTransfers: nonTaxableTransfers.length,
    unknownIncomeEvents: unknownIncomeEvents.length,
  };
}

function sumAmount(rows, field) {
  return rows.reduce((sum, row) => sum + (Number.isFinite(Number(row[field])) ? Number(row[field]) : 0), 0);
}
