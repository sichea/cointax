import { buildEvmImportPlaceholder } from "../onchain/evm_import_placeholder.js";
import { buildSolanaImportPlaceholder } from "../onchain/solana_import_placeholder.js";
import {
  CHAIN_FAMILIES,
  disableWalletAddress,
  listWalletAddresses,
  removeWalletAddress,
  saveWalletAddress,
} from "./wallet_registry.js";

export function addWalletAddress(input, options) {
  return saveWalletAddress(input, options);
}

export function listRegisteredWalletAddresses(options) {
  return listWalletAddresses(options);
}

export function disableRegisteredWalletAddress(id, options) {
  return disableWalletAddress(id, options);
}

export function removeRegisteredWalletAddress(id, options) {
  return removeWalletAddress(id, options);
}

export function collectWalletImportRequests({ userOwnedAddresses = [] } = {}) {
  return userOwnedAddresses
    .filter((address) => address.is_active)
    .map((address) => {
      if (address.chain_family === CHAIN_FAMILIES.SOLANA) {
        return buildSolanaImportPlaceholder(address);
      }
      return buildEvmImportPlaceholder(address);
    });
}
