import type { ComponentType } from 'react';
import { Companies, CompanyForm } from './Companies';
import { Gateway, MastersMenu, DisplayMore, BankingMenu } from './Gateway';
import { MasterList, MasterForm } from './Masters';
import { ChartOfAccounts } from './ChartOfAccounts';
import { VoucherEntry } from './VoucherEntry';
import { DayBook } from './DayBook';
import { LedgerReport } from './LedgerReport';
import { TrialBalance } from './TrialBalance';
import { ProfitLoss, BalanceSheet } from './FinalAccounts';
import { StockSummary } from './StockSummary';
import { Outstanding } from './Outstanding';
import { Vat201 } from './Vat201';
import { Ratios } from './Ratios';
import { Brs } from './Brs';
import { AuditLog } from './AuditLog';
import { InvoicePrint } from './InvoicePrint';

export const SCREENS: Record<string, ComponentType<any>> = {
  companies: Companies, companyForm: CompanyForm,
  gateway: Gateway, mastersMenu: MastersMenu, displayMore: DisplayMore, banking: BankingMenu,
  masterList: MasterList, masterForm: MasterForm, chart: ChartOfAccounts,
  voucher: VoucherEntry, daybook: DayBook, ledger: LedgerReport,
  trialBalance: TrialBalance, profitLoss: ProfitLoss, balanceSheet: BalanceSheet,
  stockSummary: StockSummary, outstanding: Outstanding, vat201: Vat201, ratios: Ratios,
  brs: Brs, auditLog: AuditLog, invoicePrint: InvoicePrint,
};

export const GOTO: { label: string; group: string; type: string; props?: Record<string, any> }[] = [
  { label: 'Balance Sheet', group: 'Reports', type: 'balanceSheet' },
  { label: 'Profit & Loss A/c', group: 'Reports', type: 'profitLoss' },
  { label: 'Trial Balance', group: 'Reports', type: 'trialBalance' },
  { label: 'Day Book', group: 'Reports', type: 'daybook' },
  { label: 'Ledger', group: 'Account Books', type: 'ledger' },
  { label: 'Cash / Bank Book', group: 'Account Books', type: 'ledger', props: { cashBank: true } },
  { label: 'Sales Register', group: 'Account Books', type: 'daybook', props: { base: 'sales' } },
  { label: 'Purchase Register', group: 'Account Books', type: 'daybook', props: { base: 'purchase' } },
  { label: 'Journal Register', group: 'Account Books', type: 'daybook', props: { base: 'journal' } },
  { label: 'Stock Summary', group: 'Inventory', type: 'stockSummary' },
  { label: 'Receivables (Bills Receivable)', group: 'Statements of Accounts', type: 'outstanding', props: { kind: 'receivable' } },
  { label: 'Payables (Bills Payable)', group: 'Statements of Accounts', type: 'outstanding', props: { kind: 'payable' } },
  { label: 'VAT Return (Form VAT 201)', group: 'Statutory', type: 'vat201' },
  { label: 'Ratio Analysis', group: 'Reports', type: 'ratios' },
  { label: 'Bank Reconciliation', group: 'Banking', type: 'brs' },
  { label: 'Audit Trail (Edit Log)', group: 'Utilities', type: 'auditLog' },
  { label: 'Chart of Accounts', group: 'Masters', type: 'chart' },
  { label: 'Create Master', group: 'Masters', type: 'mastersMenu', props: { mode: 'create' } },
  { label: 'Alter Master', group: 'Masters', type: 'mastersMenu', props: { mode: 'alter' } },
  { label: 'Create Ledger', group: 'Masters', type: 'masterForm', props: { kind: 'ledgers' } },
  { label: 'Create Stock Item', group: 'Masters', type: 'masterForm', props: { kind: 'stock-items' } },
  { label: 'Company Features & Period Lock', group: 'Company', type: 'companyForm', props: { alter: true } },
  { label: 'Sales Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'sales' } },
  { label: 'Purchase Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'purchase' } },
  { label: 'Payment Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'payment' } },
  { label: 'Receipt Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'receipt' } },
  { label: 'Journal Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'journal' } },
  { label: 'Contra Voucher', group: 'Vouchers', type: 'voucher', props: { base: 'contra' } },
  { label: 'Credit Note', group: 'Vouchers', type: 'voucher', props: { base: 'credit_note' } },
  { label: 'Debit Note', group: 'Vouchers', type: 'voucher', props: { base: 'debit_note' } },
  { label: 'Stock Journal', group: 'Vouchers', type: 'voucher', props: { base: 'stock_journal' } },
  { label: 'Physical Stock', group: 'Vouchers', type: 'voucher', props: { base: 'physical_stock' } },
];
