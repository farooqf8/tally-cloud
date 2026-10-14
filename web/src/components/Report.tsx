import type { ReactNode } from 'react';
import { useApp } from '../lib/app';
import { fdate } from '../lib/fmt';
import { useKeys, type Binding } from '../lib/keys';

/** Common frame for reports: title strip, period, Esc back, Alt+E export, Ctrl+P print. */
export function Report({ title, active, period = true, asOn, onExport, keys = [], loading, children, toolbar }: {
  title: string; active: boolean; period?: boolean; asOn?: string; onExport?: () => void; keys?: Binding[];
  loading?: boolean; children: ReactNode; toolbar?: ReactNode;
}) {
  const app = useApp();
  useKeys([
    ...keys,
    ...(onExport ? [{ key: 'alt+e', label: 'Export CSV', run: onExport }] : []),
    { key: 'ctrl+p', label: 'Print', run: () => window.print() },
    { key: 'Escape', label: 'Back', run: () => app.pop(), inInputs: true },
  ], active);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <div>
          <h1 className="text-base font-semibold text-brand-dark">{title}</h1>
          <div className="text-xs text-muted">{app.company?.name}</div>
        </div>
        {toolbar && <div className="no-print ml-6 flex items-center gap-2">{toolbar}</div>}
        <div className="ml-auto text-sm text-right">
          {asOn ? <>as at <b>{fdate(asOn)}</b></> : period ? <><b>{fdate(app.period.from)}</b> to <b>{fdate(app.period.to)}</b></> : null}
          {loading && <div className="text-xs text-muted">Loading…</div>}
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin">{children}</div>
    </div>
  );
}

export const th = 'px-3 py-1.5 text-xs font-semibold text-muted border-b border-line bg-[#f3f5f1] sticky top-0';
export const td = 'px-3 py-1';
