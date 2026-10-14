// Drizzle table definitions. These mirror migrations/*.sql exactly; the SQL files are the
// source of truth for DDL (they also carry the integrity triggers Drizzle cannot express).
import { pgTable, serial, integer, text, boolean, date, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

export type Nature = 'assets' | 'liabilities' | 'income' | 'expenses';
export type VoucherBase =
  | 'contra' | 'payment' | 'receipt' | 'journal'
  | 'sales' | 'purchase' | 'credit_note' | 'debit_note'
  | 'stock_journal' | 'physical_stock';
export type VatCategory = 'standard' | 'zero' | 'exempt' | 'reverse_charge' | 'import_goods' | 'out_of_scope';
export type BillType = 'new_ref' | 'agst_ref' | 'advance' | 'on_account';

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  mailingName: text('mailing_name'),
  address: text('address'),
  emirate: text('emirate').notNull().default('dubai'),
  country: text('country').notNull().default('United Arab Emirates'),
  trn: text('trn'),
  phone: text('phone'),
  email: text('email'),
  baseCurrency: text('base_currency').notNull().default('AED'),
  fyStart: date('fy_start').notNull(),
  booksFrom: date('books_from').notNull(),
  vatRegistered: boolean('vat_registered').notNull().default(true),
  lockedUntil: date('locked_until'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  nature: text('nature').$type<Nature>().notNull(),
  affectsGrossProfit: boolean('affects_gross_profit').notNull().default(false),
  isReserved: boolean('is_reserved').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
});

export const ledgers = pgTable('ledgers', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  alias: text('alias'),
  groupId: integer('group_id'), // null only for the reserved "Profit & Loss A/c"
  openingBalance: money('opening_balance').notNull().default('0'), // Dr positive, Cr negative
  maintainBillWise: boolean('maintain_bill_wise').notNull().default(false),
  creditDays: integer('credit_days'),
  trn: text('trn'),
  address: text('address'),
  emirate: text('emirate'),
  country: text('country'),
  phone: text('phone'),
  email: text('email'),
  vatTreatment: text('vat_treatment'), // registered | unregistered | designated_zone | gcc | overseas
  taxType: text('tax_type'), // output_vat | input_vat (Duties & Taxes ledgers)
  vatCategory: text('vat_category').$type<VatCategory>(), // default for sales/purchase/expense ledgers
  vatRate: numeric('vat_rate', { precision: 6, scale: 2 }),
  bankName: text('bank_name'),
  accountNo: text('account_no'),
  iban: text('iban'),
  swift: text('swift'),
  reservedKey: text('reserved_key'),
  isReserved: boolean('is_reserved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const voucherTypes = pgTable('voucher_types', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  base: text('base').$type<VoucherBase>().notNull(),
  abbreviation: text('abbreviation'),
  prefix: text('prefix').notNull().default(''),
  nextNumber: integer('next_number').notNull().default(1),
  autoNumber: boolean('auto_number').notNull().default(true),
  isReserved: boolean('is_reserved').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const vouchers = pgTable('vouchers', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  voucherTypeId: integer('voucher_type_id').notNull(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  referenceNo: text('reference_no'),
  referenceDate: date('reference_date'),
  narration: text('narration'),
  partyLedgerId: integer('party_ledger_id'),
  placeOfSupply: text('place_of_supply'),
  isOptional: boolean('is_optional').notNull().default(false),
  status: text('status').$type<'posted' | 'cancelled'>().notNull().default('posted'),
  totalAmount: money('total_amount').notNull().default('0'),
  payload: jsonb('payload'), // the request as entered, so the voucher reopens exactly as typed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').notNull(),
  companyId: integer('company_id').notNull(),
  ledgerId: integer('ledger_id').notNull(),
  amount: money('amount').notNull(), // Dr positive, Cr negative; SUM per voucher must be 0
  lineNo: integer('line_no').notNull(),
  bankDate: date('bank_date'),
});

export const billAllocations = pgTable('bill_allocations', {
  id: serial('id').primaryKey(),
  entryId: integer('entry_id').notNull(),
  voucherId: integer('voucher_id').notNull(),
  companyId: integer('company_id').notNull(),
  ledgerId: integer('ledger_id').notNull(),
  billType: text('bill_type').$type<BillType>().notNull(),
  billName: text('bill_name'),
  dueDate: date('due_date'),
  amount: money('amount').notNull(),
});

export const vatLines = pgTable('vat_lines', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').notNull(),
  companyId: integer('company_id').notNull(),
  direction: text('direction').$type<'output' | 'input'>().notNull(),
  category: text('category').$type<VatCategory>().notNull(),
  emirate: text('emirate'),
  taxableAmount: money('taxable_amount').notNull(),
  vatAmount: money('vat_amount').notNull(),
  recoverable: boolean('recoverable').notNull().default(true),
});

export const units = pgTable('units', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  symbol: text('symbol').notNull(),
  formalName: text('formal_name'),
  decimals: integer('decimals').notNull().default(0),
});

export const stockGroups = pgTable('stock_groups', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
});

export const godowns = pgTable('godowns', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  isReserved: boolean('is_reserved').notNull().default(false),
});

export const stockItems = pgTable('stock_items', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull(),
  name: text('name').notNull(),
  alias: text('alias'),
  partNo: text('part_no'),
  stockGroupId: integer('stock_group_id'),
  unitId: integer('unit_id').notNull(),
  openingQty: numeric('opening_qty', { precision: 20, scale: 4 }).notNull().default('0'),
  openingRate: money('opening_rate').notNull().default('0'),
  openingValue: money('opening_value').notNull().default('0'),
  openingGodownId: integer('opening_godown_id'),
  vatCategory: text('vat_category').$type<VatCategory>().notNull().default('standard'),
  vatRate: numeric('vat_rate', { precision: 6, scale: 2 }).notNull().default('5'),
  salesPrice: money('sales_price'),
  reorderLevel: numeric('reorder_level', { precision: 20, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryEntries = pgTable('inventory_entries', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').notNull(),
  companyId: integer('company_id').notNull(),
  stockItemId: integer('stock_item_id').notNull(),
  godownId: integer('godown_id').notNull(),
  qty: numeric('qty', { precision: 20, scale: 4 }).notNull(), // inward positive, outward negative
  rate: money('rate').notNull(),
  amount: money('amount').notNull(), // value of the line before VAT, always positive
  discountPct: numeric('discount_pct', { precision: 6, scale: 2 }).notNull().default('0'),
  lineNo: integer('line_no').notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id'),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
