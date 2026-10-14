import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { D, Decimal, sum } from '../lib/money.js';
import { Chart, loadChart, rows, type Group } from './chart.js';
import { stockPosition, stockValue } from './stock.js';

const POSTED = sql`v.status = 'posted' AND NOT v.is_optional`;
const n = (d: Decimal) => d.toFixed(2);

export const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Start of the financial year that contains `date`. */
export function fyStartFor(date: string, fyStart: string) {
  const md = fyStart.slice(5);
  const y = Number(date.slice(0, 4));
  const candidate = `${y}-${md}`;
  return candidate <= date ? candidate : `${y - 1}-${md}`;
}

async function company(cid: number) {
  const [c] = await db.select().from(t.companies).where(eq(t.companies.id, cid));
  if (!c) throw notFound('Company');
  return c;
}

export interface LedgerBal {
  id: number; name: string; groupId: number | null; reservedKey: string | null;
  opening: Decimal; dr: Decimal; cr: Decimal; closing: Decimal;
}

/**
 * Opening / period debit / period credit / closing for every ledger. Income and expense
 * ledgers restart at zero each financial year; their earlier totals (and the earlier change
 * in stock) roll into Profit & Loss A/c, as Tally does on year change.
 */
export async function ledgerBalances(cid: number, from: string, to: string) {
  const c = await company(cid);
  const chart = await loadChart(db, cid);
  const F = fyStartFor(from, c.fyStart);
  const booksInThisYear = c.booksFrom >= F;
  const r = await rows<any>(db, sql`
    SELECT l.id, l.name, l.group_id, l.reserved_key, l.opening_balance,
      COALESCE(SUM(e.amount) FILTER (WHERE v.date < ${from}), 0) AS before_from,
      COALESCE(SUM(e.amount) FILTER (WHERE v.date < ${F}), 0) AS before_fy,
      COALESCE(SUM(e.amount) FILTER (WHERE v.date BETWEEN ${from} AND ${to} AND e.amount > 0), 0) AS dr,
      COALESCE(-SUM(e.amount) FILTER (WHERE v.date BETWEEN ${from} AND ${to} AND e.amount < 0), 0) AS cr
    FROM ledgers l
    LEFT JOIN (ledger_entries e JOIN vouchers v ON v.id = e.voucher_id AND ${POSTED}) ON e.ledger_id = l.id
    WHERE l.company_id = ${cid}
    GROUP BY l.id ORDER BY l.name`);

  const stockOpenItems = await stockValue(db, cid, null);
  const stockAtFyStart = F > c.booksFrom ? await stockValue(db, cid, dayBefore(F)) : stockOpenItems;

  let priorNominal = D(0);
  const out: LedgerBal[] = r.map((x) => {
    const nominal = x.group_id != null && ['income', 'expenses'].includes(chart.byId.get(x.group_id)!.nature);
    let opening: Decimal;
    if (nominal) {
      priorNominal = priorNominal.plus(x.before_fy).plus(booksInThisYear ? 0 : x.opening_balance);
      opening = D(booksInThisYear ? x.opening_balance : 0).plus(D(x.before_from).minus(x.before_fy));
    } else {
      opening = D(x.opening_balance).plus(x.before_from);
    }
    const dr = D(x.dr), cr = D(x.cr);
    return { id: x.id, name: x.name, groupId: x.group_id, reservedKey: x.reserved_key, opening, dr, cr, closing: opening.plus(dr).minus(cr) };
  });
  // Prior years' net profit = -(prior nominal Dr) + stock at year start - item opening stock.
  const priorProfit = priorNominal.neg().plus(stockAtFyStart).minus(stockOpenItems);
  const pl = out.find((l) => l.reservedKey === 'pl')!;
  pl.opening = pl.opening.minus(priorProfit);
  pl.closing = pl.closing.minus(priorProfit);

  const diffOpening = sum(r.map((x) => x.opening_balance)).plus(stockOpenItems);
  return { company: c, chart, F, ledgers: out, stockAtFyStart, diffOpening };
}

// ---------- tree helpers ----------

export interface Node {
  key: string; kind: 'group' | 'ledger' | 'stock' | 'diff' | 'pl';
  id?: number; name: string; opening: string; dr: string; cr: string; closing: string;
  children?: Node[];
}

function buildTree(chart: Chart, ledgers: LedgerBal[], extra: Map<number, Node[]> = new Map()) {
  const make = (g: Group): Node => {
    const kids: Node[] = [
      ...chart.groups.filter((c) => c.parentId === g.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(make),
      ...ledgers.filter((l) => l.groupId === g.id).map((l): Node => ({
        key: `l${l.id}`, kind: 'ledger', id: l.id, name: l.name,
        opening: n(l.opening), dr: n(l.dr), cr: n(l.cr), closing: n(l.closing),
      })),
      ...(extra.get(g.id) ?? []),
    ].filter((k) => k.kind !== 'ledger' || !(D(k.opening).isZero() && D(k.dr).isZero() && D(k.cr).isZero()));
    const tot = (f: keyof Node) => n(sum(kids.map((k) => k[f] as string)));
    return { key: `g${g.id}`, kind: 'group', id: g.id, name: g.name, opening: tot('opening'), dr: tot('dr'), cr: tot('cr'), closing: tot('closing'), children: kids };
  };
  return chart.groups.filter((g) => g.parentId == null).sort((a, b) => a.sortOrder - b.sortOrder).map(make);
}

export async function trialBalance(cid: number, from: string, to: string) {
  const b = await ledgerBalances(cid, from, to);
  const stockGroup = b.chart.byName.get('stock-in-hand')!;
  const stock = n(b.stockAtFyStart);
  const extra = new Map<number, Node[]>([[stockGroup.id, [{ key: 'stock', kind: 'stock', name: 'Opening Stock', opening: stock, dr: '0.00', cr: '0.00', closing: stock }]]]);
  const tree = buildTree(b.chart, b.ledgers, extra).filter((g) => g.children!.length);
  const pl = b.ledgers.find((l) => l.reservedKey === 'pl')!;
  const rowsOut: Node[] = [...tree];
  if (!(pl.opening.isZero() && pl.dr.isZero() && pl.cr.isZero()))
    rowsOut.push({ key: `l${pl.id}`, kind: 'pl', id: pl.id, name: pl.name, opening: n(pl.opening), dr: n(pl.dr), cr: n(pl.cr), closing: n(pl.closing) });
  if (!b.diffOpening.isZero()) {
    const d = n(b.diffOpening.neg());
    rowsOut.push({ key: 'diff', kind: 'diff', name: 'Difference in opening balances', opening: d, dr: '0.00', cr: '0.00', closing: d });
  }
  const tot = (f: 'opening' | 'closing', s: 1 | -1) =>
    n(sum(rowsOut.map((r) => { const v = D(r[f]).times(s); return v.gt(0) ? v : D(0); })));
  return {
    from, to, rows: rowsOut,
    totals: {
      openingDr: tot('opening', 1), openingCr: tot('opening', -1),
      dr: n(sum(rowsOut.map((r) => r.dr))), cr: n(sum(rowsOut.map((r) => r.cr))),
      closingDr: tot('closing', 1), closingCr: tot('closing', -1),
    },
  };
}

// ---------- profit & loss and balance sheet ----------

interface Line { label: string; amount: string; groupId?: number; ledgerId?: number; children?: Line[]; kind?: string }

export async function profitAndLoss(cid: number, from: string, to: string) {
  const b = await ledgerBalances(cid, from, to);
  const c = b.company;
  const openingStock = from > c.booksFrom ? await stockValue(db, cid, dayBefore(from)) : await stockValue(db, cid, null);
  const closingStock = await stockValue(db, cid, to);
  const tree = buildTree(b.chart, b.ledgers);
  // Period movement only: income shown as a positive credit, expense as a positive debit.
  const periodNet = (node: Node, sign: 1 | -1) => D(node.dr).minus(node.cr).times(sign);
  const toLine = (node: Node, sign: 1 | -1): Line => ({
    label: node.name, amount: n(periodNet(node, sign)),
    groupId: node.kind === 'group' ? node.id : undefined,
    ledgerId: node.kind === 'ledger' ? node.id : undefined,
    children: node.children?.filter((k) => !periodNet(k, sign).isZero()).map((k) => toLine(k, sign)),
  });
  const pick = (name: string, sign: 1 | -1) => {
    const g = tree.find((x) => x.name === name)!;
    return toLine(g, sign);
  };
  const purchases = pick('Purchase Accounts', 1), directExp = pick('Direct Expenses', 1);
  const sales = pick('Sales Accounts', -1), directInc = pick('Direct Incomes', -1);
  const indirectExp = pick('Indirect Expenses', 1), indirectInc = pick('Indirect Incomes', -1);
  const a = (l: Line) => D(l.amount);

  const gp = a(sales).plus(a(directInc)).plus(closingStock).minus(openingStock).minus(a(purchases)).minus(a(directExp));
  const np = gp.plus(a(indirectInc)).minus(a(indirectExp));
  const stockLine = (label: string, v: Decimal): Line => ({ label, amount: n(v), kind: 'stock' });

  // Like Tally, groups with nothing in the period are left out.
  const nz = (ls: Line[]) => ls.filter((l) => l.kind === 'stock' || !D(l.amount).isZero());
  const tradingDr = nz([stockLine('Opening Stock', openingStock), purchases, directExp]);
  const tradingCr = nz([sales, directInc, stockLine('Closing Stock', closingStock)]);
  if (gp.gte(0)) tradingDr.push({ label: 'Gross Profit c/o', amount: n(gp), kind: 'total' });
  else tradingCr.push({ label: 'Gross Loss c/o', amount: n(gp.neg()), kind: 'total' });
  const plDr: Line[] = [], plCr: Line[] = [];
  if (gp.gte(0)) plCr.push({ label: 'Gross Profit b/f', amount: n(gp), kind: 'total' });
  else plDr.push({ label: 'Gross Loss b/f', amount: n(gp.neg()), kind: 'total' });
  plDr.push(...nz([indirectExp])); plCr.push(...nz([indirectInc]));
  if (np.gte(0)) plDr.push({ label: 'Net Profit', amount: n(np), kind: 'result' });
  else plCr.push({ label: 'Net Loss', amount: n(np.neg()), kind: 'result' });

  const side = (ls: Line[]) => n(sum(ls.map((l) => l.amount)));
  return {
    from, to, grossProfit: n(gp), netProfit: n(np), openingStock: n(openingStock), closingStock: n(closingStock),
    trading: { dr: tradingDr, cr: tradingCr, total: side(tradingDr) },
    pl: { dr: plDr, cr: plCr, total: side(plDr) },
    figures: { sales: sales.amount, purchases: purchases.amount, directExpenses: directExp.amount, indirectExpenses: indirectExp.amount, indirectIncomes: indirectInc.amount },
  };
}

export async function balanceSheet(cid: number, to: string) {
  const c = await company(cid);
  const F = fyStartFor(to, c.fyStart);
  const from = F < c.booksFrom ? c.booksFrom : F;
  const b = await ledgerBalances(cid, from, to);
  const pnl = await profitAndLoss(cid, from, to);
  const closingStock = D(pnl.closingStock);
  const tree = buildTree(b.chart, b.ledgers);
  const toLine = (node: Node, sign: 1 | -1): Line => ({
    label: node.name, amount: n(D(node.closing).times(sign)),
    groupId: node.kind === 'group' ? node.id : undefined,
    ledgerId: node.kind === 'ledger' ? node.id : undefined,
    children: node.children?.filter((k) => !D(k.closing).isZero() || k.kind === 'stock').map((k) => toLine(k, sign)),
  });
  const liabilities: Line[] = tree.filter((g) => b.chart.byId.get(g.id!)!.nature === 'liabilities' && !D(g.closing).isZero()).map((g) => toLine(g, -1));
  const assets: Line[] = tree.filter((g) => b.chart.byId.get(g.id!)!.nature === 'assets').map((g) => {
    const line = toLine(g, 1);
    if (g.name === 'Current Assets') {
      line.children = [{ label: 'Closing Stock', amount: n(closingStock), kind: 'stock' }, ...(line.children ?? [])];
      line.amount = n(D(line.amount).plus(closingStock));
    }
    return line;
  }).filter((l) => !D(l.amount).isZero());

  const plLedger = b.ledgers.find((l) => l.reservedKey === 'pl')!;
  const plOpening = plLedger.closing.neg(); // credit balance shown positive
  const plTotal = plOpening.plus(pnl.netProfit);
  liabilities.push({
    label: 'Profit & Loss A/c', amount: n(plTotal), ledgerId: plLedger.id, kind: 'pl',
    children: [{ label: 'Opening Balance', amount: n(plOpening) }, { label: 'Current Period', amount: pnl.netProfit }],
  });
  if (!b.diffOpening.isZero()) {
    const line = { label: 'Diff. in Opening Balances', amount: n(b.diffOpening.abs()), kind: 'diff' };
    (b.diffOpening.gt(0) ? liabilities : assets).push(line);
  }
  const total = (ls: Line[]) => n(sum(ls.map((l) => l.amount)));
  return { asOn: to, from, liabilities, assets, totalLiabilities: total(liabilities), totalAssets: total(assets) };
}

// ---------- registers ----------

export async function dayBook(cid: number, from: string, to: string, opts: { voucherTypeId?: number; base?: string }) {
  return rows<any>(db, sql`
    SELECT v.id, v.date, v.number, v.status, v.is_optional, v.narration, v.total_amount, v.reference_no,
           vt.name AS type_name, vt.base,
           COALESCE(p.name, (SELECT l.name FROM ledger_entries e JOIN ledgers l ON l.id = e.ledger_id
                             WHERE e.voucher_id = v.id ORDER BY e.line_no LIMIT 1)) AS particulars
    FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
    LEFT JOIN ledgers p ON p.id = v.party_ledger_id
    WHERE v.company_id = ${cid} AND v.date BETWEEN ${from} AND ${to}
      ${opts.voucherTypeId ? sql`AND v.voucher_type_id = ${opts.voucherTypeId}` : sql``}
      ${opts.base ? sql`AND vt.base = ${opts.base}` : sql``}
    ORDER BY v.date, v.id`);
}

export async function ledgerStatement(cid: number, ledgerId: number, from: string, to: string) {
  const b = await ledgerBalances(cid, from, to);
  const l = b.ledgers.find((x) => x.id === ledgerId);
  if (!l) throw notFound('Ledger');
  const entries = await rows<any>(db, sql`
    SELECT e.id AS entry_id, v.id AS voucher_id, v.date, v.number, vt.name AS type_name, vt.base, v.narration, e.amount, e.bank_date,
      (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(ol.name) ELSE (array_agg(ol.name ORDER BY abs(o.amount) DESC))[1] || ' (as per details)' END
         FROM ledger_entries o JOIN ledgers ol ON ol.id = o.ledger_id
        WHERE o.voucher_id = e.voucher_id AND sign(o.amount) <> sign(e.amount)) AS particulars
    FROM ledger_entries e JOIN vouchers v ON v.id = e.voucher_id AND ${POSTED}
    JOIN voucher_types vt ON vt.id = v.voucher_type_id
    WHERE e.ledger_id = ${ledgerId} AND v.date BETWEEN ${from} AND ${to}
    ORDER BY v.date, v.id, e.line_no`);
  let bal = l.opening;
  const lines = entries.map((e) => {
    bal = bal.plus(e.amount);
    const amt = D(e.amount);
    return { ...e, dr: amt.gt(0) ? n(amt) : null, cr: amt.lt(0) ? n(amt.neg()) : null, balance: n(bal) };
  });
  return { ledger: { id: l.id, name: l.name }, from, to, opening: n(l.opening), dr: n(l.dr), cr: n(l.cr), closing: n(l.closing), lines };
}

export async function stockSummary(cid: number, from: string, to: string, godownId?: number) {
  const c = await company(cid);
  const opening = await stockPosition(db, cid, from > c.booksFrom ? dayBefore(from) : null, godownId);
  const closing = await stockPosition(db, cid, to, godownId);
  const moves = await rows<any>(db, sql`
    SELECT ie.stock_item_id AS id,
      COALESCE(SUM(ie.qty) FILTER (WHERE ie.qty > 0), 0) AS in_qty,
      COALESCE(SUM(ie.amount) FILTER (WHERE ie.qty > 0), 0) AS in_value,
      COALESCE(-SUM(ie.qty) FILTER (WHERE ie.qty < 0), 0) AS out_qty,
      COALESCE(SUM(ie.amount) FILTER (WHERE ie.qty < 0), 0) AS out_value
    FROM inventory_entries ie JOIN vouchers v ON v.id = ie.voucher_id AND ${POSTED}
    WHERE ie.company_id = ${cid} AND v.date BETWEEN ${from} AND ${to}
      ${godownId ? sql`AND ie.godown_id = ${godownId}` : sql``}
    GROUP BY ie.stock_item_id`);
  const mv = new Map(moves.map((m) => [m.id, m]));
  const groups = await db.select().from(t.stockGroups).where(eq(t.stockGroups.companyId, cid));
  const items = closing.map((cl, i) => {
    const op = opening[i];
    const m = mv.get(cl.id);
    return {
      id: cl.id, name: cl.name, stockGroupId: cl.stockGroupId, unit: cl.unit,
      openingQty: op.qty.toString(), openingValue: n(op.value),
      inQty: D(m?.in_qty).toString(), inValue: n(D(m?.in_value)),
      outQty: D(m?.out_qty).toString(), outValue: n(D(m?.out_value)),
      closingQty: cl.qty.toString(), closingRate: n(cl.avgRate), closingValue: n(cl.value),
    };
  });
  return { from, to, groups, items, totalClosing: n(sum(closing.map((x) => x.value))), totalOpening: n(sum(opening.map((x) => x.value))) };
}

export async function outstanding(cid: number, kind: 'receivable' | 'payable', asOf: string) {
  const c = await company(cid);
  const chart = await loadChart(db, cid);
  const groupIds = chart.descendants(kind === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors');
  if (!groupIds.length) return { asOf, kind, parties: [], total: '0.00' };
  const sign = kind === 'receivable' ? 1 : -1;
  const b = await ledgerBalances(cid, c.booksFrom > asOf ? asOf : c.booksFrom, asOf);
  const parties = b.ledgers.filter((l) => l.groupId != null && groupIds.includes(l.groupId) && !l.closing.isZero());
  const bills = await rows<any>(db, sql`
    SELECT b.ledger_id, b.bill_name AS name, MIN(v.date) AS date, MAX(b.due_date) AS due_date, SUM(b.amount) AS pending
    FROM bill_allocations b JOIN vouchers v ON v.id = b.voucher_id AND ${POSTED} AND v.date <= ${asOf}
    WHERE b.company_id = ${cid} AND b.bill_type <> 'on_account'
    GROUP BY b.ledger_id, b.bill_name HAVING SUM(b.amount) <> 0
    ORDER BY MIN(v.date)`);
  const out = parties.map((p) => {
    const mine = bills.filter((x) => x.ledger_id === p.id).map((x) => {
      const age = daysBetween(x.date, asOf);
      return {
        name: x.name, date: x.date, dueDate: x.due_date, amount: n(D(x.pending).times(sign)),
        ageDays: age, overdueDays: x.due_date ? Math.max(0, daysBetween(x.due_date, asOf)) : null,
      };
    });
    const onAccount = p.closing.times(sign).minus(sum(mine.map((m) => m.amount)));
    return { ledgerId: p.id, name: p.name, balance: n(p.closing.times(sign)), onAccount: n(onAccount), bills: mine };
  });
  const bucket = (lo: number, hi: number) => n(sum(out.flatMap((p) => p.bills.filter((x) => x.ageDays >= lo && x.ageDays <= hi).map((x) => x.amount))));
  return {
    asOf, kind, parties: out, total: n(sum(out.map((p) => p.balance))),
    ageing: { d0_30: bucket(0, 30), d31_60: bucket(31, 60), d61_90: bucket(61, 90), d90plus: bucket(91, 1e9), onAccount: n(sum(out.map((p) => p.onAccount))) },
  };
}

// ---------- UAE VAT return (Form VAT 201) ----------

export const EMIRATE_LABELS: Record<string, string> = {
  abu_dhabi: 'Abu Dhabi', dubai: 'Dubai', sharjah: 'Sharjah', ajman: 'Ajman',
  umm_al_quwain: 'Umm Al Quwain', ras_al_khaimah: 'Ras Al Khaimah', fujairah: 'Fujairah',
};

export async function vat201(cid: number, from: string, to: string) {
  const c = await company(cid);
  const r = await rows<any>(db, sql`
    SELECT vl.direction, vl.category, COALESCE(vl.emirate, ${c.emirate}) AS emirate,
           SUM(vl.taxable_amount) AS amount, SUM(vl.vat_amount) AS vat,
           SUM(vl.vat_amount) FILTER (WHERE vl.recoverable) AS recoverable
    FROM vat_lines vl JOIN vouchers v ON v.id = vl.voucher_id AND ${POSTED}
    WHERE vl.company_id = ${cid} AND v.date BETWEEN ${from} AND ${to}
    GROUP BY 1, 2, 3`);
  const pick = (dir: string, cats: string[], emirate?: string) => {
    const m = r.filter((x) => x.direction === dir && cats.includes(x.category) && (!emirate || x.emirate === emirate));
    return { amount: sum(m.map((x) => x.amount)), vat: sum(m.map((x) => x.vat)), recoverable: sum(m.map((x) => x.recoverable ?? 0)) };
  };
  const box = (no: string, label: string, v: { amount: Decimal; vat: Decimal }, adj = D(0)) =>
    ({ no, label, amount: n(v.amount), vat: n(v.vat), adjustment: n(adj) });
  const box1 = Object.entries(EMIRATE_LABELS).map(([k, label], i) =>
    box(`1${'abcdefg'[i]}`, `Standard rated supplies in ${label}`, pick('output', ['standard'], k)));
  const box3 = pick('output', ['reverse_charge']);
  const box4 = pick('output', ['zero']);
  const box5 = pick('output', ['exempt']);
  const box6 = pick('output', ['import_goods']);
  const outputs = [
    ...box1,
    box('2', 'Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme', { amount: D(0), vat: D(0) }),
    box('3', 'Supplies subject to the reverse charge provisions', box3),
    box('4', 'Zero rated supplies', { amount: box4.amount, vat: D(0) }),
    box('5', 'Exempt supplies', { amount: box5.amount, vat: D(0) }),
    box('6', 'Goods imported into the UAE', box6),
    box('7', 'Adjustments to goods imported into the UAE', { amount: D(0), vat: D(0) }),
  ];
  const box8 = { amount: sum(outputs.map((x) => x.amount)), vat: sum(outputs.map((x) => x.vat)) };
  const box9 = pick('input', ['standard']);
  const box10 = pick('input', ['reverse_charge', 'import_goods']);
  const inputs = [
    { no: '9', label: 'Standard rated expenses', amount: n(box9.amount), vat: n(box9.recoverable), adjustment: '0.00' },
    { no: '10', label: 'Supplies subject to the reverse charge provisions', amount: n(box10.amount), vat: n(box10.recoverable), adjustment: '0.00' },
  ];
  const box11 = { amount: box9.amount.plus(box10.amount), vat: box9.recoverable.plus(box10.recoverable) };
  const due = box8.vat, recoverable = box11.vat;
  return {
    from, to, trn: c.trn, company: c.name,
    outputs, totalOutputs: { no: '8', label: 'Totals', amount: n(box8.amount), vat: n(box8.vat) },
    inputs, totalInputs: { no: '11', label: 'Totals', amount: n(box11.amount), vat: n(box11.vat) },
    net: { box12: n(due), box13: n(recoverable), box14: n(due.minus(recoverable)) },
  };
}

// ---------- ratio analysis ----------

export async function ratios(cid: number, from: string, to: string) {
  const bs = await balanceSheet(cid, to);
  const pl = await profitAndLoss(cid, from, to);
  const b = await ledgerBalances(cid, from, to);
  const totalOf = (names: string[]) => sum(b.ledgers.filter((l) => l.groupId != null && names.some((nm) => b.chart.isUnder(l.groupId, nm))).map((l) => l.closing));
  const ca = totalOf(['Current Assets']).plus(pl.closingStock);
  const cl = totalOf(['Current Liabilities']).neg();
  const debtors = totalOf(['Sundry Debtors']);
  const creditors = totalOf(['Sundry Creditors']).neg();
  const cashBank = totalOf(['Cash-in-Hand', 'Bank Accounts']).plus(totalOf(['Bank OD A/c']));
  const loans = totalOf(['Loans (Liability)']).neg();
  const capital = totalOf(['Capital Account']).neg().plus(D(bs.liabilities.find((l) => l.kind === 'pl')?.amount));
  const sales = D(pl.figures.sales);
  const days = Math.max(1, daysBetween(from, to) + 1);
  const div = (a: Decimal, b2: Decimal) => (b2.isZero() ? null : a.div(b2));
  const f = (v: Decimal | null, dp = 2) => (v == null ? null : v.toFixed(dp));
  return {
    from, to,
    principal: {
      workingCapital: n(ca.minus(cl)), cashBankBalance: n(cashBank), sundryDebtors: n(debtors), sundryCreditors: n(creditors),
      sales: n(sales), purchases: pl.figures.purchases, stockInHand: pl.closingStock,
      grossProfit: pl.grossProfit, netProfit: pl.netProfit, capitalAndReserves: n(capital), loans: n(loans),
    },
    ratios: {
      currentRatio: f(div(ca, cl)),
      quickRatio: f(div(ca.minus(pl.closingStock), cl)),
      debtEquity: f(div(loans, capital)),
      grossProfitPct: f(div(D(pl.grossProfit).times(100), sales)),
      netProfitPct: f(div(D(pl.netProfit).times(100), sales)),
      receivableDays: f(div(debtors.times(days), sales), 0),
      returnOnInvestmentPct: f(div(D(pl.netProfit).times(100), capital.plus(loans))),
    },
  };
}

// ---------- bank reconciliation ----------

export async function bankReconciliation(cid: number, ledgerId: number, from: string, to: string) {
  const st = await ledgerStatement(cid, ledgerId, from, to);
  const unreconciled = await rows<any>(db, sql`
    SELECT e.id AS entry_id, v.id AS voucher_id, v.date, v.number, vt.name AS type_name, e.amount, e.bank_date
    FROM ledger_entries e JOIN vouchers v ON v.id = e.voucher_id AND ${POSTED}
    JOIN voucher_types vt ON vt.id = v.voucher_type_id
    WHERE e.ledger_id = ${ledgerId} AND v.date <= ${to} AND (e.bank_date IS NULL OR e.bank_date > ${to})`);
  const notInBank = sum(unreconciled.map((u) => u.amount));
  return {
    ...st,
    balanceAsPerBooks: st.closing,
    notReflectedInBank: n(notInBank),
    balanceAsPerBank: n(D(st.closing).minus(notInBank)),
    unreconciledCount: unreconciled.length,
  };
}

export async function setBankDate(cid: number, entryId: number, bankDate: string | null) {
  const r = await rows<any>(db, sql`
    UPDATE ledger_entries SET bank_date = ${bankDate} WHERE id = ${entryId} AND company_id = ${cid} RETURNING id`);
  if (!r.length) throw notFound('Entry');
}

export async function auditTrail(cid: number, limit = 200) {
  return rows<any>(db, sql`
    SELECT a.id, a.entity, a.entity_id, a.action, a.at,
           COALESCE(a.after->>'number', a.before->>'number', a.after->>'name', a.before->>'name') AS ref,
           COALESCE(a.after->>'date', a.before->>'date') AS voucher_date,
           COALESCE(a.after->>'totalAmount', a.before->>'totalAmount') AS amount
    FROM audit_log a WHERE a.company_id = ${cid} ORDER BY a.at DESC, a.id DESC LIMIT ${limit}`);
}

/** Key figures for the Gateway screen. */
export async function dashboard(cid: number, from: string, to: string) {
  const b = await ledgerBalances(cid, from, to);
  const sumUnder = (...names: string[]) => n(sum(b.ledgers.filter((l) => l.groupId != null && b.chart.isUnder(l.groupId, ...names)).map((l) => l.closing)));
  const pl = await profitAndLoss(cid, from, to);
  return {
    cashInHand: sumUnder('Cash-in-Hand'), bank: sumUnder('Bank Accounts', 'Bank OD A/c'),
    receivables: sumUnder('Sundry Debtors'), payables: n(D(sumUnder('Sundry Creditors')).neg()),
    sales: pl.figures.sales, netProfit: pl.netProfit, closingStock: pl.closingStock,
  };
}
