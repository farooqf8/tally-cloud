// Builds a sample UAE trading company with masters and a year of vouchers, so every report
// has something to show. Everything goes through the same services the UI uses.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import { createCompany } from './company.js';
import { createVoucher } from './vouchers.js';

export async function createDemoCompany() {
  const existing = await db.select().from(t.companies);
  const suffix = existing.filter((c) => c.name.startsWith('Al Noor Trading LLC')).length;
  const company = await createCompany({
    name: suffix ? `Al Noor Trading LLC (${suffix + 1})` : 'Al Noor Trading LLC',
    mailingName: 'Al Noor Trading LLC',
    address: 'Office 1204, Bay Square Building 7\nBusiness Bay, Dubai',
    emirate: 'dubai', trn: '100234567800003', phone: '+971 4 555 0100', email: 'accounts@alnoor.example',
    fyStart: '2026-01-01', booksFrom: '2026-01-01', vatRegistered: true,
  });
  const cid = company.id;

  const groups = new Map((await db.select().from(t.groups).where(eq(t.groups.companyId, cid))).map((g) => [g.name, g.id]));
  const units = new Map((await db.select().from(t.units).where(eq(t.units.companyId, cid))).map((u) => [u.symbol, u.id]));
  const vts = new Map((await db.select().from(t.voucherTypes).where(eq(t.voucherTypes.companyId, cid))).map((v) => [v.base, v.id]));

  const L = async (name: string, group: string, extra: Partial<typeof t.ledgers.$inferInsert> = {}) => {
    const [l] = await db.insert(t.ledgers).values({ companyId: cid, name, groupId: groups.get(group)!, ...extra }).returning();
    return l.id;
  };
  const ledgers = new Map((await db.select().from(t.ledgers).where(eq(t.ledgers.companyId, cid))).map((l) => [l.name, l.id]));
  await db.update(t.ledgers).set({ openingBalance: '50000' }).where(eq(t.ledgers.id, ledgers.get('Cash')!));

  const capital = await L('Owner Capital', 'Capital Account', { openingBalance: '-239000' });
  const bank = await L('Emirates NBD - Current A/c', 'Bank Accounts', { openingBalance: '150000', bankName: 'Emirates NBD', accountNo: '1015 2233 4455 01', iban: 'AE070331234567890123456' });
  const furniture = await L('Furniture & Fixtures', 'Fixed Assets');
  void capital; void furniture;
  const party = (name: string, group: string, emirate: string | null, trn: string | null, treatment: string, extra = {}) =>
    L(name, group, { maintainBillWise: true, creditDays: 30, emirate, trn, vatTreatment: treatment, country: emirate ? 'United Arab Emirates' : null, ...extra });
  const gulfTech = await party('Gulf Tech Solutions LLC', 'Sundry Debtors', 'dubai', '100345678900003', 'registered', { address: 'Al Quoz Industrial 3, Dubai' });
  const sharjahRetail = await party('Sharjah Retail Co', 'Sundry Debtors', 'sharjah', '100456789000003', 'registered', { address: 'Al Majaz, Sharjah' });
  const muscat = await party('Muscat Traders LLC', 'Sundry Debtors', null, null, 'gcc', { country: 'Oman', address: 'Ruwi, Muscat' });
  const dell = await party('Dell Middle East FZE', 'Sundry Creditors', 'dubai', '100567890100003', 'registered', { creditDays: 45 });
  const landlord = await party('Al Futtaim Properties', 'Sundry Creditors', 'dubai', '100678901200003', 'registered');
  const aws = await party('Amazon Web Services EMEA', 'Sundry Creditors', null, null, 'overseas', { country: 'Luxembourg' });
  const rent = await L('Office Rent', 'Indirect Expenses', { vatCategory: 'standard', vatRate: '5' });
  const salaries = await L('Salaries & Wages', 'Indirect Expenses', { vatCategory: 'out_of_scope' });
  const cloud = await L('Cloud & Software Subscriptions', 'Indirect Expenses', { vatCategory: 'reverse_charge', vatRate: '5' });
  const audit = await L('Audit Fees', 'Indirect Expenses', { vatCategory: 'standard', vatRate: '5' });
  const auditPayable = await L('Audit Fee Payable', 'Provisions');
  const serviceIncome = await L('Service Income', 'Sales Accounts', { vatCategory: 'standard', vatRate: '5' });
  const exportSales = await L('Export Sales', 'Sales Accounts', { vatCategory: 'zero', vatRate: '0' });

  const [sg] = await db.insert(t.stockGroups).values({ companyId: cid, name: 'Computers & Peripherals' }).returning();
  const [store] = await db.insert(t.godowns).values({ companyId: cid, name: 'Jebel Ali Warehouse' }).returning();
  const item = async (name: string, qty: string, rate: string, price: string) => {
    const [i] = await db.insert(t.stockItems).values({
      companyId: cid, name, stockGroupId: sg.id, unitId: units.get('Nos')!,
      openingQty: qty, openingRate: rate, openingValue: String(Number(qty) * Number(rate)), salesPrice: price,
    }).returning();
    return i.id;
  };
  const laptop = await item('Dell Latitude 5450 Laptop', '10', '2500', '3200');
  const mouse = await item('Wireless Mouse', '100', '20', '45');
  const monitor = await item('Dell 27" Monitor', '20', '600', '850');

  const v = (base: t.VoucherBase, body: Record<string, unknown>) =>
    createVoucher(cid, { voucherTypeId: vts.get(base)!, ...body });
  const std = { vatCategory: 'standard', vatRate: '5' };

  await v('purchase', { date: '2026-02-05', partyLedgerId: dell, referenceNo: 'DME/2026/101', referenceDate: '2026-02-04',
    lines: [{ stockItemId: laptop, qty: '20', rate: '2400', ...std }, { stockItemId: monitor, qty: '50', rate: '580', godownId: store.id, ...std }],
    narration: 'Stock purchase for Q1' });
  const inv1 = await v('sales', { date: '2026-02-12', partyLedgerId: gulfTech,
    lines: [{ stockItemId: laptop, qty: '8', rate: '3200', ...std }, { stockItemId: monitor, qty: '8', rate: '850', godownId: store.id, ...std }, { stockItemId: mouse, qty: '30', rate: '45', ...std }] });
  const inv2 = await v('sales', { date: '2026-03-03', partyLedgerId: sharjahRetail, placeOfSupply: 'sharjah',
    lines: [{ stockItemId: laptop, qty: '5', rate: '3150', ...std }] });
  await v('sales', { date: '2026-03-20', partyLedgerId: muscat, salesLedgerId: exportSales,
    lines: [{ stockItemId: laptop, qty: '4', rate: '3000', vatCategory: 'zero', vatRate: '0' }], narration: 'Export to Oman, exit certificate on file' });
  await v('receipt', { date: '2026-03-25', narration: `Received against invoice ${inv1.number}`, entries: [
    { ledgerId: bank, side: 'dr', amount: inv1.totalAmount },
    { ledgerId: gulfTech, side: 'cr', amount: inv1.totalAmount, bills: [{ type: 'agst_ref', name: inv1.number, amount: inv1.totalAmount }] },
  ] });
  await v('payment', { date: '2026-03-28', narration: 'Part payment to Dell', entries: [
    { ledgerId: dell, side: 'dr', amount: '50000', bills: [{ type: 'agst_ref', name: 'DME/2026/101', amount: '50000' }] },
    { ledgerId: bank, side: 'cr', amount: '50000' },
  ] });
  await v('purchase', { date: '2026-04-01', partyLedgerId: landlord, referenceNo: 'AFP-INV-7781',
    lines: [{ ledgerId: rent, amount: '15000', ...std }], narration: 'Office rent April - June' });
  await v('purchase', { date: '2026-04-10', partyLedgerId: aws, referenceNo: 'EUINAE26-0410',
    lines: [{ ledgerId: cloud, amount: '3672.50', vatCategory: 'reverse_charge', vatRate: '5' }], narration: 'AWS hosting, reverse charge' });
  await v('payment', { date: '2026-04-30', narration: 'Salaries for April via WPS', entries: [
    { ledgerId: salaries, side: 'dr', amount: '18000' }, { ledgerId: bank, side: 'cr', amount: '18000' },
  ] });
  await v('contra', { date: '2026-05-02', narration: 'Cash withdrawn for petty cash', entries: [
    { ledgerId: ledgers.get('Cash')!, side: 'dr', amount: '5000' }, { ledgerId: bank, side: 'cr', amount: '5000' },
  ] });
  await v('credit_note', { date: '2026-05-10', partyLedgerId: gulfTech, referenceNo: inv1.number,
    lines: [{ stockItemId: laptop, qty: '1', rate: '3200', ...std }], narration: 'Laptop returned, screen defect' });
  await v('journal', { date: '2026-06-30', narration: 'Audit fee provision H1', entries: [
    { ledgerId: audit, side: 'dr', amount: '5000' }, { ledgerId: auditPayable, side: 'cr', amount: '5000' },
  ] });
  await v('sales', { date: '2026-09-15', partyLedgerId: gulfTech,
    lines: [{ ledgerId: serviceIncome, amount: '12000', ...std }], narration: 'Network setup and AMC' });
  await v('receipt', { date: '2026-10-05', narration: `Part payment against ${inv2.number}`, entries: [
    { ledgerId: bank, side: 'dr', amount: '10000' },
    { ledgerId: sharjahRetail, side: 'cr', amount: '10000', bills: [{ type: 'agst_ref', name: inv2.number, amount: '10000' }] },
  ] });
  await v('stock_journal', { date: '2026-10-06', narration: 'Move monitors to main store', stock: [
    { stockItemId: monitor, godownId: store.id, qty: '-10' }, { stockItemId: monitor, qty: '10' },
  ] });
  return company;
}
