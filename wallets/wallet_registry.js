import {
  clearUserOwnedAddresses,
  deleteUserOwnedAddress,
  findUserOwnedAddressById,
  findUserOwnedAddressByUserAndAddress,
  insertUserOwnedAddresses,
  listUserOwnedAddresses,
  upsertUserOwnedAddress,
} from "../db/user_owned_addresses_table.js";
import {
  ADDRESS_TYPES,
  CHAIN_FAMILIES,
  SUPPORTED_CHAINS,
  VERIFICATION_STATUS,
  detectChainFamilyFromAddress,
  inferChainFamilyFromChain,
  normalizeChain,
  normalizeChainFamily,
  normalizeWalletAddress,
  validateChain,
  validateWalletAddress,
} from "./address_utils.js";

export { ADDRESS_TYPES, CHAIN_FAMILIES, SUPPORTED_CHAINS, VERIFICATION_STATUS };

export function hydrateWalletRegistry(rows = []) {
  clearUserOwnedAddresses();
  insertUserOwnedAddresses(rows);
  return listWalletAddresses({ includeInactive: true });
}

export function listWalletAddresses({ userId = "demo-user", includeInactive = true } = {}) {
  return listUserOwnedAddresses()
    .filter((row) => row.user_id === userId)
    .filter((row) => includeInactive || row.is_active)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
}

export function saveWalletAddress(input, { userId = "demo-user" } = {}) {
  const chainFamily = normalizeChainFamily(input.chain_family || input.chainFamily || detectChainFamilyFromAddress(input.wallet_address));
  const addressCheck = validateWalletAddress(chainFamily, input.wallet_address);
  if (!addressCheck.valid) {
    return {
      ok: false,
      code: "INVALID_ADDRESS",
      message: addressCheck.error,
      validation: addressCheck,
    };
  }

  const chainCheck = validateChain(chainFamily, input.chain);
  if (!chainCheck.valid) {
    return {
      ok: false,
      code: "INVALID_CHAIN",
      message: chainCheck.error,
      validation: chainCheck,
    };
  }

  const normalizedAddress = addressCheck.normalizedAddress;
  const existing = findUserOwnedAddressByUserAndAddress(userId, normalizedAddress);
  if (existing && existing.is_active) {
    return {
      ok: false,
      code: "DUPLICATE_ADDRESS",
      message: "이미 등록된 활성 지갑 주소입니다.",
      validation: { normalizedAddress },
      address: { ...existing },
    };
  }

  const now = new Date().toISOString();
  const label = String(input.label || "").trim();
  const record = {
    id: existing?.id || createWalletId(chainFamily),
    user_id: userId,
    chain_family: chainFamily,
    chain: chainCheck.chain,
    wallet_address: normalizedAddress,
    label,
    address_type: normalizeAddressType(input.address_type),
    is_active: true,
    verification_status: input.verification_status || addressCheck.verificationStatus || VERIFICATION_STATUS.USER_DECLARED,
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  upsertUserOwnedAddress(record);
  return {
    ok: true,
    code: existing ? "REACTIVATED" : "SAVED",
    message: existing ? "비활성 주소를 다시 활성화했습니다." : "지갑 주소가 저장되었습니다.",
    validation: { ...addressCheck, chain: chainCheck.chain },
    address: record,
  };
}

export function disableWalletAddress(id, { userId = "demo-user" } = {}) {
  const existing = findUserOwnedAddressById(id);
  if (!existing || existing.user_id !== userId) {
    return { ok: false, code: "NOT_FOUND", message: "지갑 주소를 찾을 수 없습니다." };
  }

  const updated = {
    ...existing,
    is_active: false,
    verification_status: VERIFICATION_STATUS.DISABLED,
    updated_at: new Date().toISOString(),
  };
  upsertUserOwnedAddress(updated);
  return { ok: true, code: "DISABLED", message: "지갑 주소를 비활성화했습니다.", address: updated };
}

export function removeWalletAddress(id, { userId = "demo-user" } = {}) {
  const existing = findUserOwnedAddressById(id);
  if (!existing || existing.user_id !== userId) {
    return { ok: false, code: "NOT_FOUND", message: "지갑 주소를 찾을 수 없습니다." };
  }

  deleteUserOwnedAddress(id);
  return { ok: true, code: "REMOVED", message: "지갑 주소를 삭제했습니다.", address: existing };
}

export function buildOwnedAddressLookup(userOwnedAddresses = []) {
  const map = new Map();
  for (const row of userOwnedAddresses) {
    if (!row?.is_active) continue;
    map.set(row.wallet_address, { ...row });
  }
  return map;
}

export function annotateTransactionsWithOwnership(unifiedTransactions, userOwnedAddresses = []) {
  const lookup = buildOwnedAddressLookup(userOwnedAddresses);
  return unifiedTransactions.map((tx) => annotateTransactionWithOwnership(tx, lookup));
}

export function annotateTransactionWithOwnership(tx, userOwnedAddressLookup) {
  const lookup = userOwnedAddressLookup instanceof Map ? userOwnedAddressLookup : buildOwnedAddressLookup(userOwnedAddressLookup);
  const txChainFamily = normalizeChainFamily(
    tx.chain_family
      || inferChainFamilyFromChain(tx.chain)
      || detectChainFamilyFromAddress(tx.wallet_address)
      || detectChainFamilyFromAddress(tx.from_address)
      || detectChainFamilyFromAddress(tx.to_address)
  );

  const walletMatch = resolveOwnedAddress(tx.wallet_address, txChainFamily, lookup);
  const fromMatch = resolveOwnedAddress(tx.from_address, txChainFamily, lookup);
  const toMatch = resolveOwnedAddress(tx.to_address, txChainFamily, lookup);

  return {
    ...tx,
    chain_family: txChainFamily || tx.chain_family || "",
    wallet_address: normalizeAddressField(tx.wallet_address, txChainFamily),
    from_address: normalizeAddressField(tx.from_address, txChainFamily),
    to_address: normalizeAddressField(tx.to_address, txChainFamily),
    wallet_user_owned_address: Boolean(walletMatch),
    from_user_owned_address: Boolean(fromMatch),
    to_user_owned_address: Boolean(toMatch),
    involves_user_owned_address: Boolean(walletMatch || fromMatch || toMatch),
    wallet_address_label: walletMatch?.label || "",
    from_address_label: fromMatch?.label || "",
    to_address_label: toMatch?.label || "",
    wallet_owned_address_id: walletMatch?.id || "",
    from_owned_address_id: fromMatch?.id || "",
    to_owned_address_id: toMatch?.id || "",
  };
}

export function describeOwnedAddress(addressRecord) {
  if (!addressRecord) return "";
  if (addressRecord.label) return `${addressRecord.label} (${addressRecord.chain})`;
  return `${addressRecord.wallet_address} (${addressRecord.chain})`;
}

function resolveOwnedAddress(rawAddress, txChainFamily, lookup) {
  const family = normalizeChainFamily(txChainFamily || detectChainFamilyFromAddress(rawAddress));
  const normalized = normalizeAddressField(rawAddress, family);
  if (!normalized) return null;
  return lookup.get(normalized) || null;
}

function normalizeAddressField(rawAddress, chainFamily) {
  const family = normalizeChainFamily(chainFamily || detectChainFamilyFromAddress(rawAddress));
  return normalizeWalletAddress(family, rawAddress);
}

function normalizeAddressType(value) {
  const type = String(value || ADDRESS_TYPES.WALLET).trim().toUpperCase();
  if (Object.values(ADDRESS_TYPES).includes(type)) return type;
  return ADDRESS_TYPES.UNKNOWN;
}

function createWalletId(chainFamily) {
  const prefix = chainFamily === CHAIN_FAMILIES.SOLANA ? "sol" : "evm";
  return `uwa_${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
