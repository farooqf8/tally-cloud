// Profit & Loss A/c and Balance Sheet in Tally's horizontal (two-sided) layout.
import { useMemo, useState } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, downloadCsv } from '../lib/fmt';
import { Report } from '../components/Report';
import { useListNav } from '../components/ui';

interface Line { label: string; amount: string; groupId?: number; ledgerId?: number; children?: Line[]; kind?: string }
interface Row { line: Line; depth: number }

function rowsOf(lines: Line[], expandAll: boolean): Row[] {
  const out: Row[] = [];
  for (const l of lines) {
    out.push({ line: l, depth: 0 });
    if ((expandAll || l.kind === 'pl') && l.children) for (const c of l.children) out.push({ line: c, depth: 1 });
  }
  return out;
}

function Side({ title, rows, total, selIndex, offset, onOpen }: { title: string; rows: Row[]; total: string; selIndex: number; offset: number; onOpen: (i: number) => void }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col border border-line bg-panel">
      <div className="flex px-3 py-1.5 bg-[#f3f5f1] border-b border-line text-xs font-semibold text-muted"><span>{title}</span></div>
      <div className="flex-1">
        {rows.map((r, i) => {
          const idx = offset + i;
          const strong = r.depth === 0 && r.line.kind !== 'stock';
          return (
            <div key={i} data-row={idx} onClick={() => onOpen(idx)}
              className={`flex px-3 py-0.5 cursor-pointer ${idx === selIndex ? 'row-sel' : 'hover:bg-sel-soft'} ${r.line.kind === 'result' ? 'font-semibold text-brand-dark' : ''} ${r.line.kind === 'diff' ? 'text-bad italic' : ''}`}>
              <span className={`flex-1 ${strong ? 'font-medium' : ''}`} style={{ paddingLeft: `${r.depth * 1.25}rem` }}>{r.line.label}</span>
              {r.depth > 0 ? <span className="num w-32 text-muted">{amt(r.line.amount, true)}</span> : <span className="w-32" />}
              <span className="num w-36">{r.depth === 0 ? amt(r.line.amount, true) : ''}</span>
            </div>
          );
        })}
      </div>
      <div className="flex px-3 py-1.5 border-t-2 border-ink/50 font-semibold"><span className="flex-1">Total</span><span className="num w-36">{amt(total, true)}</span></div>
    </div>
  );
}

function useSides(sides: Row[][], active: boolean, open: (l: Line) => void) {
  const all = sides.flat();
  const openAt = (i: number) => open(all[i].line);
  const [sel] = useListNav(all.length, active, openAt);
  const offsets = sides.map((_, i) => sides.slice(0, i).reduce((a, x) => a + x.length, 0));
  return { sel, openAt, offsets };
}

function drill(app: ReturnType<typeof useApp>) {
  return (l: Line) => {
    if (l.groupId) app.push('trialBalance', { groupId: l.groupId });
    else if (l.ledgerId) app.push('ledger', { ledgerId: l.ledgerId });
    else if (l.kind === 'stock') app.push('stockSummary');
  };
}

export function ProfitLoss({ active }: { active: boolean }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/profit-loss?from=${app.period.from}&to=${app.period.to}`));
  const [detailed, setDetailed] = useState(false);
  const sides = useMemo(() => (data
    ? [rowsOf(data.trading.dr, detailed), rowsOf(data.trading.cr, detailed), rowsOf(data.pl.dr, detailed), rowsOf(data.pl.cr, detailed)]
    : [[], [], [], []]), [data, detailed]);
  const [tDr, tCr, pDr, pCr] = sides;
  const { sel, openAt, offsets } = useSides(sides, active, drill(app));
  const left = [...tDr, ...pDr], right = [...tCr, ...pCr];
  return (
    <Report title="Profit & Loss A/c" active={active} loading={loading}
      keys={[{ key: 'alt+F1', label: detailed ? 'Condensed' : 'Detailed', run: () => setDetailed((d) => !d) }]}
      onExport={data ? () => downloadCsv('Profit and Loss', [['Particulars (Dr)', 'Amount', 'Particulars (Cr)', 'Amount'],
        ...Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [left[i]?.line.label, left[i]?.line.amount, right[i]?.line.label, right[i]?.line.amount])]) : undefined}>
      {data && (
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1">Trading account</div>
          <div className="flex gap-3 flex-col lg:flex-row mb-4">
            <Side title="Particulars (Dr)" rows={tDr} total={data.trading.total} selIndex={sel} offset={offsets[0]} onOpen={openAt} />
            <Side title="Particulars (Cr)" rows={tCr} total={data.trading.total} selIndex={sel} offset={offsets[1]} onOpen={openAt} />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand mb-1">Profit &amp; loss account</div>
          <div className="flex gap-3 flex-col lg:flex-row">
            <Side title="Expenses" rows={pDr} total={data.pl.total} selIndex={sel} offset={offsets[2]} onOpen={openAt} />
            <Side title="Income" rows={pCr} total={data.pl.total} selIndex={sel} offset={offsets[3]} onOpen={openAt} />
          </div>
          <div className="mt-3 flex gap-6 text-sm">
            <span>Gross profit: <b className="num">{amt(data.grossProfit, true)}</b></span>
            <span>Net {Number(data.netProfit) >= 0 ? 'profit' : 'loss'}: <b className={`num ${Number(data.netProfit) >= 0 ? 'text-ok' : 'text-bad'}`}>{amt(Math.abs(Number(data.netProfit)), true)}</b></span>
            <span className="text-muted">Closing stock valued at weighted average cost.</span>
          </div>
        </div>
      )}
    </Report>
  );
}

export function BalanceSheet({ active }: { active: boolean }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/balance-sheet?to=${app.period.to}`));
  const [detailed, setDetailed] = useState(false);
  const sides = useMemo(() => (data ? [rowsOf(data.liabilities, detailed), rowsOf(data.assets, detailed)] : [[], []]), [data, detailed]);
  const [left, right] = sides;
  const { sel, openAt, offsets } = useSides(sides, active, drill(app));
  return (
    <Report title="Balance Sheet" active={active} loading={loading} asOn={app.period.to}
      keys={[{ key: 'alt+F1', label: detailed ? 'Condensed' : 'Detailed', run: () => setDetailed((d) => !d) }]}
      onExport={data ? () => downloadCsv('Balance Sheet', [['Liabilities', 'Amount', 'Assets', 'Amount'],
        ...Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [left[i]?.line.label, left[i]?.line.amount, right[i]?.line.label, right[i]?.line.amount])]) : undefined}>
      {data && (
        <div className="p-4">
          <div className="flex gap-3 flex-col lg:flex-row">
            <Side title="Liabilities" rows={left} total={data.totalLiabilities} selIndex={sel} offset={offsets[0]} onOpen={openAt} />
            <Side title="Assets" rows={right} total={data.totalAssets} selIndex={sel} offset={offsets[1]} onOpen={openAt} />
          </div>
          {data.totalLiabilities !== data.totalAssets && <p className="text-bad text-sm mt-2">Sides differ — check opening balances.</p>}
        </div>
      )}
    </Report>
  );
}
