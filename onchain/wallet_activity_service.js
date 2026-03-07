import { TRANSACTION_STATUS } from "../classifiers/event_classifier.js";
import { classifyOnchainUnifiedTransactions } from "../classifiers/onchain_event_classifier.js";
import { listOnchainTransactions, upsertOnchainTransactions } from "../db/onchain_transactions_table.js";
import { upsertWalletSyncJob, listWalletSyncJobs } from "../db/wallet_sync_jobs_table.js";
import { ingestEvmWalletActivity } from "./ingestion/evm_wallet_ingestor.js";
import { ingestSolanaWalletActivity } from "./ingestion/solana_wallet_ingestor.js";
import { CHAIN_FAMILIES, listWalletAddresses } from "../wallets/wallet_registry.js";

export const WALLET_SYNC_JOB_STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  PARTIAL_SUCCESS: "PARTIAL_SUCCESS",
  FAILED: "FAILED",
});

export async function ingestWalletActivity(userId, walletAddressId) {
  const walletRecord = listWalletAddresses({ userId, includeInactive: false }).find((row) => row.id === walletAddressId);
  if (!walletRecord) {
    throw new Error("활성 지갑 주소를 찾을 수 없습니다.");
  }

  const startedAt = new Date().toISOString();
  const job = upsertWalletSyncJob({
    id: createJobId(walletRecord.id),
    user_id: userId,
    wallet_address_id: walletRecord.id,
    chain_family: walletRecord.chain_family,
    chain: walletRecord.chain,
    started_at: startedAt,
    finished_at: "",
    status: WALLET_SYNC_JOB_STATUS.RUNNING,
    imported_count: 0,
    updated_count: 0,
    skipped_count: 0,
    error_message: "",
  });

  try {
    const result = walletRecord.chain_family === CHAIN_FAMILIES.SOLANA
      ? await ingestSolanaWalletActivity(walletRecord, { userId })
      : await ingestEvmWalletActivity(walletRecord, { userId });

    const classifiedRows = classifyOnchainUnifiedTransactions(result.normalizedRows);
    const upsert = upsertOnchainTransactions(classifiedRows);
    result.normalizedRows = classifiedRows;
    result.importedCount = upsert.importedCount;
    result.updatedCount = upsert.updatedCount;
    result.skippedCount = upsert.skippedCount;

    const stats = buildActivityStats(classifiedRows);
    const status = result.importedCount > 0 || result.updatedCount > 0
      ? WALLET_SYNC_JOB_STATUS.SUCCESS
      : WALLET_SYNC_JOB_STATUS.PARTIAL_SUCCESS;

    const finished = upsertWalletSyncJob({
      ...job,
      finished_at: new Date().toISOString(),
      status,
      imported_count: result.importedCount,
      updated_count: result.updatedCount,
      skipped_count: result.skippedCount,
      error_message: "",
    });

    return {
      wallet: walletRecord,
      job: finished,
      ...result,
      ...stats,
    };
  } catch (error) {
    const finished = upsertWalletSyncJob({
      ...job,
      finished_at: new Date().toISOString(),
      status: WALLET_SYNC_JOB_STATUS.FAILED,
      error_message: error.message,
    });

    return {
      wallet: walletRecord,
      job: finished,
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      normalizedRows: [],
      unknownCount: 0,
      transferLikeCount: 0,
      swapLikeCount: 0,
      error: error.message,
    };
  }
}

export async function syncAllUserWallets(userId) {
  const wallets = listWalletAddresses({ userId, includeInactive: false });
  const results = [];
  for (const wallet of wallets) {
    results.push(await ingestWalletActivity(userId, wallet.id));
  }

  return {
    walletCount: wallets.length,
    results,
    importedCount: results.reduce((sum, item) => sum + (item.importedCount || 0), 0),
    updatedCount: results.reduce((sum, item) => sum + (item.updatedCount || 0), 0),
    skippedCount: results.reduce((sum, item) => sum + (item.skippedCount || 0), 0),
    unknownCount: results.reduce((sum, item) => sum + (item.unknownCount || 0), 0),
    transferLikeCount: results.reduce((sum, item) => sum + (item.transferLikeCount || 0), 0),
    swapLikeCount: results.reduce((sum, item) => sum + (item.swapLikeCount || 0), 0),
    classificationCounts: results.reduce((acc, item) => mergeCounts(acc, item.classificationCounts || {}), {}),
  };
}

export function listWalletSyncStatuses() {
  return listWalletSyncJobs();
}

export function buildWalletSyncStatusMap() {
  const map = new Map();
  for (const job of listWalletSyncJobs()) {
    if (!map.has(job.wallet_address_id)) {
      map.set(job.wallet_address_id, job);
    }
  }
  return map;
}

export function listSyncedOnchainTransactions(userId = "demo-user") {
  return listOnchainTransactions().filter((row) => row.user_id === userId);
}

function buildActivityStats(rows) {
  return rows.reduce(
    (acc, row) => {
      if (row.event_type === "UNKNOWN") acc.unknownCount += 1;
      if (row.event_type === "TRANSFER_IN" || row.event_type === "TRANSFER_OUT" || row.event_type === "DEPOSIT" || row.event_type === "WITHDRAWAL") {
        acc.transferLikeCount += 1;
      }
      if (row.event_type === "SWAP") acc.swapLikeCount += 1;
      if (row.status === TRANSACTION_STATUS.NORMALIZED || row.status === TRANSACTION_STATUS.CLASSIFIED) {
        acc.normalizedCount += 1;
      }
      acc.classificationCounts[row.event_type] = (acc.classificationCounts[row.event_type] || 0) + 1;
      return acc;
    },
    { unknownCount: 0, transferLikeCount: 0, swapLikeCount: 0, normalizedCount: 0, classificationCounts: {} }
  );
}

function createJobId(walletAddressId) {
  return `wsj_${walletAddressId}_${Date.now()}`;
}

function mergeCounts(base, extra) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}
