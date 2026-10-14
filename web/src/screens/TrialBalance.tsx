import { useMemo, useState } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, D, downloadCsv, drcr } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Empty, useListNav } from '../components/ui';

interface Node { key: string; kind: string; id?: number; name: string; opening: string; dr: string; cr: string; closing: string; children?: Node[] }
interface Flat extends Node { depth: number; open: boolean }

function findGroup(nodes: Node[], id: number): Node | null {
  for (const n of nodes) {
    if (n.kind === 'group' && n.id === id) return n;
    const f = n.children && findGroup(n.children, id);
    if (f) return f;
  }
  return null;
}

/** Trial Balance; with groupId it is that group's Group Summary. */
export function TrialBalance({ active, groupId }: { active: boolean; groupId?: number }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/trial-balance?from=${app.period.from}&to=${app.period.to}`));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailed, setDetailed] = useState(!!groupId);
  const [showTxn, setShowTxn] = useState(false);

  const roots: Node[] = useMemo(() => {
    if (!data) return [];
    if (groupId) return findGroup(data.rows, groupId)?.children ?? [];
    return data.rows;
  }, [data, groupId]);
  const title = groupId ? `Group Summary: ${data ? findGroup(data.rows, groupId)?.name ?? '' : ''}` : 'Trial Balance';

  const flat = useMemo(() => {
    const out: Flat[] = [];
    const walk = (nodes: Node[], depth: number) => nodes.forEach((n) => {
      const isOpen = detailed || expanded.has(n.key);
      out.push({ ...n, depth, open: isOpen });
      if (n.children && isOpen) walk(n.children, depth + 1);
    });
    walk(roots, 0);
    return out;
  }, [roots, expanded, detailed]);

  const openRow = (i: number) => {
    const r = flat[i];
    if (r.kind === 'ledger' || r.kind === 'pl') app.push('ledger', { ledgerId: r.id });
    else if (r.kind === 'group') {
      if (detailed) app.push('trialBalance', { groupId: r.id });
      else setExpanded((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; });
    }
  };
  const [sel] = useListNav(flat.length, active, openRow);

  const side = (v: string, s: 1 | -1) => { const d = D(v).times(s); return d.gt(0) ? amt(d) : ''; };
  const totals = useMemo(() => {
    const sum = (f: 'opening' | 'closing', s: 1 | -1) => roots.reduce((a, r) => { const d = D(r[f]).times(s); return d.gt(0) ? a.plus(d) : a; }, D(0));
    return { odr: sum('opening', 1), ocr: sum('opening', -1), dr: roots.reduce((a, r) => a.plus(D(r.dr)), D(0)), cr: roots.reduce((a, r) => a.plus(D(r.cr)), D(0)), cdr: sum('closing', 1), ccr: sum('closing', -1) };
  }, [roots]);

  return (
    <Report title={title} active={active} loading={loading}
      keys={[
        { key: 'alt+F1', label: detailed ? 'Condensed' : 'Detailed', run: () => setDetailed((d) => !d) },
        { key: 'alt+t', label: showTxn ? 'Hide Transactions' : 'Show Opening & Txns', run: () => setShowTxn((x) => !x) },
      ]}
      onExport={() => downloadCsv(title, [['Particulars', 'Opening', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'],
        ...flat.map((r) => [`${'  '.repeat(r.depth)}${r.name}`, drcr(r.opening), r.dr, r.cr, D(r.closing).gt(0) ? r.closing : '', D(r.closing).lt(0) ? D(r.closing).abs().toFixed(2) : ''])])}>
      {!loading && !flat.length && <Empty>No balances.</Empty>}
      {!!flat.length && (
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left`}>Particulars</th>
            {showTxn && <><th className={`${th} text-right w-36`}>Opening</th><th className={`${th} text-right w-32`}>Debit</th><th className={`${th} text-right w-32`}>Credit</th></>}
            <th className={`${th} text-right w-36`}>Closing Debit</th><th className={`${th} text-right w-36`}>Closing Credit</th>
          </tr></thead>
          <tbody>
            {flat.map((r, i) => (
              <tr key={r.key} data-row={i} onClick={() => openRow(i)}
                className={`cursor-pointer border-b border-line/60 ${i === sel ? 'row-sel' : 'hover:bg-sel-soft'}`}>
                <td className={td} style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}>
                  <span className={r.kind === 'group' ? (r.depth ? 'font-medium' : 'font-semibold') : r.kind === 'diff' ? 'text-bad italic' : 'italic'}>
                    {r.kind === 'group' && !detailed && <span className="inline-block w-4 text-muted">{r.open ? '−' : '+'}</span>}{r.name}
                  </span>
                </td>
                {showTxn && <><td className={`${td} num`}>{drcr(r.opening)}</td><td className={`${td} num`}>{amt(r.dr)}</td><td className={`${td} num`}>{amt(r.cr)}</td></>}
                <td className={`${td} num`}>{side(r.closing, 1)}</td>
                <td className={`${td} num`}>{side(r.closing, -1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-ink/50 font-semibold">
            <td className={td}>Grand Total</td>
            {showTxn && <><td className={`${td} num text-xs`}>{amt(totals.odr, true)} / {amt(totals.ocr, true)}</td><td className={`${td} num`}>{amt(totals.dr, true)}</td><td className={`${td} num`}>{amt(totals.cr, true)}</td></>}
            <td className={`${td} num`}>{amt(totals.cdr, true)}</td><td className={`${td} num`}>{amt(totals.ccr, true)}</td>
          </tr></tfoot>
        </table>
      )}
    </Report>
  );
}
