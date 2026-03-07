export function buildEvmImportPlaceholder(ownedAddress) {
  return {
    importer_id: `evm:${ownedAddress.wallet_address}`,
    chain_family: ownedAddress.chain_family,
    chain: ownedAddress.chain,
    wallet_address: ownedAddress.wallet_address,
    label: ownedAddress.label,
    status: "PENDING_ONCHAIN_IMPORT",
    message: "EVM on-chain ingestion placeholder prepared from registered wallet ownership.",
  };
}
