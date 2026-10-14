import { useState } from 'react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/app';
import { amt, drcr, fdate } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Picker } from '../components/Picker';
import { DateInput, Empty, Form } from '../components/ui';
import { groupUnder } from './Masters';

export function Brs({ active, ledgerId: initial }: { active: boolean; ledgerId?: number }) {
  const app = useApp();
  const [ledgerId, setLedgerId] = useState<number | null>(initial ?? null);
  const { data, loading } = useFetch<any>(ledgerId ? app.cpath(`/reports/brs/${ledgerId}?from=${app.period.from}&to=${app.period.to}`) : null);
  const banks = app.masters.ledgers.filter((l) => groupUnder(app.masters.groups, l.group_id, 'Bank Accounts', 'Bank OD A/c'))
    .map((l) => ({ id: l.id, label: l.name, right: drcr(l.balance) }));
  const setBankDate = async (entryId: number, d: string | null) => {
    try { await api(app.cpath(`/entries/${entryId}/bank-date`), { method: 'PUT', body: { bankDate: d } }); app.bump(); }
    catch (e: any) { app.toast(e.message, 'bad'); }
  };

  return (
    <Report title={data ? `Bank Reconciliation: ${data.ledger.name}` : 'Bank Reconciliation'} active={active} loading={loading}
      keys={[{ key: 'alt+l', label: 'Change Bank', run: () => setLedgerId(null) }]}>
      {!ledgerId && (
        <div className="max-w-lg mx-auto mt-10 bg-panel border border-line p-4">
          <div className="text-sm text-muted mb-2">Select bank account</div>
          {banks.length ? <Form><Picker value={null} options={banks} onChange={setLedgerId} autoFocus title="List of Bank Accounts" /></Form>
            : <p className="text-sm">No bank ledgers yet. Create one under the Bank Accounts group.</p>}
          <div className="h-56" />
        </div>
      )}
      {data && (
        <Form>
          <p className="px-4 pt-3 text-xs text-muted">Type the date each entry appears on the bank statement (e.g. 12-3). Leave blank if it has not cleared.</p>
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left w-28`}>Date</th><th className={`${th} text-left`}>Particulars</th><th className={`${th} text-left w-24`}>Vch Type</th>
              <th className={`${th} text-left w-20`}>No.</th><th className={`${th} text-right w-32`}>Debit</th><th className={`${th} text-right w-32`}>Credit</th><th className={`${th} text-left w-36`}>Bank date</th>
            </tr></thead>
            <tbody>
              {data.lines.map((l: any) => (
                <tr key={l.entry_id} className={`border-b border-line/60 ${l.bank_date ? '' : 'bg-sel-soft/40'}`}>
                  <td className={td}>{fdate(l.date)}</td><td className={td}>{l.particulars}</td><td className={td}>{l.type_name}</td><td className={td}>{l.number}</td>
                  <td className={`${td} num`}>{amt(l.dr)}</td><td className={`${td} num`}>{amt(l.cr)}</td>
                  <td className="px-1"><DateInput value={l.bank_date} allowEmpty refDate={l.date} onChange={(d) => d !== l.bank_date && setBankDate(l.entry_id, d)} /></td>
                </tr>
              ))}
              {!data.lines.length && <tr><td colSpan={7}><Empty>No bank entries in this period.</Empty></td></tr>}
            </tbody>
          </table>
          <div className="flex justify-end p-4">
            <table className="text-sm min-w-96 bg-panel border border-line">
              <tbody>
                <tr className="border-b border-line/60"><td className={td}>Balance as per company books</td><td className={`${td} num`}>{drcr(data.balanceAsPerBooks) || '0.00'}</td></tr>
                <tr className="border-b border-line/60"><td className={td}>Amounts not reflected in bank ({data.unreconciledCount})</td><td className={`${td} num`}>{drcr(data.notReflectedInBank) || '0.00'}</td></tr>
                <tr className="font-semibold"><td className={td}>Balance as per bank</td><td className={`${td} num`}>{drcr(data.balanceAsPerBank) || '0.00'}</td></tr>
              </tbody>
            </table>
          </div>
        </Form>
      )}
    </Report>
  );
}
