export const TRANSFER_RECORDS_HEADERS = [
  "timestamp",
  "chain",
  "asset",
  "amount",
  "withdrawal_source_exchange",
  "deposit_source_exchange",
  "from_exchange_or_wallet",
  "to_exchange_or_wallet",
  "from_label",
  "to_label",
  "involves_user_owned_address",
  "transfer_group_id",
  "transfer_match_status",
  "transfer_match_confidence",
  "transfer_match_reason",
  "tx_hash",
  "note",
];

export function buildTransferRecordRows(unifiedTransactions) {
  const groupedTransfers = buildTransferGroupLookup(unifiedTransactions);

  return unifiedTransactions
    .filter((tx) =>
      tx.event_type === "TRANSFER_IN"
      || tx.event_type === "TRANSFER_OUT"
      || tx.event_type === "INTERNAL_TRANSFER"
      || tx.event_type === "DEPOSIT"
      || tx.event_type === "WITHDRAWAL"
    )
    .map((tx) => {
      const group = groupedTransfers.get(tx.transfer_group_id) || {};
      return {
        timestamp: tx.timestamp,
        chain: tx.chain,
        asset: tx.asset_in || tx.asset_out,
        amount: tx.amount_in || tx.amount_out,
        withdrawal_source_exchange: group.withdrawal_source_exchange || "",
        deposit_source_exchange: group.deposit_source_exchange || "",
        from_exchange_or_wallet: tx.from_address_label || tx.from_address || tx.source_name,
        to_exchange_or_wallet: tx.to_address_label || tx.to_address || tx.source_name,
        from_label: tx.from_address_label || tx.wallet_address_label || "",
        to_label: tx.to_address_label || tx.wallet_address_label || "",
        involves_user_owned_address: tx.involves_user_owned_address ? "YES" : "NO",
        transfer_group_id: tx.transfer_group_id,
        transfer_match_status: tx.transfer_match_status,
        transfer_match_confidence: tx.transfer_match_confidence,
        transfer_match_reason: tx.transfer_match_reason,
        tx_hash: tx.tx_hash,
        note: tx.note,
      };
    });
}

function buildTransferGroupLookup(unifiedTransactions) {
  const grouped = new Map();

  for (const tx of unifiedTransactions) {
    if (!tx.transfer_group_id) continue;
    if (!grouped.has(tx.transfer_group_id)) {
      grouped.set(tx.transfer_group_id, {
        withdrawal_source_exchange: "",
        deposit_source_exchange: "",
      });
    }

    const row = grouped.get(tx.transfer_group_id);
    if (tx.event_type === "WITHDRAWAL" || isMatchedOutgoingTransfer(tx)) {
      row.withdrawal_source_exchange = row.withdrawal_source_exchange || getSourceExchange(tx);
    }
    if (tx.event_type === "DEPOSIT" || isMatchedIncomingTransfer(tx)) {
      row.deposit_source_exchange = row.deposit_source_exchange || getSourceExchange(tx);
    }
  }

  return grouped;
}

function isMatchedOutgoingTransfer(tx) {
  return tx.event_type === "INTERNAL_TRANSFER" && Number(tx.amount_out) > 0;
}

function isMatchedIncomingTransfer(tx) {
  return tx.event_type === "INTERNAL_TRANSFER" && Number(tx.amount_in) > 0;
}

function getSourceExchange(tx) {
  const exchange = String(tx.exchange || "").trim();
  if (exchange) return exchange;

  const sourceName = String(tx.source_name || "").trim();
  if (sourceName.includes("Binance")) return "Binance";
  if (sourceName.includes("Bybit")) return "Bybit";
  return sourceName;
}
