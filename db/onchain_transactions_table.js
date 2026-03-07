const onchainTransactions = [];

export function clearOnchainTransactions() {
  onchainTransactions.length = 0;
}

export function hydrateOnchainTransactions(rows = []) {
  clearOnchainTransactions();
  insertOnchainTransactions(rows);
  return listOnchainTransactions();
}

export function insertOnchainTransactions(rows) {
  for (const row of rows) {
    onchainTransactions.push({ ...row });
  }
}

export function listOnchainTransactions() {
  return onchainTransactions.map((row) => ({ ...row }));
}

export function upsertOnchainTransactions(rows, { dedupeKeyFn = defaultDedupeKey } = {}) {
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const key = dedupeKeyFn(row);
    const existingIndex = onchainTransactions.findIndex((entry) => dedupeKeyFn(entry) === key);

    if (existingIndex < 0) {
      onchainTransactions.push({ ...row });
      importedCount += 1;
      continue;
    }

    const existing = onchainTransactions[existingIndex];
    const merged = mergeRows(existing, row);
    if (isEquivalentRow(existing, merged)) {
      skippedCount += 1;
      continue;
    }

    onchainTransactions[existingIndex] = merged;
    updatedCount += 1;
  }

  return {
    importedCount,
    updatedCount,
    skippedCount,
    rows: listOnchainTransactions(),
  };
}

export function buildOnchainDedupeKey(row = {}) {
  return [
    row.user_id,
    row.chain,
    row.wallet_address,
    row.tx_hash,
    row.event_type,
    row.asset_in,
    row.asset_out,
    normalizeNum(row.amount_in),
    normalizeNum(row.amount_out),
  ].join("|");
}

function defaultDedupeKey(row) {
  return buildOnchainDedupeKey(row);
}

function mergeRows(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "created_at") continue;
    if (value === null || value === undefined || value === "") continue;
    merged[key] = value;
  }
  merged.created_at = existing.created_at || incoming.created_at || new Date().toISOString();
  merged.updated_at = incoming.updated_at || new Date().toISOString();
  return merged;
}

function isEquivalentRow(existing, merged) {
  const ignored = new Set(["updated_at"]);
  const keys = new Set([...Object.keys(existing), ...Object.keys(merged)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (existing[key] !== merged[key]) return false;
  }
  return true;
}

function normalizeNum(value) {
  return Number.isFinite(Number(value)) ? Number(value) : "";
}
