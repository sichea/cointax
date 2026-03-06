import { SOURCE_TYPES } from "./source_types.js";

export function collectWalletImportRequests({ evmAddress, solanaAddress }) {
  const requests = [];
  const evm = String(evmAddress || "").trim();
  const sol = String(solanaAddress || "").trim();

  if (evm) {
    requests.push({
      source_type: SOURCE_TYPES.WALLET_ONCHAIN,
      source_name: "EVM Wallet Import",
      wallet_address: evm,
      chain: "EVM",
      protocol: "",
    });
  }

  if (sol) {
    requests.push({
      source_type: SOURCE_TYPES.WALLET_ONCHAIN,
      source_name: "Solana Wallet Import",
      wallet_address: sol,
      chain: "SOLANA",
      protocol: "",
    });
  }

  return requests;
}

export function parseWalletImportsPlaceholder(walletImportRequests) {
  void walletImportRequests;
  // Placeholder: future on-chain fetch + parsing.
  return [];
}
