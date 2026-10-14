import { useState } from 'react';
import { AppProvider, useApp, VOUCHER_KEYS, BASE_LABEL } from './lib/app';
import { fdate, fday, todayIso } from './lib/fmt';
import { keyLabel, pressKey, useBarBindings, useKeys, type Binding } from './lib/keys';
import { DateInput, Field, Form, Modal } from './components/ui';
import { Picker } from './components/Picker';
import { SCREENS, GOTO } from './screens';

export function App() {
  return (
    <AppProvider today={todayIso()}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const app = useApp();
  const { company, stack, period, date, toasts } = app;
  const [dialog, setDialog] = useState<'period' | 'goto' | null>(null);

  const global: Binding[] = company ? [
    { key: 'F2', label: 'Period', run: () => setDialog('period') },
    { key: 'F3', label: 'Company', run: () => app.openCompany(null) },
    { key: 'alt+g', label: 'Go To', run: () => setDialog('goto') },
    { key: 'ctrl+g', hidden: true, run: () => setDialog('goto') },
    ...VOUCHER_KEYS.map(([key, base]): Binding => ({ key, run: () => app.push('voucher', { base }) })),
  ] : [];
  useKeys(global, !dialog, { bar: false });

  const screenBar = useBarBindings();
  const top = stack[stack.length - 1];

  return (
    <div className="h-full flex flex-col">
      <header className="no-print bg-brand-dark text-white flex items-center gap-4 px-4 h-10 shrink-0">
        <div className="font-semibold tracking-wide">Tally<span className="text-sel">Cloud</span></div>
        {company && (
          <>
            <div className="text-sm opacity-90 truncate">{company.name}</div>
            <div className="ml-auto flex items-center gap-4 text-xs">
              <span>Period: <b>{fdate(period.from)}</b> to <b>{fdate(period.to)}</b></span>
              <span>Date: <b>{fdate(date)}</b> {fday(date)}</span>
              {company.lockedUntil && <span className="bg-white/15 px-1.5 py-0.5">Locked to {fdate(company.lockedUntil)}</span>}
            </div>
          </>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 relative">
          {stack.map((s, i) => {
            const C = SCREENS[s.type];
            const active = i === stack.length - 1 && !dialog;
            return (
              <div key={s.id} className={i === stack.length - 1 ? 'absolute inset-0 flex flex-col' : 'hidden'} {...(i === stack.length - 1 ? { 'data-active-screen': '' } : {})}>
                {C ? <C active={active} {...s.props} /> : <div className="p-6">Unknown screen {s.type}</div>}
              </div>
            );
          })}
        </main>

        <aside className="no-print w-44 shrink-0 border-l border-line bg-[#eef2ee] flex flex-col text-xs overflow-auto scroll-thin">
          {[...global.filter((b) => b.label), ...screenBar].map((b) => (
            <button key={b.key + b.label} onClick={() => pressKey(b)}
              className="text-left px-2 py-1.5 border-b border-line hover:bg-sel-soft flex gap-2">
              <span className="font-mono font-semibold text-brand w-14 shrink-0">{keyLabel(b.key)}</span>
              <span className="truncate">{b.label}</span>
            </button>
          ))}
          {company && top?.type !== 'voucher' && (
            <div className="mt-auto border-t border-line">
              {VOUCHER_KEYS.slice(0, 8).map(([key, base]) => (
                <button key={key} onClick={() => app.push('voucher', { base })} className="w-full text-left px-2 py-1 hover:bg-sel-soft flex gap-2">
                  <span className="font-mono font-semibold text-brand w-14 shrink-0">{keyLabel(key)}</span>
                  <span>{BASE_LABEL[base]}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {dialog === 'period' && <PeriodDialog onClose={() => setDialog(null)} />}
      {dialog === 'goto' && <GotoDialog onClose={() => setDialog(null)} />}

      <div className="no-print fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center">
        {toasts.map((t) => (
          <div key={t.id} className={`px-4 py-2 shadow-lg text-sm text-white ${t.kind === 'bad' ? 'bg-bad' : 'bg-ok'}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

function PeriodDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [from, setFrom] = useState(app.period.from);
  const [to, setTo] = useState(app.period.to);
  const [date, setDate] = useState(app.date);
  const accept = () => {
    if (from > to) return app.toast('Period start is after its end', 'bad');
    app.setPeriod({ from, to });
    app.setDate(date);
    onClose();
  };
  return (
    <Modal title="Change Period & Date" onClose={onClose} width="max-w-md" keys={[{ key: 'ctrl+a', run: accept, inInputs: true }]}>
      <Form onEnd={accept}>
        <Field label="From"><DateInput value={from} onChange={(v) => v && setFrom(v)} refDate={app.date} autoFocus /></Field>
        <Field label="To"><DateInput value={to} onChange={(v) => v && setTo(v)} refDate={app.date} /></Field>
        <Field label="Current date (for new vouchers)"><DateInput value={date} onChange={(v) => v && setDate(v)} refDate={app.date} /></Field>
      </Form>
      <p className="text-xs text-muted mt-3">Type 1-4 or 1/4/26 for dates. Enter moves on, Ctrl+A accepts.</p>
    </Modal>
  );
}

function GotoDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const options = GOTO.map((g, i) => ({ id: i, label: g.label, sub: g.group }));
  return (
    <Modal title="Go To" onClose={onClose} width="max-w-lg">
      <Form>
        <Picker value={null} options={options} autoFocus title="List of Reports and Screens" placeholder="Type to search…"
          onChange={(i: number) => { onClose(); const g = GOTO[i]; app.push(g.type, g.props ?? {}); }} />
      </Form>
      <div className="h-72" />
    </Modal>
  );
}
