CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS unified_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_file TEXT,
  raw_row_index INTEGER,
  raw_description TEXT,
  event_type TEXT NOT NULL,
  income_category TEXT NOT NULL,
  exchange TEXT,
  chain TEXT,
  protocol TEXT,
  wallet_address TEXT,
  from_address TEXT,
  to_address TEXT,
  tx_hash TEXT,
  asset_in TEXT,
  asset_out TEXT,
  amount_in NUMERIC,
  amount_out NUMERIC,
  fee NUMERIC,
  fee_asset TEXT,
  price_usdt NUMERIC,
  price_krw NUMERIC,
  amount_in_krw NUMERIC,
  amount_out_krw NUMERIC,
  fee_krw NUMERIC,
  fx_rate_usdt_krw NUMERIC,
  pricing_source TEXT,
  transfer_group_id TEXT,
  matched_lot_id TEXT,
  calculation_method TEXT,
  note TEXT,
  status TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS realized_profit_lots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  buy_transaction_id TEXT NOT NULL,
  sell_transaction_id TEXT NOT NULL,
  buy_timestamp TIMESTAMP NOT NULL,
  sell_timestamp TIMESTAMP NOT NULL,
  buy_source TEXT,
  sell_source TEXT,
  buy_amount NUMERIC,
  sell_amount NUMERIC,
  buy_price_usdt NUMERIC,
  sell_price_usdt NUMERIC,
  buy_price_krw NUMERIC,
  sell_price_krw NUMERIC,
  profit_usdt NUMERIC,
  profit_krw NUMERIC,
  calculation_method TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (buy_transaction_id) REFERENCES unified_transactions(id),
  FOREIGN KEY (sell_transaction_id) REFERENCES unified_transactions(id)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  package_name TEXT NOT NULL,
  package_path TEXT NOT NULL,
  generated_at TIMESTAMP NOT NULL,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_unified_transactions_user_timestamp
  ON unified_transactions(user_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_unified_transactions_tx_hash
  ON unified_transactions(tx_hash);

CREATE INDEX IF NOT EXISTS idx_unified_transactions_event_type
  ON unified_transactions(event_type);

CREATE INDEX IF NOT EXISTS idx_realized_profit_lots_user_asset
  ON realized_profit_lots(user_id, asset);

CREATE INDEX IF NOT EXISTS idx_fx_rates_timestamp_base_quote
  ON fx_rates(timestamp, base_currency, quote_currency);
