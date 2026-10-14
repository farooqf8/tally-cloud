import { useMemo, useState } from 'react';
import { useApp, useFetch, BASE_LABEL } from '../lib/app';
import { amt, D, downloadCsv, fdate } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Empty, useListNav } from '../components/ui';

const TITLES: Record<string, string> = { sales: 'Sales Register', purchase: 'Purchase Register', journal: 'Journal Register', payment: 'Payment Register', receipt: 'Receipt Register' };

export function DayBook({ active, base }: { active: boolean; base?: string }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const { data, loading } = useFetch<any[]>(app.cpath(`/vouchers?from=${app.period.from}&to=${app.period.to}${base ? `&base=${base}` : ''}`));
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = data ?? [];
    return s ? all.filter((r) => `${r.particulars} ${r.number} ${r.type_name} ${r.narration ?? ''}`.toLowerCase().includes(s)) : all;
  }, [data, q]);
  const [sel] = useListNav(rows.length, active, (i) => app.push('voucher', { base: rows[i].base, id: rows[i].id }));
  const total = rows.filter((r) => r.status === 'posted' && !r.is_optional).reduce((a, r) => a.plus(D(r.total_amount)), D(0));
  const title = base ? TITLES[base] ?? `${BASE_LABEL[base]} Register` : 'Day Book';

  return (
    <Report title={title} active={active} loading={loading}
      toolbar={<input className="tin w-56 border-b border-line" placeholder="Filter by party, number, narration…" value={q} onChange={(e) => setQ(e.target.value)} />}
      onExport={() => downloadCsv(title, [['Date', 'Particulars', 'Voucher type', 'Number', 'Amount', 'Status', 'Narration'],
        ...rows.map((r) => [r.date, r.particulars, r.type_name, r.number, D(r.total_amount).toFixed(2), r.is_optional ? 'optional' : r.status, r.narration])])}>
      {!loading && !rows.length && <Empty>No vouchers in this period. Press F2 to change the period.</Empty>}
      {!!rows.length && (
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left w-28`}>Date</th><th className={`${th} text-left`}>Particulars</th>
            <th className={`${th} text-left w-32`}>Vch Type</th><th className={`${th} text-left w-28`}>Vch No.</th>
            <th className={`${th} text-right w-36`}>Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} data-row={i} onClick={() => app.push('voucher', { base: r.base, id: r.id })}
                className={`cursor-pointer border-b border-line/60 ${i === sel ? 'row-sel' : 'hover:bg-sel-soft'} ${r.status === 'cancelled' ? 'text-muted line-through' : ''}`}>
                <td className={td}>{fdate(r.date)}</td>
                <td className={td}>
                  {r.status === 'cancelled' ? '(cancelled)' : r.particulars}
                  {r.is_optional && <span className="ml-2 text-[10px] uppercase bg-sel px-1">optional</span>}
                  {r.narration && <div className="text-xs text-muted truncate max-w-xl">{r.narration}</div>}
                </td>
                <td className={td}>{r.type_name}</td>
                <td className={td}>{r.number}</td>
                <td className={`${td} num`}>{amt(r.total_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-ink/40 font-semibold"><td className={td} colSpan={4}>Total ({rows.length} vouchers)</td><td className={`${td} num`}>{amt(total, true)}</td></tr></tfoot>
        </table>
      )}
    </Report>
  );
}
