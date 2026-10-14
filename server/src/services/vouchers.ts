import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import type { VatCategory, VoucherBase, BillType } from '../db/schema.js';
import { bad, notFound } from '../lib/errors.js';
import { D, Decimal, fils, str, sum } from '../lib/money.js';
import { loadChart, loadLedgers, mainGodown, reservedLedger, rows, type Tx } from './chart.js';
import { bookQty, stockPosition } from './stock.js';

// ---------- input ----------

const decimalStr = z.union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'must be a number');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const id = z.number().int().positive();
const vatCategory = z.enum(['standard', 'zero', 'exempt', 'reverse_charge', 'import_goods', 'out_of_scope']);

const bill = z.object({
  type: z.enum(['new_ref', 'agst_ref', 'advance', 'on_account']),
  name: z.string().trim().nullish(),
  dueDate: dateStr.nullish(),
  amount: decimalStr,
});

export const voucherInput = z.object({
  voucherTypeId: id,
  date: dateStr,
  number: z.string().trim().nullish(),
  referenceNo: z.string().trim().nullish(),
  referenceDate: dateStr.nullish(),
  narration: z.string().nullish(),
  isOptional: z.boolean().optional(),
  // accounting vouchers
  entries: z.array(z.object({
    ledgerId: id,
    side: z.enum(['dr', 'cr']),
    amount: decimalStr,
    bills: z.array(bill).optional(),
  })).optional(),
  // invoices: sales, purchase, credit note, debit note
  partyLedgerId: id.nullish(),
  placeOfSupply: z.string().nullish(),
  salesLedgerId: id.nullish(), // sales/purchase ledger for item lines
  lines: z.array(z.object({
    stockItemId: id.nullish(),
    ledgerId: id.nullish(),
    godownId: id.nullish(),
    qty: decimalStr.nullish(),
    rate: decimalStr.nullish(),
    discountPct: decimalStr.nullish(),
    amount: decimalStr.nullish(), // ledger lines only
    vatCategory: vatCategory,
    vatRate: decimalStr.nullish(),
  })).optional(),
  partyBills: z.array(bill).optional(),
  // stock journal (qty signed: + inward / production, - outward / consumption)
  stock: z.array(z.object({ stockItemId: id, godownId: id.nullish(), qty: decimalStr, rate: decimalStr.nullish() })).optional(),
  // physical stock (counted quantities)
  physical: z.array(z.object({ stockItemId: id, godownId: id.nullish(), qty: decimalStr })).optional(),
});
export type VoucherInput = z.infer<typeof voucherInput>;

// ---------- posting ----------

interface Bill { type: BillType; name: string | null; dueDate: string | null; amount: Decimal }
interface Entry { ledgerId: number; amount: Decimal; bills: Bill[] }
interface Inv { stockItemId: number; godownId: number; qty: Decimal; rate: Decimal; amount: Decimal; discountPct: Decimal }
interface Vat { direction: 'output' | 'input'; category: VatCategory; emirate: string | null; taxable: Decimal; vat: Decimal }
interface Posting { entries: Entry[]; inventory: Inv[]; vat: Vat[]; partyLedgerId: number | null; total: Decimal }

const INVOICE_BASES: VoucherBase[] = ['sales', 'purchase', 'credit_note', 'debit_note'];
const ACCOUNTING_BASES: VoucherBase[] = ['contra', 'payment', 'receipt', 'journal'];
const VAT_BEARING: VatCategory[] = ['standard', 'reverse_charge', 'import_goods'];

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function billsFor(given: z.infer<typeof bill>[] | undefined, entryAmount: Decimal, label: string, fallback: Bill): Bill[] {
  const sign = entryAmount.isNeg() ? -1 : 1;
  if (!given?.length) return [{ ...fallback, amount: entryAmount }];
  const out = given.map((b) => {
    if (b.type !== 'on_account' && !b.name) throw bad(`${label}: bill name is required for ${b.type.replace('_', ' ')}`);
    return { type: b.type, name: b.name ?? null, dueDate: b.dueDate ?? null, amount: D(b.amount).abs().times(sign) };
  });
  const diff = sum(out.map((b) => b.amount)).minus(entryAmount);
  if (!diff.isZero()) throw bad(`${label}: bill-wise allocation differs from the amount by ${diff.abs().toFixed(2)}`);
  return out;
}

async function buildAccounting(tx: Tx, cid: number, base: VoucherBase, input: VoucherInput, number: string): Promise<Posting> {
  const lines = input.entries ?? [];
  if (lines.length < 2) throw bad('Enter at least one debit and one credit ledger');
  const chart = await loadChart(tx, cid);
  const ledgers = await loadLedgers(tx, cid, lines.map((l) => l.ledgerId));
  const entries: Entry[] = lines.map((l) => {
    const amt = fils(l.amount);
    if (!amt.gt(0)) throw bad('Amounts must be greater than zero');
    const signed = l.side === 'dr' ? amt : amt.neg();
    const ledger = ledgers.get(l.ledgerId)!;
    const bills = ledger.maintainBillWise
      ? billsFor(l.bills, signed, ledger.name, { type: 'on_account', name: null, dueDate: null, amount: signed })
      : [];
    return { ledgerId: l.ledgerId, amount: signed, bills };
  });
  const dr = sum(entries.filter((e) => e.amount.gt(0)).map((e) => e.amount));
  const cr = sum(entries.filter((e) => e.amount.lt(0)).map((e) => e.amount.neg()));
  if (!dr.eq(cr)) throw bad(`Debit (${dr.toFixed(2)}) and credit (${cr.toFixed(2)}) totals differ by ${dr.minus(cr).abs().toFixed(2)}`);

  const cashBank = (side: 'dr' | 'cr') => entries.some((e) =>
    (side === 'dr' ? e.amount.gt(0) : e.amount.lt(0)) && chart.isCashOrBank(ledgers.get(e.ledgerId)!));
  if (base === 'contra' && !entries.every((e) => chart.isCashOrBank(ledgers.get(e.ledgerId)!)))
    throw bad('Contra vouchers can only use Cash and Bank ledgers');
  if (base === 'payment' && !cashBank('cr')) throw bad('A payment must credit a Cash or Bank ledger');
  if (base === 'receipt' && !cashBank('dr')) throw bad('A receipt must debit a Cash or Bank ledger');
  if (base === 'journal' && entries.some((e) => chart.isCashOrBank(ledgers.get(e.ledgerId)!)))
    throw bad('Journal vouchers cannot use Cash or Bank ledgers; use Payment, Receipt or Contra');

  const party = entries.find((e) => !chart.isCashOrBank(ledgers.get(e.ledgerId)!));
  void number;
  return { entries, inventory: [], vat: [], partyLedgerId: party?.ledgerId ?? null, total: dr };
}

async function buildInvoice(tx: Tx, company: typeof t.companies.$inferSelect, base: VoucherBase, input: VoucherInput, number: string): Promise<Posting> {
  const cid = company.id;
  if (!input.partyLedgerId) throw bad('Select the party (customer / supplier) ledger');
  const lines = input.lines ?? [];
  if (!lines.length) throw bad('Enter at least one item or ledger line');

  const outputSide = base === 'sales' || base === 'credit_note';
  const partySign = base === 'sales' || base === 'debit_note' ? 1 : -1;
  const isNote = base === 'credit_note' || base === 'debit_note';
  // Sales and purchase returns move stock in the opposite direction.
  const qtySign = base === 'purchase' || base === 'credit_note' ? 1 : -1;

  const defaultLedger = input.salesLedgerId
    ?? (await reservedLedger(tx, cid, outputSide ? 'sales' : 'purchase'))?.id;
  const ledgerIds = [input.partyLedgerId, ...lines.map((l) => l.ledgerId ?? defaultLedger!).filter(Boolean)];
  const ledgers = await loadLedgers(tx, cid, ledgerIds);
  const party = ledgers.get(input.partyLedgerId)!;
  const itemIds = lines.map((l) => l.stockItemId).filter((x): x is number => !!x);
  const items = itemIds.length
    ? new Map((await tx.select().from(t.stockItems).where(and(eq(t.stockItems.companyId, cid), inArray(t.stockItems.id, itemIds)))).map((i) => [i.id, i]))
    : new Map();
  const godown = await mainGodown(tx, cid);

  const byLedger = new Map<number, Decimal>();
  const vatAgg = new Map<VatCategory, { taxable: Decimal; vat: Decimal }>();
  const inventory: Inv[] = [];

  lines.forEach((l, i) => {
    const label = `Line ${i + 1}`;
    let taxable: Decimal;
    let ledgerId: number;
    if (l.stockItemId) {
      const item = items.get(l.stockItemId);
      if (!item) throw bad(`${label}: stock item not found`);
      const qty = D(l.qty);
      const rate = D(l.rate);
      if (!qty.gt(0)) throw bad(`${label}: quantity must be greater than zero`);
      if (rate.isNeg()) throw bad(`${label}: rate cannot be negative`);
      const disc = D(l.discountPct);
      taxable = fils(qty.times(rate).times(D(100).minus(disc)).div(100));
      ledgerId = l.ledgerId ?? defaultLedger!;
      if (!ledgerId) throw bad(`Select the ${outputSide ? 'sales' : 'purchase'} ledger`);
      inventory.push({ stockItemId: item.id, godownId: l.godownId ?? godown.id, qty: qty.times(qtySign), rate, amount: taxable, discountPct: disc });
    } else {
      if (!l.ledgerId) throw bad(`${label}: select a stock item or a ledger`);
      ledgerId = l.ledgerId;
      taxable = fils(D(l.amount));
      if (taxable.isZero()) throw bad(`${label}: amount is required`);
    }
    if (outputSide && (l.vatCategory === 'reverse_charge' || l.vatCategory === 'import_goods'))
      throw bad(`${label}: reverse charge and imports apply to purchases only`);
    const category: VatCategory = company.vatRegistered ? l.vatCategory : 'out_of_scope';
    const rate = VAT_BEARING.includes(category) ? D(l.vatRate ?? 5) : D(0);
    const vat = fils(taxable.times(rate).div(100));
    byLedger.set(ledgerId, (byLedger.get(ledgerId) ?? D(0)).plus(taxable));
    const agg = vatAgg.get(category) ?? { taxable: D(0), vat: D(0) };
    vatAgg.set(category, { taxable: agg.taxable.plus(taxable), vat: agg.vat.plus(vat) });
  });

  const entries: Entry[] = [];
  for (const [ledgerId, amt] of byLedger) entries.push({ ledgerId, amount: amt.times(-partySign), bills: [] });

  const charged = vatAgg.get('standard')?.vat ?? D(0);
  const selfAssessed = sum(['reverse_charge', 'import_goods'].map((c) => vatAgg.get(c as VatCategory)?.vat ?? D(0)));
  if (!charged.isZero() || !selfAssessed.isZero()) {
    const out = await reservedLedger(tx, cid, 'output_vat');
    const inp = await reservedLedger(tx, cid, 'input_vat');
    const vatEntries = new Map<number, Decimal>();
    const add = (lid: number, amt: Decimal) => vatEntries.set(lid, (vatEntries.get(lid) ?? D(0)).plus(amt));
    add(outputSide ? out.id : inp.id, charged.times(-partySign));
    // Reverse charge: the buyer accounts for output VAT and reclaims the same amount as input VAT.
    add(inp.id, selfAssessed.times(-partySign));
    add(out.id, selfAssessed.times(partySign));
    for (const [ledgerId, amt] of vatEntries) if (!amt.isZero()) entries.push({ ledgerId, amount: amt, bills: [] });
  }

  const taxableTotal = sum([...byLedger.values()]);
  const partyAmount = taxableTotal.plus(charged).times(partySign);
  if (partyAmount.isZero()) throw bad('Invoice total cannot be zero');
  const fallback: Bill = isNote
    ? { type: 'on_account', name: null, dueDate: null, amount: partyAmount }
    : {
        type: 'new_ref',
        name: (base === 'purchase' ? input.referenceNo : null) || number,
        dueDate: party.creditDays ? addDays(input.date, party.creditDays) : null,
        amount: partyAmount,
      };
  entries.unshift({
    ledgerId: party.id,
    amount: partyAmount,
    bills: party.maintainBillWise ? billsFor(input.partyBills, partyAmount, party.name, fallback) : [],
  });

  const emirate = input.placeOfSupply ?? party.emirate ?? company.emirate;
  const noteSign = isNote ? -1 : 1;
  const vat: Vat[] = [];
  for (const [category, a] of vatAgg) {
    const row = { category, emirate, taxable: a.taxable.times(noteSign), vat: a.vat.times(noteSign) };
    if (outputSide) vat.push({ direction: 'output', ...row });
    else {
      vat.push({ direction: 'input', ...row });
      if (category === 'reverse_charge' || category === 'import_goods') vat.push({ direction: 'output', ...row });
    }
  }
  return { entries, inventory, vat, partyLedgerId: party.id, total: partyAmount.abs() };
}

async function buildStock(tx: Tx, cid: number, base: VoucherBase, input: VoucherInput): Promise<Posting> {
  const godown = await mainGodown(tx, cid);
  const inventory: Inv[] = [];
  if (base === 'stock_journal') {
    const lines = input.stock ?? [];
    if (!lines.length) throw bad('Enter at least one stock line');
    const positions = new Map((await stockPosition(tx, cid, input.date)).map((p) => [p.id, p]));
    for (const l of lines) {
      const qty = D(l.qty);
      if (qty.isZero()) throw bad('Quantity cannot be zero');
      const rate = l.rate != null && l.rate !== '' ? D(l.rate) : positions.get(l.stockItemId)?.avgRate ?? D(0);
      inventory.push({ stockItemId: l.stockItemId, godownId: l.godownId ?? godown.id, qty, rate, amount: fils(qty.abs().times(rate)), discountPct: D(0) });
    }
  } else {
    const lines = input.physical ?? [];
    if (!lines.length) throw bad('Enter at least one counted item');
    const positions = new Map((await stockPosition(tx, cid, input.date)).map((p) => [p.id, p]));
    for (const l of lines) {
      const gid = l.godownId ?? godown.id;
      const diff = D(l.qty).minus(await bookQty(tx, cid, l.stockItemId, gid, input.date));
      if (diff.isZero()) continue;
      const rate = positions.get(l.stockItemId)?.avgRate ?? D(0);
      inventory.push({ stockItemId: l.stockItemId, godownId: gid, qty: diff, rate, amount: fils(diff.abs().times(rate)), discountPct: D(0) });
    }
  }
  return { entries: [], inventory, vat: [], partyLedgerId: null, total: sum(inventory.map((i) => i.amount)) };
}

async function writeChildren(tx: Tx, cid: number, voucherId: number, p: Posting) {
  let line = 1;
  for (const e of p.entries) {
    const [row] = await tx.insert(t.ledgerEntries)
      .values({ voucherId, companyId: cid, ledgerId: e.ledgerId, amount: str(e.amount), lineNo: line++ })
      .returning({ id: t.ledgerEntries.id });
    if (e.bills.length)
      await tx.insert(t.billAllocations).values(e.bills.map((b) => ({
        entryId: row.id, voucherId, companyId: cid, ledgerId: e.ledgerId,
        billType: b.type, billName: b.name, dueDate: b.dueDate, amount: str(b.amount),
      })));
  }
  if (p.inventory.length)
    await tx.insert(t.inventoryEntries).values(p.inventory.map((i, n) => ({
      voucherId, companyId: cid, stockItemId: i.stockItemId, godownId: i.godownId,
      qty: str(i.qty), rate: str(i.rate), amount: str(i.amount), discountPct: i.discountPct.toFixed(2), lineNo: n + 1,
    })));
  if (p.vat.length)
    await tx.insert(t.vatLines).values(p.vat.map((v) => ({
      voucherId, companyId: cid, direction: v.direction, category: v.category, emirate: v.emirate,
      taxableAmount: str(v.taxable), vatAmount: str(v.vat),
    })));
}

async function build(tx: Tx, company: typeof t.companies.$inferSelect, base: VoucherBase, input: VoucherInput, number: string) {
  if (ACCOUNTING_BASES.includes(base)) return buildAccounting(tx, company.id, base, input, number);
  if (INVOICE_BASES.includes(base)) return buildInvoice(tx, company, base, input, number);
  return buildStock(tx, company.id, base, input);
}

async function context(tx: Tx, cid: number, voucherTypeId: number) {
  const [company] = await tx.select().from(t.companies).where(eq(t.companies.id, cid));
  if (!company) throw notFound('Company');
  const [vt] = await tx.select().from(t.voucherTypes)
    .where(and(eq(t.voucherTypes.id, voucherTypeId), eq(t.voucherTypes.companyId, cid)));
  if (!vt) throw notFound('Voucher type');
  if (!vt.active) throw bad(`Voucher type "${vt.name}" is inactive`);
  return { company, vt };
}

// ---------- public operations ----------

export async function createVoucher(cid: number, raw: unknown) {
  const input = voucherInput.parse(raw);
  return db.transaction(async (tx) => {
    const { company, vt } = await context(tx, cid, input.voucherTypeId);
    let number = input.number || '';
    if (vt.autoNumber || !number) {
      const [n] = await tx.update(t.voucherTypes)
        .set({ nextNumber: sql`${t.voucherTypes.nextNumber} + 1` })
        .where(eq(t.voucherTypes.id, vt.id))
        .returning({ n: t.voucherTypes.nextNumber });
      number = vt.autoNumber || !number ? `${vt.prefix}${n.n - 1}` : number;
    }
    const posting = await build(tx, company, vt.base, input, number);
    const [v] = await tx.insert(t.vouchers).values({
      companyId: cid, voucherTypeId: vt.id, number, date: input.date,
      referenceNo: input.referenceNo, referenceDate: input.referenceDate, narration: input.narration,
      partyLedgerId: posting.partyLedgerId, placeOfSupply: input.placeOfSupply,
      isOptional: input.isOptional ?? false, totalAmount: str(posting.total), payload: input,
    }).returning();
    await writeChildren(tx, cid, v.id, posting);
    await tx.insert(t.auditLog).values({ companyId: cid, entity: 'voucher', entityId: v.id, action: 'create', after: { ...v } });
    return v;
  });
}

export async function updateVoucher(cid: number, voucherId: number, raw: unknown) {
  const input = voucherInput.parse(raw);
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(t.vouchers).where(and(eq(t.vouchers.id, voucherId), eq(t.vouchers.companyId, cid)));
    if (!old) throw notFound('Voucher');
    if (old.status === 'cancelled') throw bad('A cancelled voucher cannot be altered');
    if (input.voucherTypeId !== old.voucherTypeId) throw bad('Voucher type cannot be changed; cancel and re-enter instead');
    const { company, vt } = await context(tx, cid, input.voucherTypeId);
    const number = vt.autoNumber ? old.number : input.number || old.number;
    await clearChildren(tx, voucherId);
    const posting = await build(tx, company, vt.base, input, number);
    const [v] = await tx.update(t.vouchers).set({
      number, date: input.date, referenceNo: input.referenceNo, referenceDate: input.referenceDate,
      narration: input.narration, partyLedgerId: posting.partyLedgerId, placeOfSupply: input.placeOfSupply,
      isOptional: input.isOptional ?? false, totalAmount: str(posting.total), payload: input, updatedAt: new Date(),
    }).where(eq(t.vouchers.id, voucherId)).returning();
    await writeChildren(tx, cid, voucherId, posting);
    await tx.insert(t.auditLog).values({ companyId: cid, entity: 'voucher', entityId: voucherId, action: 'alter', before: old, after: v });
    return v;
  });
}

async function clearChildren(tx: Tx, voucherId: number) {
  await tx.delete(t.ledgerEntries).where(eq(t.ledgerEntries.voucherId, voucherId));
  await tx.delete(t.inventoryEntries).where(eq(t.inventoryEntries.voucherId, voucherId));
  await tx.delete(t.vatLines).where(eq(t.vatLines.voucherId, voucherId));
}

export async function cancelVoucher(cid: number, voucherId: number) {
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(t.vouchers).where(and(eq(t.vouchers.id, voucherId), eq(t.vouchers.companyId, cid)));
    if (!old) throw notFound('Voucher');
    await clearChildren(tx, voucherId);
    const [v] = await tx.update(t.vouchers).set({ status: 'cancelled', totalAmount: '0', updatedAt: new Date() })
      .where(eq(t.vouchers.id, voucherId)).returning();
    await tx.insert(t.auditLog).values({ companyId: cid, entity: 'voucher', entityId: voucherId, action: 'cancel', before: old, after: v });
    return v;
  });
}

export async function deleteVoucher(cid: number, voucherId: number) {
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(t.vouchers).where(and(eq(t.vouchers.id, voucherId), eq(t.vouchers.companyId, cid)));
    if (!old) throw notFound('Voucher');
    await tx.delete(t.vouchers).where(eq(t.vouchers.id, voucherId));
    await tx.insert(t.auditLog).values({ companyId: cid, entity: 'voucher', entityId: voucherId, action: 'delete', before: old });
  });
}

/** Full voucher with resolved names, for display, alteration and printing. */
export async function getVoucher(cid: number, voucherId: number) {
  const [v] = await rows<any>(db, sql`
    SELECT v.*, vt.name AS type_name, vt.base, p.name AS party_name, p.trn AS party_trn,
           p.address AS party_address, p.emirate AS party_emirate
    FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
    LEFT JOIN ledgers p ON p.id = v.party_ledger_id
    WHERE v.id = ${voucherId} AND v.company_id = ${cid}`);
  if (!v) throw notFound('Voucher');
  const entries = await rows<any>(db, sql`
    SELECT e.id, e.ledger_id, l.name AS ledger_name, e.amount, e.bank_date,
           COALESCE((SELECT json_agg(json_build_object('type', b.bill_type, 'name', b.bill_name, 'dueDate', b.due_date, 'amount', b.amount::text))
                     FROM bill_allocations b WHERE b.entry_id = e.id), '[]') AS bills
    FROM ledger_entries e JOIN ledgers l ON l.id = e.ledger_id
    WHERE e.voucher_id = ${voucherId} ORDER BY e.line_no`);
  const inventory = await rows<any>(db, sql`
    SELECT i.*, s.name AS item_name, u.symbol AS unit, g.name AS godown_name
    FROM inventory_entries i JOIN stock_items s ON s.id = i.stock_item_id
    JOIN units u ON u.id = s.unit_id JOIN godowns g ON g.id = i.godown_id
    WHERE i.voucher_id = ${voucherId} ORDER BY i.line_no`);
  const vat = await rows<any>(db, sql`SELECT * FROM vat_lines WHERE voucher_id = ${voucherId} ORDER BY id`);
  return { ...v, entries, inventory, vat };
}

/** Bills of a ledger that are not yet fully settled, for "Agst Ref" selection. */
export async function pendingBills(cid: number, ledgerId: number, excludeVoucherId?: number) {
  return rows<any>(db, sql`
    SELECT b.bill_name AS name, MIN(v.date) AS date, MAX(b.due_date) AS due_date, SUM(b.amount) AS pending
    FROM bill_allocations b JOIN vouchers v ON v.id = b.voucher_id AND NOT v.is_optional
    WHERE b.company_id = ${cid} AND b.ledger_id = ${ledgerId} AND b.bill_type <> 'on_account'
      AND (${excludeVoucherId ?? null}::int IS NULL OR b.voucher_id <> ${excludeVoucherId ?? null}::int)
    GROUP BY b.bill_name
    HAVING SUM(b.amount) <> 0
    ORDER BY MIN(v.date), b.bill_name`);
}
