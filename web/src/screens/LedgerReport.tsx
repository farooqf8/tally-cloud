import { useState } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, D, downloadCsv, drcr, fdate } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Picker } from '../components/Picker';
import { Empty, Form, useListNav } from '../components/ui';
import { groupUnder } from './Masters';

export function LedgerReport({ active, ledgerId: initial, cashBank }: { active: boolean; ledgerId?: number; cashBank?: boolean }) {
  const app = useApp();
  const [ledgerId, setLedgerId] = useState<number | null>(initial ?? null);
  const { data, loading } = useFetch<any>(ledgerId ? app.cpath(`/reports/ledger/${ledgerId}?from=${app.period.from}&to=${app.period.to}`) : null);
  const lines: any[] = data?.lines ?? [];
  const [sel] = useListNav(lines.length, active && !!ledgerId, (i) => app.push('voucher', { base: lines[i].base, id: lines[i].voucher_id }));
  const options = app.masters.ledgers
    .filter((l) => !cashBank || groupUnder(app.masters.groups, l.group_id, 'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c'))
    .map((l) => ({ id: l.id, label: l.name, sub: l.group_name ?? '', right: drcr(l.balance) }));

  return (
    <Report title={data ? `Ledger: ${data.ledger.name}` : cashBank ? 'Cash / Bank Book' : 'Ledger'} active={active} loading={loading}
      keys={[{ key: 'alt+l', label: 'Change Ledger', run: () => setLedgerId(null) }]}
      onExport={data ? () => downloadCsv(`Ledger - ${data.ledger.name}`, [['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Balance'],
        ['', 'Opening Balance', '', '', '', '', D(data.opening).toFixed(2)],
        ...lines.map((l) => [l.date, l.particulars, l.type_name, l.number, l.dr, l.cr, l.balance]),
        ['', 'Closing Balance', '', '', data.dr, data.cr, data.closing]]) : undefined}>
      {!ledgerId && (
        <div className="max-w-lg mx-auto mt-10 bg-panel border border-line p-4">
          <div className="text-sm text-muted mb-2">Name of {cashBank ? 'cash / bank account' : 'ledger'}</div>
          <Form><Picker value={null} options={options} onChange={setLedgerId} autoFocus title={cashBank ? 'List of Cash / Bank Accounts' : 'List of Ledger Accounts'} /></Form>
          <div className="h-64" />
        </div>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left w-28`}>Date</th><th className={`${th} text-left`}>Particulars</th>
            <th className={`${th} text-left w-28`}>Vch Type</th><th className={`${th} text-left w-24`}>Vch No.</th>
            <th className={`${th} text-right w-32`}>Debit</th><th className={`${th} text-right w-32`}>Credit</th><th className={`${th} text-right w-36`}>Balance</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-line/60 font-medium"><td className={td} /><td className={td}>Opening Balance</td><td /><td />
              <td className={`${td} num`}>{D(data.opening).gt(0) ? amt(data.opening) : ''}</td><td className={`${td} num`}>{D(data.opening).lt(0) ? amt(D(data.opening).abs()) : ''}</td><td className={`${td} num`}>{drcr(data.opening)}</td></tr>
            {lines.map((l, i) => (
              <tr key={l.entry_id} data-row={i} onClick={() => app.push('voucher', { base: l.base, id: l.voucher_id })}
                className={`cursor-pointer border-b border-line/60 ${i === sel ? 'row-sel' : 'hover:bg-sel-soft'}`}>
                <td className={td}>{fdate(l.date)}</td>
                <td className={td}>{l.particulars}{l.narration && <div className="text-xs text-muted truncate max-w-md">{l.narration}</div>}</td>
                <td className={td}>{l.type_name}</td><td className={td}>{l.number}</td>
                <td className={`${td} num`}>{amt(l.dr)}</td><td className={`${td} num`}>{amt(l.cr)}</td><td className={`${td} num`}>{drcr(l.balance)}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={7}><Empty>No transactions in this period.</Empty></td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink/40"><td /><td className={`${td} text-muted`}>Current total</td><td /><td />
              <td className={`${td} num font-semibold`}>{amt(data.dr, true)}</td><td className={`${td} num font-semibold`}>{amt(data.cr, true)}</td><td /></tr>
            <tr className="border-t-2 border-ink/40 font-semibold"><td /><td className={td}>Closing Balance</td><td /><td /><td /><td />
              <td className={`${td} num`}>{drcr(data.closing) || '0.00'}</td></tr>
          </tfoot>
        </table>
      )}
    </Report>
  );
}

