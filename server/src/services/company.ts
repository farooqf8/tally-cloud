import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import type { Nature, VoucherBase } from '../db/schema.js';

// Tally's 28 predefined groups: 15 primary, 13 sub-groups.
const PRIMARY: [string, Nature, boolean][] = [
  ['Capital Account', 'liabilities', false],
  ['Loans (Liability)', 'liabilities', false],
  ['Current Liabilities', 'liabilities', false],
  ['Branch / Divisions', 'liabilities', false],
  ['Suspense A/c', 'liabilities', false],
  ['Fixed Assets', 'assets', false],
  ['Investments', 'assets', false],
  ['Current Assets', 'assets', false],
  ['Misc. Expenses (ASSET)', 'assets', false],
  ['Sales Accounts', 'income', true],
  ['Direct Incomes', 'income', true],
  ['Indirect Incomes', 'income', false],
  ['Purchase Accounts', 'expenses', true],
  ['Direct Expenses', 'expenses', true],
  ['Indirect Expenses', 'expenses', false],
];
const SUB: [string, string][] = [
  ['Reserves & Surplus', 'Capital Account'],
  ['Secured Loans', 'Loans (Liability)'],
  ['Unsecured Loans', 'Loans (Liability)'],
  ['Bank OD A/c', 'Loans (Liability)'],
  ['Duties & Taxes', 'Current Liabilities'],
  ['Provisions', 'Current Liabilities'],
  ['Sundry Creditors', 'Current Liabilities'],
  ['Bank Accounts', 'Current Assets'],
  ['Cash-in-Hand', 'Current Assets'],
  ['Deposits (Asset)', 'Current Assets'],
  ['Loans & Advances (Asset)', 'Current Assets'],
  ['Stock-in-Hand', 'Current Assets'],
  ['Sundry Debtors', 'Current Assets'],
];

const VOUCHER_TYPES: [string, VoucherBase, string][] = [
  ['Contra', 'contra', 'Ctra'],
  ['Payment', 'payment', 'Pymt'],
  ['Receipt', 'receipt', 'Rcpt'],
  ['Journal', 'journal', 'Jrnl'],
  ['Sales', 'sales', 'Sale'],
  ['Purchase', 'purchase', 'Purc'],
  ['Credit Note', 'credit_note', 'C/Note'],
  ['Debit Note', 'debit_note', 'D/Note'],
  ['Stock Journal', 'stock_journal', 'Stk Jrnl'],
  ['Physical Stock', 'physical_stock', 'Phy Stk'],
];

export const EMIRATES = ['abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah'] as const;

export interface NewCompany {
  name: string;
  mailingName?: string | null;
  address?: string | null;
  emirate: string;
  trn?: string | null;
  phone?: string | null;
  email?: string | null;
  fyStart: string;
  booksFrom: string;
  vatRegistered: boolean;
}

export async function createCompany(input: NewCompany) {
  return db.transaction(async (tx) => {
    const [company] = await tx.insert(t.companies).values({ ...input, baseCurrency: 'AED' }).returning();
    const cid = company.id;

    const groupId: Record<string, number> = {};
    let order = 0;
    for (const [name, nature, gp] of PRIMARY) {
      const [g] = await tx.insert(t.groups)
        .values({ companyId: cid, name, nature, affectsGrossProfit: gp, isReserved: true, sortOrder: order++ })
        .returning({ id: t.groups.id });
      groupId[name] = g.id;
    }
    for (const [name, parent] of SUB) {
      const p = PRIMARY.find((x) => x[0] === parent)!;
      const [g] = await tx.insert(t.groups)
        .values({ companyId: cid, name, parentId: groupId[parent], nature: p[1], affectsGrossProfit: p[2], isReserved: true, sortOrder: order++ })
        .returning({ id: t.groups.id });
      groupId[name] = g.id;
    }

    await tx.insert(t.ledgers).values([
      { companyId: cid, name: 'Profit & Loss A/c', groupId: null, reservedKey: 'pl', isReserved: true },
      { companyId: cid, name: 'Cash', groupId: groupId['Cash-in-Hand'], reservedKey: 'cash' },
      { companyId: cid, name: 'Output VAT @5%', groupId: groupId['Duties & Taxes'], taxType: 'output_vat', vatRate: '5', reservedKey: 'output_vat' },
      { companyId: cid, name: 'Input VAT @5%', groupId: groupId['Duties & Taxes'], taxType: 'input_vat', vatRate: '5', reservedKey: 'input_vat' },
      { companyId: cid, name: 'Sales', groupId: groupId['Sales Accounts'], vatCategory: 'standard', vatRate: '5', reservedKey: 'sales' },
      { companyId: cid, name: 'Purchase', groupId: groupId['Purchase Accounts'], vatCategory: 'standard', vatRate: '5', reservedKey: 'purchase' },
      { companyId: cid, name: 'Round Off', groupId: groupId['Indirect Expenses'], vatCategory: 'out_of_scope', reservedKey: 'round_off' },
    ]);

    await tx.insert(t.voucherTypes).values(
      VOUCHER_TYPES.map(([name, base, abbreviation]) => ({ companyId: cid, name, base, abbreviation, isReserved: true })),
    );
    await tx.insert(t.units).values([
      { companyId: cid, symbol: 'Nos', formalName: 'Numbers', decimals: 0 },
      { companyId: cid, symbol: 'Pcs', formalName: 'Pieces', decimals: 0 },
      { companyId: cid, symbol: 'Box', formalName: 'Boxes', decimals: 0 },
      { companyId: cid, symbol: 'Kg', formalName: 'Kilograms', decimals: 3 },
      { companyId: cid, symbol: 'Ltr', formalName: 'Litres', decimals: 3 },
      { companyId: cid, symbol: 'Hrs', formalName: 'Hours', decimals: 2 },
    ]);
    await tx.insert(t.godowns).values({ companyId: cid, name: 'Main Location', isReserved: true });
    await tx.insert(t.auditLog).values({ companyId: cid, entity: 'company', entityId: cid, action: 'create', after: company });
    return company;
  });
}

export async function deleteCompany(id: number) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.deleting_company', 'on', true)`);
    // FKs inside a company are NO ACTION (checked at statement end), so one cascading delete works.
    await tx.delete(t.companies).where(eq(t.companies.id, id));
  });
}
