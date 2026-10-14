import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp, type Company } from '../lib/app';
import { EMIRATES, emirateName, fdate } from '../lib/fmt';
import { useKeys } from '../lib/keys';
import { Confirm, DateInput, Field, Form, ScreenTitle, Section, Select, Text, useListNav, YesNo } from '../components/ui';

export function Companies({ active }: { active: boolean }) {
  const app = useApp();
  const [list, setList] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<Company | null>(null);
  const load = () => api<Company[]>('/companies').then(setList).catch((e) => app.toast(e.message, 'bad'));
  useEffect(() => { if (active) load(); }, [active]);

  const demo = async () => {
    setBusy(true);
    try { app.openCompany(await api<Company>('/companies/demo', { method: 'POST' })); app.toast('Demo company created'); }
    catch (e: any) { app.toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  const items = list ?? [];
  const [sel] = useListNav(items.length, active && !del, (i) => app.openCompany(items[i]));
  useKeys([
    { key: 'alt+c', label: 'Create Company', run: () => app.push('companyForm', {}) },
    { key: 'alt+m', label: 'Demo Company', run: () => { if (!busy) demo(); } },
    { key: 'alt+d', label: 'Delete Company', run: () => items[sel] && setDel(items[sel]) },
  ], active && !del);

  return (
    <div className="flex-1 flex flex-col">
      <ScreenTitle title="Select Company" sub="Enter to open" />
      <div className="flex-1 flex items-start justify-center pt-12 px-4">
        <div className="w-full max-w-2xl bg-panel border border-line">
          <div className="bg-brand text-white text-sm font-semibold px-3 py-1.5 flex">
            <span>List of Companies</span><span className="ml-auto opacity-80">Books from</span>
          </div>
          {list && !list.length && (
            <div className="p-6 text-center">
              <p className="mb-4 text-muted">No companies yet.</p>
              <div className="flex gap-3 justify-center">
                <button className="px-4 py-2 bg-brand text-white" onClick={() => app.push('companyForm', {})}>Create company (Alt+C)</button>
                <button className="px-4 py-2 border border-brand text-brand" disabled={busy} onClick={demo}>
                  {busy ? 'Creating demo…' : 'Try a demo company (Alt+M)'}
                </button>
              </div>
            </div>
          )}
          {items.map((c, i) => (
            <button key={c.id} data-row={i} onClick={() => app.openCompany(c)}
              className={`w-full text-left px-3 py-1.5 flex border-b border-line last:border-0 ${i === sel ? 'row-sel' : ''}`}>
              <span className="font-medium">{c.name}</span>
              <span className="ml-3 text-xs text-muted self-center">{emirateName(c.emirate)}{c.trn ? ` · TRN ${c.trn}` : ''}</span>
              <span className="ml-auto text-sm">{fdate(c.booksFrom)}</span>
            </button>
          ))}
        </div>
      </div>
      {del && (
        <Confirm text={`Delete "${del.name}" and all its vouchers permanently?`} onNo={() => setDel(null)}
          onYes={async () => {
            try { await api(`/companies/${del.id}`, { method: 'DELETE' }); app.toast('Company deleted'); load(); }
            catch (e: any) { app.toast(e.message, 'bad'); }
            setDel(null);
          }} />
      )}
    </div>
  );
}

export function CompanyForm({ active, alter }: { active: boolean; alter?: boolean }) {
  const app = useApp();
  const year = new Date().getFullYear();
  const init = alter && app.company ? app.company : null;
  const [f, setF] = useState({
    name: init?.name ?? '', mailingName: init?.mailingName ?? '', address: init?.address ?? '',
    emirate: init?.emirate ?? 'dubai', trn: init?.trn ?? '', phone: init?.phone ?? '', email: init?.email ?? '',
    fyStart: init?.fyStart ?? `${year}-01-01`, booksFrom: init?.booksFrom ?? `${year}-01-01`,
    vatRegistered: init?.vatRegistered ?? true, lockedUntil: init?.lockedUntil ?? null as string | null,
  });
  const set = (k: keyof typeof f) => (v: any) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    try {
      if (alter && init) {
        await api(`/companies/${init.id}`, { method: 'PUT', body: f });
        await app.refreshCompany();
        app.toast('Company altered');
        app.pop();
      } else {
        const { lockedUntil: _l, ...body } = f;
        const c = await api<Company>('/companies', { body });
        app.toast(`${c.name} created with the 28 predefined groups`);
        app.openCompany(c);
      }
    } catch (e: any) { app.toast(e.message, 'bad'); }
  };
  useKeys([
    { key: 'ctrl+a', label: 'Accept', run: save, inInputs: true },
    { key: 'Escape', label: 'Quit', run: () => app.pop(), inInputs: true },
  ], active);

  return (
    <div className="flex-1 flex flex-col">
      <ScreenTitle title={alter ? 'Company Alteration' : 'Company Creation'} sub="Ctrl+A to accept" />
      <Form onEnd={save} className="p-6 overflow-auto">
        <Section title="Company details">
          <Field label="Company name"><Text value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus /></Field>
          <Field label="Mailing name"><Text value={f.mailingName} onChange={(e) => set('mailingName')(e.target.value)} /></Field>
          <Field label="Address"><Text value={f.address} onChange={(e) => set('address')(e.target.value)} /></Field>
          <Field label="Emirate"><Select value={f.emirate} onChange={set('emirate')} options={EMIRATES} /></Field>
          <Field label="Phone"><Text value={f.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
          <Field label="E-mail"><Text value={f.email} onChange={(e) => set('email')(e.target.value)} /></Field>
        </Section>
        <Section title="Books">
          <Field label="Base currency"><span className="px-1">AED (UAE Dirham)</span></Field>
          <Field label="Financial year beginning from"><DateInput value={f.fyStart} onChange={(v) => v && set('fyStart')(v)} refDate={f.fyStart} /></Field>
          <Field label="Books beginning from"><DateInput value={f.booksFrom} onChange={(v) => v && set('booksFrom')(v)} refDate={f.booksFrom} /></Field>
          {alter && (
            <Field label="Lock books up to (period close)" hint="blank = open">
              <DateInput value={f.lockedUntil} onChange={set('lockedUntil')} refDate={app.date} allowEmpty />
            </Field>
          )}
        </Section>
        <Section title="UAE VAT">
          <Field label="Registered for VAT"><YesNo value={f.vatRegistered} onChange={set('vatRegistered')} /></Field>
          <Field label="TRN (15 digits)"><Text value={f.trn} maxLength={15} onChange={(e) => set('trn')(e.target.value.replace(/\D/g, ''))} /></Field>
        </Section>
      </Form>
    </div>
  );
}
