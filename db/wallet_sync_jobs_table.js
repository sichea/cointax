const walletSyncJobs = [];

export function clearWalletSyncJobs() {
  walletSyncJobs.length = 0;
}

export function hydrateWalletSyncJobs(rows = []) {
  clearWalletSyncJobs();
  insertWalletSyncJobs(rows);
  return listWalletSyncJobs();
}

export function insertWalletSyncJobs(rows) {
  for (const row of rows) {
    walletSyncJobs.push({ ...row });
  }
}

export function listWalletSyncJobs() {
  return walletSyncJobs
    .map((row) => ({ ...row }))
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
}

export function upsertWalletSyncJob(job) {
  const index = walletSyncJobs.findIndex((row) => row.id === job.id);
  if (index < 0) {
    walletSyncJobs.push({ ...job });
    return { ...job };
  }

  walletSyncJobs[index] = { ...walletSyncJobs[index], ...job };
  return { ...walletSyncJobs[index] };
}

export function findLatestWalletSyncJob(walletAddressId) {
  return listWalletSyncJobs().find((job) => job.wallet_address_id === walletAddressId) || null;
}
