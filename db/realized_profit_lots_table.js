const realizedProfitLots = [];

export function clearRealizedProfitLots() {
  realizedProfitLots.length = 0;
}

export function insertRealizedProfitLots(rows) {
  for (const row of rows) {
    realizedProfitLots.push({ ...row });
  }
}

export function listRealizedProfitLots() {
  return realizedProfitLots.map((row) => ({ ...row }));
}
