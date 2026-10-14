import { useMemo } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, D, downloadCsv, fdate } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Empty, useListNav } from '../components/ui';

export function Outstanding({ active, kind }: { active: boolean; kind: 'receivable' | 'payable' }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/outstanding?kind=${kind}&to=${app.period.to}`));
  const rows = useMemo(() => (data?.parties ?? []).flatMap((p: any) => [
    { party: p },
    ...p.bills.map((b: any) => ({ bill: b, ledgerId: p.ledgerId })),
    ...(D(p.onAccount).isZero() ? [] : [{ onAccount: p.onAccount, ledgerId: p.ledgerId }]),
  ]), [data]);
  const [sel] = useListNav(rows.length, active, (i) => { const r = rows[i]; app.push('ledger', { ledgerId: r.party?.ledgerId ?? r.ledgerId }); });
  const title = kind === 'receivable' ? 'Bills Receivable' : 'Bills Payable';
  const a = data?.ageing;

  return (
    <Report title={title} active={active} loading={loading} asOn={app.period.to}
      keys={[{ key: 'alt+r', label: kind === 'receivable' ? 'Payables' : 'Receivables', run: () => app.replace('outstanding', { kind: kind === 'receivable' ? 'payable' : 'receivable' }) }]}
      onExport={data ? () => downloadCsv(title, [['Party', 'Bill', 'Date', 'Due', 'Amount', 'Overdue days'],
        ...data.parties.flatMap((p: any) => [...p.bills.map((b: any) => [p.name, b.name, b.date, b.dueDate, b.amount, b.overdueDays]), ...(D(p.onAccount).isZero() ? [] : [[p.name, 'On Account', '', '', p.onAccount, '']])])]) : undefined}>
      {a && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-line border-b border-line text-sm">
          {[['Total', data.total], ['0–30 days', a.d0_30], ['31–60 days', a.d31_60], ['61–90 days', a.d61_90], ['Over 90 days', a.d90plus], ['On account', a.onAccount]].map(([k, v]) => (
            <div key={k} className="bg-panel px-3 py-2"><div className="text-xs text-muted">{k}</div><div className="num text-left font-semibold">{amt(v, true)}</div></div>
          ))}
        </div>
      )}
      {data && !rows.length && <Empty>No outstanding {kind === 'receivable' ? 'receivables' : 'payables'}.</Empty>}
      {!!rows.length && (
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left w-32`}>Date</th><th className={`${th} text-left`}>Ref. No.</th>
            <th className={`${th} text-left w-32`}>Due on</th><th className={`${th} text-right w-28`}>Overdue by</th><th className={`${th} text-right w-36`}>Pending amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => r.party ? (
              <tr key={`p${r.party.ledgerId}`} data-row={i} className={`cursor-pointer border-b border-line font-semibold bg-[#f8faf6] ${i === sel ? 'row-sel' : ''}`}>
                <td className={td} colSpan={4}>{r.party.name}</td><td className={`${td} num`}>{amt(r.party.balance, true)}</td>
              </tr>
            ) : r.bill ? (
              <tr key={`b${r.ledgerId}${r.bill.name}`} data-row={i} className={`border-b border-line/60 ${i === sel ? 'row-sel' : ''}`}>
                <td className={td} style={{ paddingLeft: '1.75rem' }}>{fdate(r.bill.date)}</td><td className={td}>{r.bill.name}</td><td className={td}>{fdate(r.bill.dueDate)}</td>
                <td className={`${td} num ${r.bill.overdueDays ? 'text-bad' : ''}`}>{r.bill.overdueDays ? `${r.bill.overdueDays} days` : ''}</td><td className={`${td} num`}>{amt(r.bill.amount, true)}</td>
              </tr>
            ) : (
              <tr key={`o${r.ledgerId}`} data-row={i} className={`border-b border-line/60 text-muted ${i === sel ? 'row-sel' : ''}`}>
                <td className={td} style={{ paddingLeft: '1.75rem' }} colSpan={4}>On account / opening</td><td className={`${td} num`}>{amt(r.onAccount, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Report>
  );
}
