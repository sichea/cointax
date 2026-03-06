const unifiedTransactions = [];

export function clearUnifiedTransactions() {
  unifiedTransactions.length = 0;
}

export function insertUnifiedTransactions(rows) {
  for (const row of rows) {
    unifiedTransactions.push({ ...row });
  }
}

export function listUnifiedTransactions() {
  return unifiedTransactions.map((row) => ({ ...row }));
}
