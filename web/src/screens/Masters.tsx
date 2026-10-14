import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp, BASE_LABEL, type Group } from '../lib/app';
import { D, drcr, EMIRATES, amt, VAT_CATEGORIES, VAT_TREATMENTS, VAT_BEARING } from '../lib/fmt';
import { useKeys } from '../lib/keys';
import { Picker } from '../components/Picker';
import { Confirm, Empty, Field, Form, Num, ScreenTitle, Section, Select, Text, useListNav, YesNo } from '../components/ui';
import { MASTER_LABEL } from './Gateway';

/** True if group `id` is `name` or sits anywhere under it. */
export function groupUnder(groups: Group[], id: number | null | undefined, ...names: string[]) {
  let g = groups.find((x) => x.id === id);
  while (g) {
    if (names.includes(g.name)) return true;
    g = groups.find((x) => x.id === g!.parentId);
  }
  return false;
}

// ---------- list (for Alter) ----------

export function MasterList({ active, kind }: { active: boolean; kind: string }) {
  const app = useApp();
  const m = app.masters;
  const [q, setQ] = useState('');
  const [del, setDel] = useState<any>(null);
  const rows = useMemo(() => {
    const all: { id: number; name: string; sub: string; right?: string; reserved?: boolean }[] = (() => {
      switch (kind) {
        case 'groups': return m.groups.map((g) => ({ id: g.id, name: g.name, sub: m.groups.find((p) => p.id === g.parentId)?.name ?? 'Primary', reserved: g.isReserved }));
        case 'ledgers': return m.ledgers.map((l) => ({ id: l.id, name: l.name, sub: l.group_name ?? 'Primary', right: drcr(l.balance) }));
        case 'voucher-types': return m.voucherTypes.map((v) => ({ id: v.id, name: v.name, sub: BASE_LABEL[v.base], reserved: v.isReserved }));
        case 'stock-items': return m.stockItems.map((s) => ({ id: s.id, name: s.name, sub: s.group_name ?? 'Primary', right: `${D(s.balance_qty).toString()} ${s.unit}` }));
        case 'stock-groups': return m.stockGroups.map((s) => ({ id: s.id, name: s.name, sub: m.stockGroups.find((p) => p.id === s.parentId)?.name ?? 'Primary' }));
        case 'units': return m.units.map((u) => ({ id: u.id, name: u.symbol, sub: u.formalName ?? '' }));
        case 'godowns': return m.godowns.map((g) => ({ id: g.id, name: g.name, sub: m.godowns.find((p) => p.id === g.parentId)?.name ?? 'Primary', reserved: g.isReserved }));
        default: return [];
      }
    })();
    const s = q.trim().toLowerCase();
    return s ? all.filter((r) => r.name.toLowerCase().includes(s) || r.sub.toLowerCase().includes(s)) : all;
  }, [kind, m, q]);
  const [sel] = useListNav(rows.length, active && !del, (i) => app.push('masterForm', { kind, id: rows[i].id }));
  useKeys([
    { key: 'alt+c', label: `Create ${MASTER_LABEL[kind]}`, run: () => app.push('masterForm', { kind }) },
    { key: 'alt+d', label: 'Delete', run: () => rows[sel] && setDel(rows[sel]) },
    { key: 'Escape', label: 'Back', run: () => app.pop(), inInputs: true },
  ], active && !del);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenTitle title={`List of ${MASTER_LABEL[kind]}s`} sub={`${rows.length} shown · Enter to alter`}
        right={<input className="tin w-56 border-b border-line" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />} />
      <div className="flex-1 overflow-auto scroll-thin">
        {!rows.length && <Empty>Nothing here yet. Alt+C to create.</Empty>}
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} data-row={i} onClick={() => app.push('masterForm', { kind, id: r.id })}
                className={`cursor-pointer border-b border-line ${i === sel ? 'row-sel' : 'hover:bg-sel-soft'}`}>
                <td className="px-4 py-1">{r.name}{r.reserved && <span className="ml-2 text-[10px] uppercase text-muted">predefined</span>}</td>
                <td className="px-4 py-1 text-muted">{r.sub}</td>
                <td className="px-4 py-1 num">{r.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {del && (
        <Confirm text={`Delete ${MASTER_LABEL[kind].toLowerCase()} "${del.name}"?`} onNo={() => setDel(null)}
          onYes={async () => {
            try { await api(app.cpath(`/${kind}/${del.id}`), { method: 'DELETE' }); app.toast('Deleted'); app.bump(); }
            catch (e: any) { app.toast(e.message, 'bad'); }
            setDel(null);
          }} />
      )}
    </div>
  );
}

// ---------- create / alter form ----------

const BLANK: Record<string, any> = {
  groups: { name: '', parentId: null, nature: 'assets', affectsGrossProfit: false },
  ledgers: {
    name: '', alias: '', groupId: null, openingAmount: '', openingSide: 'dr', maintainBillWise: false, creditDays: '',
    trn: '', address: '', emirate: '', country: 'United Arab Emirates', phone: '', email: '', vatTreatment: '',
    vatCategory: '', vatRate: '', bankName: '', accountNo: '', iban: '', swift: '',
  },
  'voucher-types': { name: '', base: 'sales', abbreviation: '', prefix: '', nextNumber: 1, autoNumber: true, active: true },
  units: { symbol: '', formalName: '', decimals: 0 },
  'stock-groups': { name: '', parentId: null },
  godowns: { name: '', parentId: null },
  'stock-items': { name: '', alias: '', partNo: '', stockGroupId: null, unitId: null, vatCategory: 'standard', vatRate: '5', salesPrice: '', reorderLevel: '', openingQty: '', openingRate: '', openingGodownId: null },
};

function toForm(kind: string, row: any) {
  const f = { ...BLANK[kind], ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) };
  if (kind === 'ledgers') {
    const ob = D(row.openingBalance);
    f.openingAmount = ob.isZero() ? '' : ob.abs().toFixed(2);
    f.openingSide = ob.isNeg() ? 'cr' : 'dr';
    f.creditDays = row.creditDays ?? '';
  }
  if (kind === 'stock-items') {
    f.openingQty = D(row.openingQty).isZero() ? '' : D(row.openingQty).toString();
    f.openingRate = D(row.openingRate).isZero() ? '' : D(row.openingRate).toFixed(2);
    f.parentId = undefined;
  }
  for (const k of ['parentId', 'groupId', 'stockGroupId', 'unitId', 'openingGodownId']) if (f[k] === '') f[k] = null;
  return f;
}

function toBody(kind: string, f: any) {
  const nil = (v: any) => (v === '' ? null : v);
  switch (kind) {
    case 'ledgers': {
      const ob = D(f.openingAmount).abs();
      return {
        name: f.name, alias: nil(f.alias), groupId: f.groupId ?? undefined,
        openingBalance: (f.openingSide === 'cr' ? ob.neg() : ob).toFixed(2),
        maintainBillWise: f.maintainBillWise, creditDays: f.creditDays === '' ? null : Number(f.creditDays),
        trn: nil(f.trn), address: nil(f.address), emirate: nil(f.emirate), country: nil(f.country), phone: nil(f.phone), email: nil(f.email),
        vatTreatment: nil(f.vatTreatment), vatCategory: nil(f.vatCategory), vatRate: nil(f.vatRate),
        bankName: nil(f.bankName), accountNo: nil(f.accountNo), iban: nil(f.iban), swift: nil(f.swift),
      };
    }
    case 'stock-items':
      return {
        name: f.name, alias: nil(f.alias), partNo: nil(f.partNo), stockGroupId: f.stockGroupId, unitId: f.unitId,
        vatCategory: f.vatCategory, vatRate: f.vatRate || '0', salesPrice: nil(f.salesPrice), reorderLevel: nil(f.reorderLevel),
        openingQty: f.openingQty || '0', openingRate: f.openingRate || '0', openingGodownId: f.openingGodownId,
      };
    case 'voucher-types':
      return { name: f.name, base: f.base, abbreviation: nil(f.abbreviation), prefix: f.prefix ?? '', nextNumber: Number(f.nextNumber) || 1, autoNumber: f.autoNumber, active: f.active };
    case 'units': return { symbol: f.symbol, formalName: nil(f.formalName), decimals: Number(f.decimals) || 0 };
    case 'groups': return { name: f.name, parentId: f.parentId || null, nature: f.nature, affectsGrossProfit: f.affectsGrossProfit };
    default: return { name: f.name, parentId: f.parentId || null };
  }
}

export function MasterForm({ active, kind, id, defaults, onSaved }: {
  active: boolean; kind: string; id?: number; defaults?: Record<string, any>; onSaved?: (row: any) => void;
}) {
  const app = useApp();
  const m = app.masters;
  const [f, setF] = useState<any>({ ...BLANK[kind], ...defaults });
  const [row, setRow] = useState<any>(null);
  const [formKey, setFormKey] = useState(0);
  const set = (k: string) => (v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const ev = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k)(e.target.value);

  useEffect(() => {
    if (!id) return;
    api(app.cpath(`/${kind}/${id}`)).then((r) => { setRow(r); setF(toForm(kind, r)); setFormKey((k) => k + 1); })
      .catch((e) => app.toast(e.message, 'bad'));
  }, [id, kind]);

  const save = async () => {
    try {
      const body = toBody(kind, f);
      const saved = id
        ? await api(app.cpath(`/${kind}/${id}`), { method: 'PUT', body })
        : await api(app.cpath(`/${kind}`), { body });
      app.toast(`${MASTER_LABEL[kind]} "${saved.name ?? saved.symbol}" ${id ? 'altered' : 'created'}`);
      app.bump();
      if (onSaved) { onSaved(saved); app.pop(); }
      else if (id) app.pop();
      else { setF({ ...BLANK[kind] }); setFormKey((k) => k + 1); }
    } catch (e: any) { app.toast(e.message, 'bad'); }
  };
  useKeys([
    { key: 'ctrl+a', label: 'Accept', run: save, inInputs: true },
    { key: 'Escape', label: 'Quit', run: () => app.pop(), inInputs: true },
  ], active);

  const reserved = row?.isReserved;
  const groupOpts = [{ id: 0, label: 'Primary' }, ...m.groups.filter((g) => g.id !== id).map((g) => ({ id: g.id, label: g.name, sub: m.groups.find((p) => p.id === g.parentId)?.name ?? 'Primary' }))];
  const ledgerGroupOpts = m.groups.map((g) => ({ id: g.id, label: g.name, sub: m.groups.find((p) => p.id === g.parentId)?.name ?? 'Primary' }));
  const sgOpts = [{ id: 0, label: 'Primary' }, ...m.stockGroups.filter((g) => g.id !== id).map((g) => ({ id: g.id, label: g.name }))];
  const gdOpts = m.godowns.filter((g) => g.id !== id).map((g) => ({ id: g.id, label: g.name }));
  const under = (...names: string[]) => groupUnder(m.groups, f.groupId, ...names);
  const isParty = under('Sundry Debtors', 'Sundry Creditors');
  const isBank = under('Bank Accounts', 'Bank OD A/c');
  const isRevenue = under('Sales Accounts', 'Purchase Accounts', 'Direct Incomes', 'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses', 'Fixed Assets');
  const isPL = row?.reservedKey === 'pl';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenTitle title={`${MASTER_LABEL[kind]} ${id ? 'Alteration' : 'Creation'}`} sub="Enter moves on · Ctrl+A accepts"
        right={reserved ? 'Predefined master: only some fields can change' : undefined} />
      <Form key={formKey} onEnd={save} className="flex-1 overflow-auto p-6">
        {kind === 'groups' && (
          <Section title="Group">
            <Field label="Name"><Text value={f.name} onChange={ev('name')} autoFocus /></Field>
            <Field label="Under"><Picker value={f.parentId ?? 0} options={groupOpts} onChange={set('parentId')} title="List of Groups" disabled={reserved} /></Field>
            {!f.parentId && (
              <>
                <Field label="Nature of group"><Select value={f.nature} onChange={set('nature')} disabled={reserved}
                  options={[['assets', 'Assets'], ['liabilities', 'Liabilities'], ['income', 'Income'], ['expenses', 'Expenses']]} /></Field>
                {(f.nature === 'income' || f.nature === 'expenses') && (
                  <Field label="Does it affect gross profit?"><YesNo value={f.affectsGrossProfit} onChange={set('affectsGrossProfit')} disabled={reserved} /></Field>
                )}
              </>
            )}
          </Section>
        )}

        {kind === 'ledgers' && (
          <div className="grid lg:grid-cols-2 gap-x-10">
            <div>
              <Section title="Ledger">
                <Field label="Name"><Text value={f.name} onChange={ev('name')} autoFocus /></Field>
                <Field label="Alias"><Text value={f.alias} onChange={ev('alias')} /></Field>
                {!isPL && <Field label="Under"><Picker value={f.groupId} options={ledgerGroupOpts} onChange={set('groupId')} title="List of Groups" /></Field>}
              </Section>
              {isParty && (
                <Section title="Bill-wise details">
                  <Field label="Maintain balances bill-by-bill"><YesNo value={f.maintainBillWise} onChange={set('maintainBillWise')} /></Field>
                  {f.maintainBillWise && <Field label="Default credit period (days)"><Num value={f.creditDays} onChange={ev('creditDays')} className="w-24" /></Field>}
                </Section>
              )}
              {isBank && (
                <Section title="Bank details">
                  <Field label="Bank name"><Text value={f.bankName} onChange={ev('bankName')} /></Field>
                  <Field label="Account number"><Text value={f.accountNo} onChange={ev('accountNo')} /></Field>
                  <Field label="IBAN"><Text value={f.iban} onChange={ev('iban')} maxLength={23} /></Field>
                  <Field label="SWIFT code"><Text value={f.swift} onChange={ev('swift')} /></Field>
                </Section>
              )}
              {isRevenue && (
                <Section title="VAT defaults">
                  <Field label="VAT category"><Select value={f.vatCategory} onChange={set('vatCategory')} options={[['', 'Not applicable'], ...VAT_CATEGORIES]} /></Field>
                  {VAT_BEARING.includes(f.vatCategory) && <Field label="VAT rate %"><Num value={f.vatRate} onChange={ev('vatRate')} className="w-20" /></Field>}
                </Section>
              )}
              <Section title="Opening balance">
                <Field label={`Opening balance (on ${app.company?.booksFrom ?? ''})`}>
                  <div className="flex gap-2"><Num value={f.openingAmount} onChange={ev('openingAmount')} className="w-40" />
                    <Select value={f.openingSide} onChange={set('openingSide')} options={[['dr', 'Dr'], ['cr', 'Cr']]} className="w-16" /></div>
                </Field>
              </Section>
            </div>
            {isParty && (
              <div>
                <Section title="Mailing details">
                  <Field label="Address"><Text value={f.address} onChange={ev('address')} /></Field>
                  <Field label="Emirate"><Select value={f.emirate} onChange={set('emirate')} options={[['', 'Outside UAE'], ...EMIRATES]} /></Field>
                  <Field label="Country"><Text value={f.country} onChange={ev('country')} /></Field>
                  <Field label="Phone"><Text value={f.phone} onChange={ev('phone')} /></Field>
                  <Field label="E-mail"><Text value={f.email} onChange={ev('email')} /></Field>
                </Section>
                <Section title="VAT registration">
                  <Field label="VAT treatment"><Select value={f.vatTreatment} onChange={set('vatTreatment')} options={[['', 'Not set'], ...VAT_TREATMENTS]} /></Field>
                  <Field label="TRN"><Text value={f.trn} maxLength={15} onChange={(e) => set('trn')(e.target.value.replace(/\D/g, ''))} /></Field>
                </Section>
              </div>
            )}
          </div>
        )}

        {kind === 'voucher-types' && (
          <Section title="Voucher type">
            <Field label="Name"><Text value={f.name} onChange={ev('name')} autoFocus disabled={reserved} /></Field>
            <Field label="Type of voucher"><Select value={f.base} onChange={set('base')} disabled={!!id} options={Object.entries(BASE_LABEL)} /></Field>
            <Field label="Abbreviation"><Text value={f.abbreviation} onChange={ev('abbreviation')} /></Field>
            <Field label="Automatic numbering"><YesNo value={f.autoNumber} onChange={set('autoNumber')} /></Field>
            <Field label="Prefix" hint="e.g. INV/26/"><Text value={f.prefix} onChange={ev('prefix')} /></Field>
            <Field label="Next number"><Num value={f.nextNumber} onChange={ev('nextNumber')} className="w-24" /></Field>
            {!reserved && <Field label="Active"><YesNo value={f.active} onChange={set('active')} /></Field>}
          </Section>
        )}

        {kind === 'units' && (
          <Section title="Unit of measure">
            <Field label="Symbol"><Text value={f.symbol} onChange={ev('symbol')} autoFocus /></Field>
            <Field label="Formal name"><Text value={f.formalName} onChange={ev('formalName')} /></Field>
            <Field label="Number of decimal places"><Num value={f.decimals} onChange={ev('decimals')} className="w-16" /></Field>
          </Section>
        )}

        {(kind === 'stock-groups' || kind === 'godowns') && (
          <Section title={MASTER_LABEL[kind]}>
            <Field label="Name"><Text value={f.name} onChange={ev('name')} autoFocus /></Field>
            {!reserved && <Field label="Under"><Picker value={f.parentId ?? 0} onChange={set('parentId')}
              options={kind === 'stock-groups' ? sgOpts : [{ id: 0, label: 'Primary' }, ...gdOpts]} /></Field>}
          </Section>
        )}

        {kind === 'stock-items' && (
          <div className="grid lg:grid-cols-2 gap-x-10">
            <div>
              <Section title="Stock item">
                <Field label="Name"><Text value={f.name} onChange={ev('name')} autoFocus /></Field>
                <Field label="Alias"><Text value={f.alias} onChange={ev('alias')} /></Field>
                <Field label="Part no. / SKU"><Text value={f.partNo} onChange={ev('partNo')} /></Field>
                <Field label="Under"><Picker value={f.stockGroupId ?? 0} options={sgOpts} onChange={(v) => set('stockGroupId')(v || null)} title="List of Stock Groups" /></Field>
                <Field label="Units"><Picker value={f.unitId} options={m.units.map((u) => ({ id: u.id, label: u.symbol, sub: u.formalName ?? '' }))} onChange={set('unitId')} title="List of Units" /></Field>
              </Section>
              <Section title="VAT and pricing">
                <Field label="VAT category"><Select value={f.vatCategory} onChange={set('vatCategory')} options={VAT_CATEGORIES} /></Field>
                {VAT_BEARING.includes(f.vatCategory) && <Field label="VAT rate %"><Num value={f.vatRate} onChange={ev('vatRate')} className="w-20" /></Field>}
                <Field label="Standard selling price"><Num value={f.salesPrice} onChange={ev('salesPrice')} className="w-32" /></Field>
                <Field label="Reorder level"><Num value={f.reorderLevel} onChange={ev('reorderLevel')} className="w-32" /></Field>
              </Section>
            </div>
            <div>
              <Section title="Opening balance">
                <Field label="Quantity"><Num value={f.openingQty} onChange={ev('openingQty')} className="w-32" /></Field>
                <Field label="Rate"><Num value={f.openingRate} onChange={ev('openingRate')} className="w-32" /></Field>
                <Field label="Value"><span className="num px-1">{amt(D(f.openingQty).times(D(f.openingRate)), true)}</span></Field>
                <Field label="Godown"><Picker value={f.openingGodownId ?? m.godowns.find((g) => g.isReserved)?.id} options={gdOpts} onChange={set('openingGodownId')} /></Field>
              </Section>
            </div>
          </div>
        )}
      </Form>
    </div>
  );
}
