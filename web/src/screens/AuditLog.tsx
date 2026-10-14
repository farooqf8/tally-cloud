import { useApp, useFetch } from '../lib/app';
import { amt, fdate } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Empty, useListNav } from '../components/ui';

const ACTION_CLS: Record<string, string> = { create: 'text-ok', alter: 'text-dr', cancel: 'text-cr', delete: 'text-bad' };

export function AuditLog({ active }: { active: boolean }) {
  const app = useApp();
  const { data, loading } = useFetch<any[]>(app.cpath('/audit-log'));
  const rows = data ?? [];
  const [sel] = useListNav(rows.length, active, () => {});
  return (
    <Report title="Audit Trail (Edit Log)" active={active} loading={loading} period={false}>
      {data && !rows.length && <Empty>No changes recorded yet.</Empty>}
      {!!rows.length && (
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left w-48`}>When</th><th className={`${th} text-left w-24`}>Action</th><th className={`${th} text-left w-36`}>What</th>
            <th className={`${th} text-left`}>Reference</th><th className={`${th} text-left w-32`}>Voucher date</th><th className={`${th} text-right w-36`}>Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} data-row={i} className={`border-b border-line/60 ${i === sel ? 'row-sel' : ''}`}>
                <td className={td}>{new Date(r.at).toLocaleString('en-GB')}</td>
                <td className={`${td} font-medium capitalize ${ACTION_CLS[r.action] ?? ''}`}>{r.action}</td>
                <td className={`${td} capitalize`}>{r.entity.replace('-', ' ')}</td>
                <td className={td}>{r.ref}</td>
                <td className={td}>{fdate(r.voucher_date)}</td>
                <td className={`${td} num`}>{amt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="px-4 py-2 text-xs text-muted">Every create, alteration, cancellation and deletion is logged with its before and after state, as required for audit.</p>
    </Report>
  );
}
