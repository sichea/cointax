export const TRANSACTION_LEDGER_HEADERS = [
  "timestamp",
  "source_type",
  "source_name",
  "exchange",
  "chain",
  "protocol",
  "wallet_address",
  "from_address",
  "to_address",
  "wallet_or_source",
  "wallet_or_destination",
  "transaction_type",
  "base_asset",
  "quote_asset",
  "amount",
  "price_usdt",
  "price_krw",
  "fee",
  "fee_asset",
  "tx_hash",
  "source_file",
  "note",
];

export function buildTransactionLedgerRows(events) {
  return events.map((event) => ({
    timestamp: event.timestamp,
    source_type: event.source_type,
    source_name: event.source_name,
    exchange: event.exchange,
    chain: event.chain,
    protocol: event.protocol,
    wallet_address: event.wallet_address,
    from_address: event.from_address,
    to_address: event.to_address,
    wallet_or_source: event.wallet_or_source,
    wallet_or_destination: event.wallet_or_destination,
    transaction_type: event.transaction_type,
    base_asset: event.base_asset,
    quote_asset: event.quote_asset,
    amount: round(event.amount),
    price_usdt: round(event.price_usdt),
    price_krw: round(event.price_krw),
    fee: round(event.fee),
    fee_asset: event.fee_asset,
    tx_hash: event.tx_hash,
    source_file: event.source_file,
    note: event.note,
  }));
}

function round(value) {
  if (!Number.isFinite(value)) return "";
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
