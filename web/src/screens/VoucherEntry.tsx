import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp, BASE_LABEL, VOUCHER_KEYS, type Ledger } from '../lib/app';
import { D, Decimal, amt, drcr, EMIRATES, fdate, fday, VAT_BEARING, VAT_CATEGORIES } from '../lib/fmt';
import { focusAfter, focusNext, useKeys } from '../lib/keys';
import { Picker, type Option } from '../components/Picker';
import { BillModal, type BillAlloc } from '../components/BillModal';
import { Confirm, DateInput, Form, Num, ScreenTitle, Select, Text } from '../components/ui';
import { groupUnder } from './Masters';

type Base = keyof typeof BASE_LABEL;
const SINGLE = ['payment', 'receipt', 'contra'];
const INVOICE = ['sales', 'purchase', 'credit_note', 'debit_note'];
const STOCK = ['stock_journal', 'physical_stock'];

interface Part { ledgerId: number | null; amount: string; bills?: BillAlloc[] }
interface JRow { side: 'dr' | 'cr'; ledgerId: number | null; amount: string; bills?: BillAlloc[] }
interface Item { stockItemId: number | null; godownId: number | null; qty: string; rate: string; discountPct: string; vatCategory: string; vatRate: string }
interface Extra { ledgerId: number | null; amount: string; vatCategory: string; vatRate: string }
interface SRow { stockItemId: number | null; godownId: number | null; side: 'in' | 'out'; qty: string; rate: string }

interface State {
  voucherTypeId: number | null; date: string; number: string; referenceNo: string; referenceDate: string | null;
  narration: string; isOptional: boolean;
  account: number | null; parts: Part[]; rows: JRow[];
  partyLedgerId: number | null; placeOfSupply: string; salesLedgerId: number | null; items: Item[]; extras: Extra[];
  stock: SRow[];
}

const blankPart = (): Part => ({ ledgerId: null, amount: '' });
const blankItem = (): Item => ({ stockItemId: null, godownId: null, qty: '', rate: '', discountPct: '', vatCategory: 'standard', vatRate: '5' });
const blankExtra = (): Extra => ({ ledgerId: null, amount: '', vatCategory: 'standard', vatRate: '5' });
const blankS = (): SRow => ({ stockItemId: null, godownId: null, side: 'in', qty: '', rate: '' });
/** Keeps exactly one empty row at the end of a line table. */
function withBlank<T>(list: T[], isBlank: (t: T) => boolean, make: () => T) {
  const kept = list.filter((x, i) => !isBlank(x) || i === list.length - 1);
  return kept.length && isBlank(kept[kept.length - 1]) ? kept : [...kept, make()];
}

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function VoucherEntry({ active, base: initialBase, id }: { active: boolean; base: Base; id?: number }) {
  const app = useApp();
  const m = app.masters;
  const [base, setBase] = useState<Base>(initialBase);
  const types = m.voucherTypes.filter((v) => v.base === base && v.active);
  const fresh = (b: Base, date = app.date): State => ({
    voucherTypeId: m.voucherTypes.find((v) => v.base === b && v.active)?.id ?? null, date, number: '', referenceNo: '', referenceDate: null,
    narration: '', isOptional: false,
    account: b === 'receipt' || b === 'payment' || b === 'contra' ? (m.ledgers.find((l) => l.reserved_key === 'cash')?.id ?? null) : null,
    parts: [blankPart()],
    rows: [{ side: 'dr', ledgerId: null, amount: '' }],
    partyLedgerId: null, placeOfSupply: '', salesLedgerId: null, items: [blankItem()], extras: [blankExtra()],
    stock: [blankS()],
  });
  const [s, setS] = useState<State>(() => fresh(initialBase));
  const [loaded, setLoaded] = useState<any>(null);
  const [formKey, setFormKey] = useState(0);
  const [billFor, setBillFor] = useState<{ list: 'parts' | 'rows'; index: number; el: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<null | 'quit' | 'cancel' | 'delete'>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const itemsRef = useRef<HTMLDivElement>(null);
  const extrasRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const up = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
    dirty.current = true;
    setS((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));
  };

  // Voucher type ids arrive with the masters; fill in once they do.
  useEffect(() => { if (!s.voucherTypeId && types[0]) setS((c) => ({ ...c, voucherTypeId: types[0].id })); }, [types.length]);

  // Alteration: load the voucher and rebuild the form from what was entered.
  useEffect(() => {
    if (!id) return;
    api(app.cpath(`/vouchers/${id}`)).then((v) => {
      setLoaded(v);
      setBase(v.base);
      const p = v.payload ?? {};
      const st = fresh(v.base, v.date);
      st.voucherTypeId = v.voucher_type_id; st.number = v.number; st.referenceNo = v.reference_no ?? '';
      st.referenceDate = v.reference_date; st.narration = v.narration ?? ''; st.isOptional = v.is_optional;
      if (SINGLE.includes(v.base)) {
        const accSide = v.base === 'receipt' ? 'dr' : 'cr';
        const entries: any[] = p.entries ?? [];
        const acc = entries.find((e) => e.side === accSide);
        st.account = acc?.ledgerId ?? st.account;
        st.parts = [...entries.filter((e) => e !== acc).map((e) => ({ ledgerId: e.ledgerId, amount: e.amount, bills: e.bills })), blankPart()];
      } else if (v.base === 'journal') {
        st.rows = [...(p.entries ?? []).map((e: any) => ({ side: e.side, ledgerId: e.ledgerId, amount: e.amount, bills: e.bills })), { side: 'dr', ledgerId: null, amount: '' }];
      } else if (INVOICE.includes(v.base)) {
        st.partyLedgerId = p.partyLedgerId ?? null; st.placeOfSupply = p.placeOfSupply ?? ''; st.salesLedgerId = p.salesLedgerId ?? null;
        const lines: any[] = p.lines ?? [];
        st.items = [...lines.filter((l) => l.stockItemId).map((l) => ({
          stockItemId: l.stockItemId, godownId: l.godownId ?? null, qty: l.qty ?? '', rate: l.rate ?? '',
          discountPct: l.discountPct ?? '', vatCategory: l.vatCategory, vatRate: l.vatRate ?? '0',
        })), blankItem()];
        st.extras = [...lines.filter((l) => !l.stockItemId).map((l) => ({ ledgerId: l.ledgerId, amount: l.amount ?? '', vatCategory: l.vatCategory, vatRate: l.vatRate ?? '0' })), blankExtra()];
      } else if (v.base === 'stock_journal') {
        st.stock = [...(p.stock ?? []).map((r: any) => ({ stockItemId: r.stockItemId, godownId: r.godownId ?? null, side: D(r.qty).isNeg() ? 'out' : 'in', qty: D(r.qty).abs().toString(), rate: r.rate ?? '' })), blankS()];
      } else if (v.base === 'physical_stock') {
        st.stock = [...(p.physical ?? []).map((r: any) => ({ stockItemId: r.stockItemId, godownId: r.godownId ?? null, side: 'in', qty: r.qty, rate: '' })), blankS()];
      }
      setS(st);
      setFormKey((k) => k + 1);
      dirty.current = false;
    }).catch((e) => app.toast(e.message, 'bad'));
  }, [id]);

  const switchBase = (b: Base) => {
    if (id) return app.toast('Voucher type cannot be changed while altering', 'bad');
    setBase(b);
    setS(fresh(b, s.date));
    setFormKey((k) => k + 1);
    dirty.current = false;
  };

  // ---------- lookups ----------
  const L = (lid: number | null | undefined) => m.ledgers.find((l) => l.id === lid);
  const under = (l: Ledger, ...names: string[]) => groupUnder(m.groups, l.group_id, ...names);
  const isCashBank = (l: Ledger) => under(l, 'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c');
  const opt = (l: Ledger): Option => ({ id: l.id, label: l.name, sub: l.group_name ?? '', right: drcr(l.balance) });
  const ledgerOpts = (f: (l: Ledger) => boolean) => m.ledgers.filter(f).map(opt);
  const cashBankOpts = useMemo(() => ledgerOpts(isCashBank), [m.ledgers, m.groups]);
  const partOpts = useMemo(() => ledgerOpts((l) => (base === 'contra' ? isCashBank(l) : !isCashBank(l))), [m.ledgers, base]);
  const journalOpts = useMemo(() => ledgerOpts((l) => !isCashBank(l)), [m.ledgers, m.groups]);
  const outputSide = base === 'sales' || base === 'credit_note';
  const partyOpts = useMemo(() => ledgerOpts((l) => under(l, 'Sundry Debtors', 'Sundry Creditors', 'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c')), [m.ledgers, m.groups]);
  const salesLedgerOpts = useMemo(() => ledgerOpts((l) => under(l, outputSide ? 'Sales Accounts' : 'Purchase Accounts')), [m.ledgers, base]);
  const extraOpts = useMemo(() => ledgerOpts((l) => !l.tax_type && !under(l, 'Sundry Debtors', 'Sundry Creditors')), [m.ledgers, m.groups]);
  const itemOpts = useMemo(() => m.stockItems.map((i) => ({ id: i.id, label: i.name, sub: i.group_name ?? '', right: `${D(i.balance_qty).toString()} ${i.unit}` })), [m.stockItems]);
  const godownOpts = m.godowns.map((g) => ({ id: g.id, label: g.name }));
  const mainGodown = m.godowns.find((g) => g.isReserved)?.id ?? null;
  const multiGodown = m.godowns.length > 1;
  const vatOn = app.company?.vatRegistered;
  const vatOptions = (outputSide ? VAT_CATEGORIES.filter(([k]) => k !== 'reverse_charge' && k !== 'import_goods') : VAT_CATEGORIES) as [string, string][];
  const party = L(s.partyLedgerId);
  const vt = m.voucherTypes.find((v) => v.id === s.voucherTypeId);

  // Default VAT for a new line, from the item/ledger master and the party's VAT treatment.
  const defaultVat = (category: string | null | undefined, rate: string | null | undefined, kind: 'item' | 'ledger') => {
    const t = party?.vat_treatment;
    if (outputSide && (t === 'overseas' || t === 'gcc')) return { vatCategory: 'zero', vatRate: '0' };
    if (!outputSide && t === 'overseas') return { vatCategory: kind === 'item' ? 'import_goods' : 'reverse_charge', vatRate: '5' };
    let c = category || (kind === 'item' ? 'standard' : 'out_of_scope');
    if (outputSide && (c === 'reverse_charge' || c === 'import_goods')) c = 'standard';
    return { vatCategory: c, vatRate: VAT_BEARING.includes(c) ? D(rate ?? 5).toString() : '0' };
  };

  // ---------- totals ----------
  const calc = useMemo(() => {
    const lineTaxable = (i: Item) => r2(D(i.qty).times(D(i.rate)).times(D(100).minus(D(i.discountPct))).div(100));
    const vatOf = (taxable: Decimal, cat: string, rate: string) => (vatOn && VAT_BEARING.includes(cat) ? r2(taxable.times(D(rate)).div(100)) : D(0));
    let taxable = D(0), charged = D(0), self = D(0);
    const add = (t: Decimal, cat: string, rate: string) => {
      taxable = taxable.plus(t);
      const v = vatOf(t, cat, rate);
      if (cat === 'standard') charged = charged.plus(v); else self = self.plus(v);
    };
    s.items.filter((i) => i.stockItemId).forEach((i) => add(lineTaxable(i), i.vatCategory, i.vatRate));
    s.extras.filter((e) => e.ledgerId).forEach((e) => add(r2(D(e.amount)), e.vatCategory, e.vatRate));
    const partsTotal = s.parts.filter((p) => p.ledgerId).reduce((a, p) => a.plus(D(p.amount)), D(0));
    const dr = s.rows.filter((r) => r.ledgerId && r.side === 'dr').reduce((a, r) => a.plus(D(r.amount)), D(0));
    const cr = s.rows.filter((r) => r.ledgerId && r.side === 'cr').reduce((a, r) => a.plus(D(r.amount)), D(0));
    return { lineTaxable, taxable, charged, self, total: taxable.plus(charged), partsTotal, dr, cr };
  }, [s, vatOn]);

  // ---------- save ----------
  const body = () => {
    const head = {
      voucherTypeId: s.voucherTypeId, date: s.date, number: vt?.autoNumber ? undefined : s.number || undefined,
      referenceNo: s.referenceNo || null, referenceDate: s.referenceDate, narration: s.narration || null, isOptional: s.isOptional,
    };
    if (SINGLE.includes(base)) {
      const partSide = base === 'receipt' ? 'cr' : 'dr';
      const parts = s.parts.filter((p) => p.ledgerId && D(p.amount).gt(0));
      return { ...head, entries: [
        ...parts.map((p) => ({ ledgerId: p.ledgerId, side: partSide, amount: p.amount, bills: p.bills })),
        { ledgerId: s.account, side: partSide === 'dr' ? 'cr' : 'dr', amount: calc.partsTotal.toFixed(2) },
      ] };
    }
    if (base === 'journal')
      return { ...head, entries: s.rows.filter((r) => r.ledgerId && D(r.amount).gt(0)).map((r) => ({ ledgerId: r.ledgerId, side: r.side, amount: r.amount, bills: r.bills })) };
    if (INVOICE.includes(base))
      return { ...head, partyLedgerId: s.partyLedgerId, placeOfSupply: s.placeOfSupply || null, salesLedgerId: s.salesLedgerId,
        lines: [
          ...s.items.filter((i) => i.stockItemId).map((i) => ({ stockItemId: i.stockItemId, godownId: i.godownId, qty: i.qty || '0', rate: i.rate || '0', discountPct: i.discountPct || '0', vatCategory: i.vatCategory, vatRate: i.vatRate || '0' })),
          ...s.extras.filter((e) => e.ledgerId && !D(e.amount).isZero()).map((e) => ({ ledgerId: e.ledgerId, amount: e.amount, vatCategory: e.vatCategory, vatRate: e.vatRate || '0' })),
        ] };
    if (base === 'stock_journal')
      return { ...head, stock: s.stock.filter((r) => r.stockItemId && !D(r.qty).isZero()).map((r) => ({ stockItemId: r.stockItemId, godownId: r.godownId, qty: (r.side === 'out' ? D(r.qty).neg() : D(r.qty)).toString(), rate: r.rate || null })) };
    return { ...head, physical: s.stock.filter((r) => r.stockItemId).map((r) => ({ stockItemId: r.stockItemId, godownId: r.godownId, qty: r.qty || '0' })) };
  };

  const save = async () => {
    if (saving) return;
    if (SINGLE.includes(base) && !s.account) return app.toast('Select the cash / bank account', 'bad');
    if (base === 'journal' && !calc.dr.eq(calc.cr)) return app.toast(`Debit and credit differ by ${amt(calc.dr.minus(calc.cr).abs(), true)}`, 'bad');
    setSaving(true);
    try {
      const v = id
        ? await api(app.cpath(`/vouchers/${id}`), { method: 'PUT', body: body() })
        : await api(app.cpath('/vouchers'), { body: body() });
      app.toast(`${BASE_LABEL[base]} No. ${v.number} ${id ? 'altered' : 'saved'}`);
      app.bump();
      dirty.current = false;
      if (id) app.pop();
      else { setS(fresh(base, s.date)); setFormKey((k) => k + 1); }
    } catch (e: any) { app.toast(e.message, 'bad'); }
    finally { setSaving(false); }
  };

  const doCancelOrDelete = async (what: 'cancel' | 'delete') => {
    setConfirm(null);
    try {
      if (what === 'cancel') await api(app.cpath(`/vouchers/${id}/cancel`), { method: 'POST' });
      else await api(app.cpath(`/vouchers/${id}`), { method: 'DELETE' });
      app.toast(what === 'cancel' ? 'Voucher cancelled (number retained)' : 'Voucher deleted');
      app.bump();
      app.pop();
    } catch (e: any) { app.toast(e.message, 'bad'); }
  };

  const quit = () => (dirty.current ? setConfirm('quit') : app.pop());
  useKeys([
    { key: 'ctrl+a', label: 'Accept', run: save, inInputs: true },
    { key: 'Escape', label: 'Quit', run: quit, inInputs: true },
    ...VOUCHER_KEYS.map(([key, b]) => ({ key, label: BASE_LABEL[b], run: () => switchBase(b as Base), inInputs: true, hidden: !!id })),
    { key: 'ctrl+l', label: s.isOptional ? 'Make Regular' : 'Make Optional', run: () => up((c) => ({ isOptional: !c.isOptional })), inInputs: true },
    ...(id ? [
      { key: 'alt+x', label: 'Cancel Voucher', run: () => setConfirm('cancel'), inInputs: true },
      { key: 'alt+d', label: 'Delete', run: () => setConfirm('delete'), inInputs: true },
      ...(INVOICE.includes(base) ? [{ key: 'alt+p', label: 'Print', run: () => app.push('invoicePrint', { id }), inInputs: true }] : []),
    ] : []),
  ], active && !billFor && !confirm);

  // ---------- line helpers ----------
  const setList = <K extends 'parts' | 'rows' | 'items' | 'extras' | 'stock'>(k: K, i: number, patch: Partial<State[K][number]>) =>
    up((c) => {
      const list = [...(c[k] as any[])];
      list[i] = { ...list[i], ...patch };
      const blank = { parts: (p: Part) => !p.ledgerId, rows: (r: JRow) => !r.ledgerId, items: (r: Item) => !r.stockItemId, extras: (r: Extra) => !r.ledgerId, stock: (r: SRow) => !r.stockItemId }[k] as (x: any) => boolean;
      const make = { parts: blankPart, rows: () => ({ side: nextSide(list as JRow[]), ledgerId: null, amount: '' }), items: blankItem, extras: blankExtra, stock: blankS }[k] as () => any;
      const next = withBlank(list, blank, make);
      if (k === 'rows') {
        // The empty line takes whichever side brings the voucher back into balance.
        const last = next[next.length - 1] as JRow;
        if (!last.ledgerId) next[next.length - 1] = { ...last, side: nextSide(next as JRow[]) };
      }
      return { [k]: next } as any;
    });
  const nextSide = (rows: JRow[]): 'dr' | 'cr' => {
    const dr = rows.filter((r) => r.side === 'dr').reduce((a, r) => a.plus(D(r.amount)), D(0));
    const cr = rows.filter((r) => r.side === 'cr').reduce((a, r) => a.plus(D(r.amount)), D(0));
    return dr.gt(cr) ? 'cr' : 'dr';
  };
  const amountKeyDown = (list: 'parts' | 'rows', i: number, ledgerId: number | null) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey) return;
    if (L(ledgerId)?.maintain_bill_wise && D((list === 'parts' ? s.parts : s.rows)[i].amount).gt(0)) {
      e.preventDefault();
      e.stopPropagation();
      setBillFor({ list, index: i, el: e.currentTarget });
    }
  };
  const endTable = (ref: React.RefObject<HTMLDivElement | null>) => () => setTimeout(() => focusAfter(ref.current), 0);

  const lockedNote = app.company?.lockedUntil && s.date <= app.company.lockedUntil ? `Books are locked up to ${fdate(app.company.lockedUntil)}` : null;

  // ---------- render ----------
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenTitle
        title={<>{id ? 'Alteration' : 'Accounting Voucher Creation'}{loaded?.status === 'cancelled' && <span className="ml-2 text-bad">(Cancelled)</span>}</>}
        sub={app.company?.name}
        right={s.isOptional ? <span className="bg-sel px-2 py-0.5 text-ink font-medium">Optional voucher — not posted to books</span> : 'Ctrl+A to save'} />
      <Form key={formKey} onEnd={save} className="flex-1 overflow-auto scroll-thin">
        <div className="bg-panel border-b border-line px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-brand text-white text-sm font-semibold px-2 py-0.5">{BASE_LABEL[base]}</span>
            {types.length > 1 && (
              <Select className="w-40" value={s.voucherTypeId ?? ''} onChange={(v) => up({ voucherTypeId: Number(v) })} options={types.map((t) => [t.id, t.name])} />
            )}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted">No.</span>
            {vt?.autoNumber || id
              ? <b>{id ? s.number : `${vt?.prefix ?? ''}${vt?.nextNumber ?? ''}`}</b>
              : <Text className="w-28" value={s.number} onChange={(e) => up({ number: e.target.value })} placeholder="Number" />}
          </div>
          {INVOICE.includes(base) && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted whitespace-nowrap">{base === 'purchase' ? 'Supplier inv. no.' : 'Reference'}</span>
              <Text className="w-36" value={s.referenceNo} onChange={(e) => up({ referenceNo: e.target.value })} />
              <span className="text-muted">dated</span>
              <DateInput className="w-32" value={s.referenceDate} onChange={(v) => up({ referenceDate: v })} refDate={s.date} allowEmpty />
            </div>
          )}
          <div className="ml-auto flex items-center gap-1 text-sm">
            <DateInput className="w-32 text-right font-semibold" value={s.date} onChange={(v) => v && up({ date: v })} refDate={s.date} autoFocus={!INVOICE.includes(base) || !!id} />
            <span className="text-muted w-20">{fday(s.date)}</span>
          </div>
        </div>
        {lockedNote && <div className="bg-bad/10 text-bad text-sm px-4 py-1">{lockedNote}</div>}

        <div className="px-4 py-3">
          {/* ---------- payment / receipt / contra (single entry mode) ---------- */}
          {SINGLE.includes(base) && (
            <>
              <div className="grid grid-cols-[8rem_minmax(0,24rem)_1fr] items-center gap-2 mb-3">
                <span className="text-sm text-muted">Account</span>
                <Picker value={s.account} options={cashBankOpts} onChange={(v) => up({ account: v })} title="List of Cash / Bank Accounts" autoFocus={!id} />
                <span className="text-xs text-muted">Current balance: <span className="num">{drcr(L(s.account)?.balance)}</span></span>
              </div>
              <div ref={tableRef}>
                <table className="w-full text-sm">
                  <thead><tr className="border-y border-line text-xs text-muted"><th className="text-left py-1 px-1">Particulars</th><th className="w-40 text-right px-1">Amount</th><th className="w-32" /></tr></thead>
                  <tbody>
                    {s.parts.map((p, i) => (
                      <tr key={i} className="border-b border-line/50">
                        <td className="px-1"><Picker value={p.ledgerId} options={partOpts} title="List of Ledger Accounts"
                          onChange={(v) => setList('parts', i, { ledgerId: v, bills: undefined })}
                          onEnd={!p.ledgerId && i > 0 ? endTable(tableRef) : undefined} /></td>
                        <td className="px-1"><Num value={p.amount} disabled={!p.ledgerId} onChange={(e) => setList('parts', i, { amount: e.target.value, bills: undefined })} onKeyDown={amountKeyDown('parts', i, p.ledgerId)} /></td>
                        <td className="px-1 text-xs text-muted">{p.ledgerId && (p.bills?.length ? `${p.bills.length} bill ref${p.bills.length > 1 ? 's' : ''}` : drcr(L(p.ledgerId)?.balance))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-ink/40"><td className="text-right pr-2 text-muted text-xs py-1">Total</td><td className="num font-semibold px-1">{amt(calc.partsTotal, true)}</td><td /></tr></tfoot>
                </table>
              </div>
            </>
          )}

          {/* ---------- journal (double entry) ---------- */}
          {base === 'journal' && (
            <div ref={tableRef}>
              <table className="w-full text-sm">
                <thead><tr className="border-y border-line text-xs text-muted"><th className="w-16 text-left px-1">Dr/Cr</th><th className="text-left px-1">Particulars</th><th className="w-36 text-right px-1">Debit</th><th className="w-36 text-right px-1">Credit</th></tr></thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/50">
                      <td className="px-1"><select className="tin" value={r.side} onChange={(e) => setList('rows', i, { side: e.target.value as 'dr' | 'cr' })}
                        onKeyDown={(e) => { if (e.key === 'd' || e.key === 'b') setList('rows', i, { side: 'dr' }); if (e.key === 'c' || e.key === 't') setList('rows', i, { side: 'cr' }); }}>
                        <option value="dr">Dr</option><option value="cr">Cr</option></select></td>
                      <td className="px-1"><Picker value={r.ledgerId} options={journalOpts} title="List of Ledger Accounts"
                        onChange={(v) => setList('rows', i, { ledgerId: v, bills: undefined, amount: r.amount || (() => { const d = calc.dr.minus(calc.cr).abs(); return d.isZero() ? '' : d.toFixed(2); })() })}
                        onEnd={!r.ledgerId && i > 1 ? endTable(tableRef) : undefined} /></td>
                      {r.side === 'dr'
                        ? <><td className="px-1"><Num value={r.amount} disabled={!r.ledgerId} onChange={(e) => setList('rows', i, { amount: e.target.value, bills: undefined })} onKeyDown={amountKeyDown('rows', i, r.ledgerId)} /></td><td /></>
                        : <><td /><td className="px-1"><Num value={r.amount} disabled={!r.ledgerId} onChange={(e) => setList('rows', i, { amount: e.target.value, bills: undefined })} onKeyDown={amountKeyDown('rows', i, r.ledgerId)} /></td></>}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-ink/40">
                  <td /><td className={`text-right pr-2 text-xs py-1 ${calc.dr.eq(calc.cr) ? 'text-muted' : 'text-bad font-semibold'}`}>{calc.dr.eq(calc.cr) ? 'Total' : `Difference ${amt(calc.dr.minus(calc.cr).abs(), true)}`}</td>
                  <td className="num font-semibold px-1">{amt(calc.dr, true)}</td><td className="num font-semibold px-1">{amt(calc.cr, true)}</td>
                </tr></tfoot>
              </table>
            </div>
          )}

          {/* ---------- invoices ---------- */}
          {INVOICE.includes(base) && (
            <>
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-1 mb-3">
                <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
                  <span className="text-sm text-muted">Party A/c name</span>
                  <Picker value={s.partyLedgerId} options={partyOpts} title="List of Party Ledgers" autoFocus={!id}
                    onChange={(v) => { const pl = L(v); up({ partyLedgerId: v, placeOfSupply: pl?.emirate ?? s.placeOfSupply }); }} />
                  <span className="text-sm text-muted">{outputSide ? 'Sales' : 'Purchase'} ledger</span>
                  <Picker value={s.salesLedgerId ?? salesLedgerOpts.find((o) => L(Number(o.id))?.reserved_key === (outputSide ? 'sales' : 'purchase'))?.id ?? null}
                    options={salesLedgerOpts} title="List of Ledger Accounts" onChange={(v) => up({ salesLedgerId: v })} />
                  <span className="text-sm text-muted">Place of supply</span>
                  <Select value={s.placeOfSupply} onChange={(v) => up({ placeOfSupply: v })} options={[['', party?.emirate ? 'Party emirate' : 'Company emirate'], ...EMIRATES]} />
                </div>
                {party && (
                  <div className="text-xs bg-sel-soft/60 border border-line px-3 py-2 self-start space-y-0.5">
                    <div className="font-semibold text-sm">{party.name}</div>
                    {party.address && <div>{party.address}</div>}
                    <div>TRN: {party.trn ?? <span className="text-muted">not registered</span>} · {party.vat_treatment ? party.vat_treatment.replace('_', ' ') : 'VAT treatment not set'}</div>
                    <div>Current balance: <span className="num">{drcr(party.balance) || 'Nil'}</span>{party.credit_days ? ` · ${party.credit_days} days credit` : ''}</div>
                  </div>
                )}
              </div>

              <div ref={itemsRef} className="mb-3">
                <table className="w-full text-sm">
                  <thead><tr className="border-y border-line text-xs text-muted">
                    <th className="text-left px-1 py-1">Name of Item</th>
                    {multiGodown && <th className="text-left px-1 w-36">Godown</th>}
                    <th className="w-24 text-right px-1">Quantity</th><th className="w-28 text-right px-1">Rate</th><th className="w-12 px-1">per</th>
                    <th className="w-16 text-right px-1">Disc %</th><th className="w-32 text-right px-1">Amount</th>
                    <th className="w-36 text-left px-1">VAT</th><th className="w-14 text-right px-1">VAT %</th>
                  </tr></thead>
                  <tbody>
                    {s.items.map((it, i) => {
                      const item = m.stockItems.find((x) => x.id === it.stockItemId);
                      return (
                        <tr key={i} className="border-b border-line/50">
                          <td className="px-1"><Picker value={it.stockItemId} options={itemOpts} title="List of Stock Items"
                            onChange={(v) => {
                              const si = m.stockItems.find((x) => x.id === v)!;
                              setList('items', i, {
                                stockItemId: v, godownId: it.godownId ?? mainGodown,
                                rate: it.rate || (outputSide && si.sales_price ? D(si.sales_price).toFixed(2) : ''),
                                ...defaultVat(si.vat_category, si.vat_rate, 'item'),
                              });
                            }}
                            onEnd={!it.stockItemId ? endTable(itemsRef) : undefined} /></td>
                          {multiGodown && <td className="px-1"><Picker value={it.godownId} options={godownOpts} disabled={!it.stockItemId} onChange={(v) => setList('items', i, { godownId: v })} title="List of Godowns" /></td>}
                          <td className="px-1"><Num value={it.qty} disabled={!it.stockItemId} onChange={(e) => setList('items', i, { qty: e.target.value })} /></td>
                          <td className="px-1"><Num value={it.rate} disabled={!it.stockItemId} onChange={(e) => setList('items', i, { rate: e.target.value })} /></td>
                          <td className="px-1 text-xs text-muted">{item?.unit}</td>
                          <td className="px-1"><Num value={it.discountPct} disabled={!it.stockItemId} onChange={(e) => setList('items', i, { discountPct: e.target.value })} /></td>
                          <td className="px-1 num">{it.stockItemId ? amt(calc.lineTaxable(it), true) : ''}</td>
                          <td className="px-1"><Select value={it.vatCategory} disabled={!it.stockItemId || !vatOn} options={vatOptions} onChange={(v) => setList('items', i, { vatCategory: v, vatRate: VAT_BEARING.includes(v) ? (it.vatRate !== '0' ? it.vatRate : '5') : '0' })} /></td>
                          <td className="px-1"><Num value={it.vatRate} disabled={!it.stockItemId || !VAT_BEARING.includes(it.vatCategory)} onChange={(e) => setList('items', i, { vatRate: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div ref={extrasRef} className="mb-3">
                <table className="w-full text-sm">
                  <thead><tr className="border-y border-line text-xs text-muted">
                    <th className="text-left px-1 py-1">Ledger lines (services, freight, discount as a minus amount)</th>
                    <th className="w-36 text-left px-1">VAT</th><th className="w-14 text-right px-1">VAT %</th><th className="w-32 text-right px-1">Amount</th>
                  </tr></thead>
                  <tbody>
                    {s.extras.map((x, i) => (
                      <tr key={i} className="border-b border-line/50">
                        <td className="px-1"><Picker value={x.ledgerId} options={extraOpts} title="List of Ledger Accounts"
                          onChange={(v) => { const l = L(v); setList('extras', i, { ledgerId: v, ...defaultVat(l?.vat_category, l?.vat_rate, 'ledger') }); }}
                          onEnd={!x.ledgerId ? endTable(extrasRef) : undefined} /></td>
                        <td className="px-1"><Select value={x.vatCategory} disabled={!x.ledgerId || !vatOn} options={vatOptions} onChange={(v) => setList('extras', i, { vatCategory: v, vatRate: VAT_BEARING.includes(v) ? (x.vatRate !== '0' ? x.vatRate : '5') : '0' })} /></td>
                        <td className="px-1"><Num value={x.vatRate} disabled={!x.ledgerId || !VAT_BEARING.includes(x.vatCategory)} onChange={(e) => setList('extras', i, { vatRate: e.target.value })} /></td>
                        <td className="px-1"><Num value={x.amount} disabled={!x.ledgerId} onChange={(e) => setList('extras', i, { amount: e.target.value })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <table className="text-sm min-w-80">
                  <tbody>
                    <tr><td className="pr-6 text-muted py-0.5">Taxable value</td><td className="num">{amt(calc.taxable, true)}</td></tr>
                    {vatOn && <tr><td className="pr-6 text-muted py-0.5">{outputSide ? 'Output' : 'Input'} VAT</td><td className="num">{amt(calc.charged, true)}</td></tr>}
                    {vatOn && !calc.self.isZero() && <tr><td className="pr-6 text-muted py-0.5 text-xs">Reverse charge VAT (self-assessed, not payable to supplier)</td><td className="num text-xs">{amt(calc.self, true)}</td></tr>}
                    <tr className="border-t-2 border-ink/40"><td className="pr-6 font-semibold py-1">Invoice total (AED)</td><td className="num font-semibold text-base">{amt(calc.total, true)}</td></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ---------- stock journal / physical stock ---------- */}
          {STOCK.includes(base) && (
            <div ref={tableRef}>
              <p className="text-xs text-muted mb-2">
                {base === 'stock_journal'
                  ? 'Transfers between godowns, consumption and production. Out lines reduce stock; in lines add it. Leave rate blank to use average cost.'
                  : 'Enter counted quantities. The difference from book stock is posted at average cost.'}
              </p>
              <table className="w-full text-sm">
                <thead><tr className="border-y border-line text-xs text-muted">
                  <th className="text-left px-1 py-1">Name of Item</th>
                  <th className="text-left px-1 w-40">Godown</th>
                  {base === 'stock_journal' && <th className="w-24 px-1 text-left">In / Out</th>}
                  <th className="w-28 text-right px-1">{base === 'stock_journal' ? 'Quantity' : 'Counted qty'}</th>
                  {base === 'stock_journal' && <th className="w-28 text-right px-1">Rate</th>}
                  <th className="w-28 text-right px-1 text-muted">In stock</th>
                </tr></thead>
                <tbody>
                  {s.stock.map((r, i) => {
                    const item = m.stockItems.find((x) => x.id === r.stockItemId);
                    return (
                      <tr key={i} className="border-b border-line/50">
                        <td className="px-1"><Picker value={r.stockItemId} options={itemOpts} title="List of Stock Items"
                          onChange={(v) => setList('stock', i, { stockItemId: v, godownId: r.godownId ?? mainGodown })}
                          onEnd={!r.stockItemId && i > 0 ? endTable(tableRef) : undefined} /></td>
                        <td className="px-1"><Picker value={r.godownId} options={godownOpts} disabled={!r.stockItemId} onChange={(v) => setList('stock', i, { godownId: v })} /></td>
                        {base === 'stock_journal' && <td className="px-1"><Select value={r.side} disabled={!r.stockItemId} onChange={(v) => setList('stock', i, { side: v as 'in' | 'out' })} options={[['out', 'Out (source)'], ['in', 'In (destination)']]} /></td>}
                        <td className="px-1"><Num value={r.qty} disabled={!r.stockItemId} onChange={(e) => setList('stock', i, { qty: e.target.value })} /></td>
                        {base === 'stock_journal' && <td className="px-1"><Num value={r.rate} disabled={!r.stockItemId} onChange={(e) => setList('stock', i, { rate: e.target.value })} placeholder="avg" /></td>}
                        <td className="px-1 num text-muted">{item ? `${D(item.balance_qty).toString()} ${item.unit}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 grid grid-cols-[8rem_1fr] gap-2 items-start">
            <span className="text-sm text-muted pt-1">Narration</span>
            <textarea className="tin border border-line min-h-14" value={s.narration} onChange={(e) => up({ narration: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); focusNext(e.currentTarget); } }} />
          </div>
          <div className="mt-3 text-right">
            <button data-nav className="px-4 py-1.5 bg-brand text-white disabled:opacity-50" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Accept (Ctrl+A)'}
            </button>
          </div>
        </div>
      </Form>

      {billFor && (() => {
        const line = billFor.list === 'parts' ? s.parts[billFor.index] : s.rows[billFor.index];
        const side = billFor.list === 'parts' ? (base === 'receipt' ? 'cr' : 'dr') : (line as JRow).side;
        const close = (bills?: BillAlloc[]) => {
          if (bills) setList(billFor.list, billFor.index, { bills } as any);
          const el = billFor.el;
          setBillFor(null);
          setTimeout(() => focusNext(el), 0);
        };
        return <BillModal ledgerId={line.ledgerId!} ledgerName={L(line.ledgerId)?.name ?? ''} amount={line.amount} side={side}
          bills={line.bills} voucherId={id} onAccept={(b) => close(b)} onClose={() => close()} />;
      })()}
      {confirm === 'quit' && <Confirm text="Quit without saving this voucher?" onYes={() => { setConfirm(null); app.pop(); }} onNo={() => setConfirm(null)} />}
      {confirm === 'cancel' && <Confirm text="Cancel this voucher? Its number is kept and its amounts become zero." onYes={() => doCancelOrDelete('cancel')} onNo={() => setConfirm(null)} />}
      {confirm === 'delete' && <Confirm text="Delete this voucher permanently?" onYes={() => doCancelOrDelete('delete')} onNo={() => setConfirm(null)} />}
    </div>
  );
}
