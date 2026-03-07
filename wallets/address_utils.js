export const CHAIN_FAMILIES = Object.freeze({
  EVM: "EVM",
  SOLANA: "SOLANA",
});

export const ADDRESS_TYPES = Object.freeze({
  WALLET: "WALLET",
  EXCHANGE_DEPOSIT: "EXCHANGE_DEPOSIT",
  CONTRACT: "CONTRACT",
  UNKNOWN: "UNKNOWN",
});

export const VERIFICATION_STATUS = Object.freeze({
  USER_DECLARED: "USER_DECLARED",
  VERIFIED_FORMAT: "VERIFIED_FORMAT",
  VERIFIED_SIGNATURE: "VERIFIED_SIGNATURE",
  IMPORTED: "IMPORTED",
  DISABLED: "DISABLED",
});

export const SUPPORTED_CHAINS = Object.freeze({
  EVM: ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc", "avalanche"],
  SOLANA: ["solana"],
});

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeWalletAddress(chainFamily, walletAddress) {
  const family = normalizeChainFamily(chainFamily);
  const trimmed = String(walletAddress || "").trim();

  if (!trimmed) return "";
  if (family === CHAIN_FAMILIES.EVM) return trimmed.toLowerCase();
  if (family === CHAIN_FAMILIES.SOLANA) return trimmed;
  return trimmed;
}

export function validateWalletAddress(chainFamily, walletAddress) {
  const family = normalizeChainFamily(chainFamily);
  const trimmed = String(walletAddress || "").trim();
  const normalizedAddress = normalizeWalletAddress(family, trimmed);

  if (!family) {
    return {
      valid: false,
      normalizedAddress,
      error: "지원되지 않는 chain_family 입니다.",
    };
  }

  if (!trimmed) {
    return {
      valid: false,
      normalizedAddress,
      error: "지갑 주소를 입력하세요.",
    };
  }

  if (family === CHAIN_FAMILIES.EVM) {
    if (!EVM_ADDRESS_RE.test(trimmed)) {
      return {
        valid: false,
        normalizedAddress,
        error: "EVM 주소는 0x로 시작하는 42자 16진수 주소여야 합니다.",
      };
    }

    return {
      valid: true,
      normalizedAddress,
      verificationStatus: VERIFICATION_STATUS.VERIFIED_FORMAT,
      error: "",
    };
  }

  if (family === CHAIN_FAMILIES.SOLANA) {
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      return {
        valid: false,
        normalizedAddress,
        error: "Solana 주소는 base58 형식의 32-44자 문자열이어야 합니다.",
      };
    }

    return {
      valid: true,
      normalizedAddress,
      verificationStatus: VERIFICATION_STATUS.VERIFIED_FORMAT,
      error: "",
    };
  }

  return {
    valid: false,
    normalizedAddress,
    error: "지원되지 않는 지갑 주소 형식입니다.",
  };
}

export function detectChainFamilyFromAddress(walletAddress) {
  const trimmed = String(walletAddress || "").trim();
  if (!trimmed) return null;
  if (EVM_ADDRESS_RE.test(trimmed)) return CHAIN_FAMILIES.EVM;
  if (SOLANA_ADDRESS_RE.test(trimmed)) return CHAIN_FAMILIES.SOLANA;
  return null;
}

export function normalizeChainFamily(chainFamily) {
  const value = String(chainFamily || "").trim().toUpperCase();
  if (value === CHAIN_FAMILIES.EVM) return CHAIN_FAMILIES.EVM;
  if (value === CHAIN_FAMILIES.SOLANA) return CHAIN_FAMILIES.SOLANA;
  return "";
}

export function normalizeChain(chainFamily, chain) {
  const family = normalizeChainFamily(chainFamily);
  const normalized = String(chain || "").trim().toLowerCase();
  if (!family) return "";
  if (!normalized) return family === CHAIN_FAMILIES.EVM ? "ethereum" : "solana";
  if (SUPPORTED_CHAINS[family].includes(normalized)) return normalized;
  return "";
}

export function validateChain(chainFamily, chain) {
  const normalized = normalizeChain(chainFamily, chain);
  if (!normalized) {
    return {
      valid: false,
      error: "선택한 chain_family와 맞는 chain/network를 선택하세요.",
    };
  }

  return {
    valid: true,
    chain: normalized,
    error: "",
  };
}

export function inferChainFamilyFromChain(chain) {
  const normalized = String(chain || "").trim().toLowerCase();
  if (!normalized) return null;
  if (SUPPORTED_CHAINS.EVM.includes(normalized)) return CHAIN_FAMILIES.EVM;
  if (SUPPORTED_CHAINS.SOLANA.includes(normalized)) return CHAIN_FAMILIES.SOLANA;
  return null;
}
