import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fdate, parseDate } from '../lib/fmt';
import { formKeyDown, useKeys } from '../lib/keys';

/** Title strip at the top of every screen. */
export function ScreenTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
      <h1 className="text-base font-semibold text-brand-dark">{title}</h1>
      {sub && <div className="text-sm text-muted">{sub}</div>}
      <div className="ml-auto text-sm text-muted">{right}</div>
    </div>
  );
}

/** A [data-form] container: Enter moves to the next field, and 'formend' fires after the last. */
export function Form({ children, onEnd, className }: { children: ReactNode; onEnd?: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    const el = ref.current!;
    const h = () => endRef.current?.();
    el.addEventListener('formend', h);
    return () => el.removeEventListener('formend', h);
  }, []);
  return <div ref={ref} data-form onKeyDown={formKeyDown} className={className}>{children}</div>;
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`grid ${wide ? 'grid-cols-[12rem_1fr]' : 'grid-cols-[12rem_minmax(0,22rem)]'} items-center gap-x-2 py-0.5`}>
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted">:</span>
        <div className="flex-1 min-w-0">{children}</div>
        {hint && <span className="text-xs text-muted whitespace-nowrap">{hint}</span>}
      </div>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand border-b border-line mb-1 pb-0.5">{title}</div>
      {children}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export const Text = (p: InputProps) => <input {...p} className={`tin ${p.className ?? ''}`} autoComplete="off" />;
export const Num = (p: InputProps) => <input inputMode="decimal" {...p} className={`tin num ${p.className ?? ''}`} autoComplete="off" />;

export function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <select className="tin w-24" value={value ? 'yes' : 'no'} disabled={disabled}
      onChange={(e) => onChange(e.target.value === 'yes')}
      onKeyDown={(e) => { if (e.key === 'y') onChange(true); if (e.key === 'n') onChange(false); }}>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

export function Select({ value, onChange, options, className, disabled }: {
  value: string | number | null | undefined; onChange: (v: string) => void; options: [string | number, string][]; className?: string; disabled?: boolean;
}) {
  return (
    <select className={`tin ${className ?? ''}`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={String(v)} value={v}>{l}</option>)}
    </select>
  );
}

/** Date field that shows 12-Feb-2026 and accepts "12", "12-2", "12/2/26" and so on. */
export function DateInput({ value, onChange, refDate, autoFocus, className, allowEmpty }: {
  value: string | null; onChange: (v: string | null) => void; refDate: string; autoFocus?: boolean; className?: string; allowEmpty?: boolean;
}) {
  const [text, setText] = useState(fdate(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(fdate(value)), [value]);
  const commit = () => {
    if (!text.trim() && allowEmpty) { setBad(false); onChange(null); return; }
    const iso = parseDate(text, value ?? refDate);
    if (iso) { setBad(false); onChange(iso); setText(fdate(iso)); } else setBad(true);
  };
  return (
    <input className={`tin ${bad ? 'text-bad' : ''} ${className ?? ''}`} value={text} autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} autoComplete="off" />
  );
}

export function Modal({ title, children, onClose, width = 'max-w-2xl', keys = [] }: {
  title: string; children: ReactNode; onClose: () => void; width?: string; keys?: Parameters<typeof useKeys>[0];
}) {
  useKeys([{ key: 'Escape', run: () => onClose(), inInputs: true }, ...keys], true, { modal: true, bar: false });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Take focus from the screen behind (unless a field inside autofocused) and give it back on close.
    const prev = document.activeElement as HTMLElement | null;
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-start justify-center pt-[10vh] px-4">
      <div ref={box} tabIndex={-1} className={`w-full ${width} bg-panel border border-brand shadow-2xl outline-none`}>
        <div className="bg-brand text-white px-3 py-1.5 text-sm font-semibold flex">
          <span>{title}</span>
          <button className="ml-auto opacity-80 hover:opacity-100" onClick={onClose}>Esc</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <Modal title="Confirm" onClose={onNo} width="max-w-sm"
      keys={[{ key: 'y', run: onYes, inInputs: true }, { key: 'n', run: onNo, inInputs: true }, { key: 'Enter', run: onYes, inInputs: true }]}>
      <p className="mb-4">{text}</p>
      <div className="flex gap-2 justify-end">
        <button className="px-3 py-1 bg-brand text-white" onClick={onYes}><span className="hk">Y</span>es</button>
        <button className="px-3 py-1 border border-line" onClick={onNo}><span className="hk">N</span>o</button>
      </div>
    </Modal>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-muted py-10">{children}</div>;
}

/** Moves a highlighted row with arrow keys; Enter calls onOpen. */
export function useListNav(count: number, active: boolean, onOpen: (i: number) => void, initial = 0) {
  const [sel, setSel] = useState(initial);
  useEffect(() => { if (sel >= count) setSel(Math.max(0, count - 1)); }, [count, sel]);
  useKeys([
    { key: 'ArrowDown', run: () => setSel((s) => Math.min(count - 1, s + 1)) },
    { key: 'ArrowUp', run: () => setSel((s) => Math.max(0, s - 1)) },
    { key: 'PageDown', run: () => setSel((s) => Math.min(count - 1, s + 15)) },
    { key: 'PageUp', run: () => setSel((s) => Math.max(0, s - 15)) },
    { key: 'Home', run: () => setSel(0) },
    { key: 'End', run: () => setSel(count - 1) },
    { key: 'Enter', run: () => { if (count) onOpen(sel); } },
  ], active, { bar: false });
  useEffect(() => {
    if (active) document.querySelector(`[data-active-screen] [data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel, active]);
  return [sel, setSel] as const;
}
