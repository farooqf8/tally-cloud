import { useMemo, useState } from 'react';
import { useApp } from '../lib/app';
import { drcr } from '../lib/fmt';
import { useKeys } from '../lib/keys';
import { ScreenTitle, useListNav } from '../components/ui';

interface Row { kind: 'group' | 'ledger'; id: number; name: string; depth: number; right?: string; reserved?: boolean }

export function ChartOfAccounts({ active }: { active: boolean }) {
  const app = useApp();
  const { groups, ledgers } = app.masters;
  const [showLedgers, setShowLedgers] = useState(true);
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (parentId: number | null, depth: number) => {
      groups.filter((g) => g.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).forEach((g) => {
        out.push({ kind: 'group', id: g.id, name: g.name, depth, reserved: g.isReserved });
        walk(g.id, depth + 1);
        if (showLedgers) ledgers.filter((l) => l.group_id === g.id).forEach((l) => out.push({ kind: 'ledger', id: l.id, name: l.name, depth: depth + 1, right: drcr(l.balance) }));
      });
    };
    walk(null, 0);
    const pl = ledgers.find((l) => l.reserved_key === 'pl');
    if (pl) out.push({ kind: 'ledger', id: pl.id, name: pl.name, depth: 0, right: drcr(pl.balance) });
    return out;
  }, [groups, ledgers, showLedgers]);
  const open = (i: number) => app.push('masterForm', { kind: rows[i].kind === 'group' ? 'groups' : 'ledgers', id: rows[i].id });
  const [sel] = useListNav(rows.length, active, open);
  useKeys([
    { key: 'alt+l', label: showLedgers ? 'Hide Ledgers' : 'Show Ledgers', run: () => setShowLedgers((s) => !s) },
    { key: 'alt+c', label: 'Create Ledger', run: () => app.push('masterForm', { kind: 'ledgers' }) },
    { key: 'Escape', label: 'Back', run: () => app.pop() },
  ], active);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenTitle title="Chart of Accounts" sub={`${groups.length} groups · ${ledgers.length} ledgers`} right="Enter to alter" />
      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.kind}${r.id}`} data-row={i} onClick={() => open(i)}
                className={`cursor-pointer border-b border-line/60 ${i === sel ? 'row-sel' : 'hover:bg-sel-soft'}`}>
                <td className="py-0.5" style={{ paddingLeft: `${1 + r.depth * 1.5}rem` }}>
                  <span className={r.kind === 'group' ? (r.depth === 0 ? 'font-semibold' : 'font-medium') : 'italic'}>{r.name}</span>
                  {r.reserved && r.depth > 0 && <span className="ml-2 text-[10px] uppercase text-muted">predefined</span>}
                </td>
                <td className="num px-4">{r.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
