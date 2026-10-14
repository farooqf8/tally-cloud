-- Core schema. Money is NUMERIC(20,4); ledger amounts are signed (Dr +, Cr -).

CREATE TABLE companies (
  id serial PRIMARY KEY,
  name text NOT NULL,
  mailing_name text,
  address text,
  emirate text NOT NULL DEFAULT 'dubai',
  country text NOT NULL DEFAULT 'United Arab Emirates',
  trn text,
  phone text,
  email text,
  base_currency text NOT NULL DEFAULT 'AED',
  fy_start date NOT NULL,
  books_from date NOT NULL,
  vat_registered boolean NOT NULL DEFAULT true,
  locked_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (books_from >= fy_start)
);

CREATE TABLE groups (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id integer REFERENCES groups(id),
  nature text NOT NULL CHECK (nature IN ('assets','liabilities','income','expenses')),
  affects_gross_profit boolean NOT NULL DEFAULT false,
  is_reserved boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100
);
CREATE UNIQUE INDEX groups_name_uq ON groups (company_id, lower(name));

CREATE TABLE ledgers (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  alias text,
  group_id integer REFERENCES groups(id),
  opening_balance numeric(20,4) NOT NULL DEFAULT 0,
  maintain_bill_wise boolean NOT NULL DEFAULT false,
  credit_days integer,
  trn text CHECK (trn IS NULL OR trn ~ '^[0-9]{15}$'),
  address text,
  emirate text,
  country text,
  phone text,
  email text,
  vat_treatment text CHECK (vat_treatment IN ('registered','unregistered','designated_zone','gcc','overseas')),
  tax_type text CHECK (tax_type IN ('output_vat','input_vat')),
  vat_category text CHECK (vat_category IN ('standard','zero','exempt','reverse_charge','import_goods','out_of_scope')),
  vat_rate numeric(6,2),
  bank_name text,
  account_no text,
  iban text,
  swift text,
  reserved_key text,
  is_reserved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (group_id IS NOT NULL OR reserved_key = 'pl')
);
CREATE UNIQUE INDEX ledgers_name_uq ON ledgers (company_id, lower(name));
CREATE UNIQUE INDEX ledgers_reserved_uq ON ledgers (company_id, reserved_key) WHERE reserved_key IS NOT NULL;

CREATE TABLE voucher_types (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  base text NOT NULL CHECK (base IN ('contra','payment','receipt','journal','sales','purchase','credit_note','debit_note','stock_journal','physical_stock')),
  abbreviation text,
  prefix text NOT NULL DEFAULT '',
  next_number integer NOT NULL DEFAULT 1,
  auto_number boolean NOT NULL DEFAULT true,
  is_reserved boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX voucher_types_name_uq ON voucher_types (company_id, lower(name));

CREATE TABLE vouchers (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_type_id integer NOT NULL REFERENCES voucher_types(id),
  number text NOT NULL,
  date date NOT NULL,
  reference_no text,
  reference_date date,
  narration text,
  party_ledger_id integer REFERENCES ledgers(id),
  place_of_supply text,
  is_optional boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  total_amount numeric(20,4) NOT NULL DEFAULT 0,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vouchers_number_uq ON vouchers (company_id, voucher_type_id, number);
CREATE INDEX vouchers_date_idx ON vouchers (company_id, date);

CREATE TABLE ledger_entries (
  id serial PRIMARY KEY,
  voucher_id integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ledger_id integer NOT NULL REFERENCES ledgers(id),
  amount numeric(20,4) NOT NULL CHECK (amount <> 0),
  line_no integer NOT NULL,
  bank_date date
);
CREATE INDEX ledger_entries_ledger_idx ON ledger_entries (ledger_id);
CREATE INDEX ledger_entries_voucher_idx ON ledger_entries (voucher_id);

CREATE TABLE bill_allocations (
  id serial PRIMARY KEY,
  entry_id integer NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  voucher_id integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ledger_id integer NOT NULL REFERENCES ledgers(id),
  bill_type text NOT NULL CHECK (bill_type IN ('new_ref','agst_ref','advance','on_account')),
  bill_name text,
  due_date date,
  amount numeric(20,4) NOT NULL,
  CHECK (bill_type = 'on_account' OR bill_name IS NOT NULL)
);
CREATE INDEX bill_allocations_ledger_idx ON bill_allocations (ledger_id, bill_name);

CREATE TABLE vat_lines (
  id serial PRIMARY KEY,
  voucher_id integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('output','input')),
  category text NOT NULL CHECK (category IN ('standard','zero','exempt','reverse_charge','import_goods','out_of_scope')),
  emirate text,
  taxable_amount numeric(20,4) NOT NULL,
  vat_amount numeric(20,4) NOT NULL,
  recoverable boolean NOT NULL DEFAULT true
);
CREATE INDEX vat_lines_voucher_idx ON vat_lines (voucher_id);

CREATE TABLE units (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  formal_name text,
  decimals integer NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 4)
);
CREATE UNIQUE INDEX units_symbol_uq ON units (company_id, lower(symbol));

CREATE TABLE stock_groups (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id integer REFERENCES stock_groups(id)
);
CREATE UNIQUE INDEX stock_groups_name_uq ON stock_groups (company_id, lower(name));

CREATE TABLE godowns (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id integer REFERENCES godowns(id),
  is_reserved boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX godowns_name_uq ON godowns (company_id, lower(name));

CREATE TABLE stock_items (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  alias text,
  part_no text,
  stock_group_id integer REFERENCES stock_groups(id),
  unit_id integer NOT NULL REFERENCES units(id),
  opening_qty numeric(20,4) NOT NULL DEFAULT 0,
  opening_rate numeric(20,4) NOT NULL DEFAULT 0,
  opening_value numeric(20,4) NOT NULL DEFAULT 0,
  opening_godown_id integer REFERENCES godowns(id),
  vat_category text NOT NULL DEFAULT 'standard' CHECK (vat_category IN ('standard','zero','exempt','reverse_charge','import_goods','out_of_scope')),
  vat_rate numeric(6,2) NOT NULL DEFAULT 5,
  sales_price numeric(20,4),
  reorder_level numeric(20,4),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_items_name_uq ON stock_items (company_id, lower(name));

CREATE TABLE inventory_entries (
  id serial PRIMARY KEY,
  voucher_id integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stock_item_id integer NOT NULL REFERENCES stock_items(id),
  godown_id integer NOT NULL REFERENCES godowns(id),
  qty numeric(20,4) NOT NULL CHECK (qty <> 0),
  rate numeric(20,4) NOT NULL,
  amount numeric(20,4) NOT NULL,
  discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  line_no integer NOT NULL
);
CREATE INDEX inventory_entries_item_idx ON inventory_entries (stock_item_id);
CREATE INDEX inventory_entries_voucher_idx ON inventory_entries (voucher_id);

CREATE TABLE audit_log (
  id serial PRIMARY KEY,
  company_id integer REFERENCES companies(id) ON DELETE CASCADE,
  entity text NOT NULL,
  entity_id integer,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_company_idx ON audit_log (company_id, at DESC);
