import { useApp, useFetch } from '../lib/app';
import { amt, D, downloadCsv } from '../lib/fmt';
import { Report, th, td } from '../components/Report';

interface Box { no: string; label: string; amount: string; vat: string; adjustment?: string }

export function Vat201({ active }: { active: boolean }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/vat-201?from=${app.period.from}&to=${app.period.to}`));
  const BoxRow = ({ b, strong }: { b: Box; strong?: boolean }) => (
    <tr className={`border-b border-line/60 ${strong ? 'font-semibold bg-[#f8faf6]' : ''} ${!strong && D(b.amount).isZero() && D(b.vat).isZero() ? 'text-muted' : ''}`}>
      <td className={`${td} w-14`}>{b.no}</td><td className={td}>{b.label}</td>
      <td className={`${td} num w-40`}>{amt(b.amount, true)}</td><td className={`${td} num w-40`}>{amt(b.vat, true)}</td>
      <td className={`${td} num w-32`}>{amt(b.adjustment ?? '0', true)}</td>
    </tr>
  );
  const payable = data ? D(data.net.box14) : D(0);
  return (
    <Report title="VAT Return — Form VAT 201" active={active} loading={loading}
      onExport={data ? () => downloadCsv('VAT 201', [['Box', 'Description', 'Amount (AED)', 'VAT amount (AED)', 'Adjustment (AED)'],
        ...[...data.outputs, data.totalOutputs, ...data.inputs, data.totalInputs].map((b: Box) => [b.no, b.label, b.amount, b.vat, b.adjustment ?? '0.00']),
        ['12', 'Total value of due tax for the period', '', data.net.box12, ''], ['13', 'Total value of recoverable tax for the period', '', data.net.box13, ''],
        ['14', 'Payable tax for the period', '', data.net.box14, '']]) : undefined}>
      {data && (
        <div className="p-4 max-w-5xl">
          <div className="text-sm mb-3">TRN: <b>{data.trn ?? <span className="text-bad">not set — add it under Company Features (Alt+K)</span>}</b> · Taxable person: {data.company}</div>
          <table className="w-full text-sm bg-panel border border-line mb-4">
            <thead><tr><th className={`${th} text-left`} colSpan={2}>VAT on Sales and all other Outputs</th><th className={`${th} text-right`}>Amount (AED)</th><th className={`${th} text-right`}>VAT Amount (AED)</th><th className={`${th} text-right`}>Adjustment (AED)</th></tr></thead>
            <tbody>
              {data.outputs.map((b: Box) => <BoxRow key={b.no} b={b} />)}
              <BoxRow b={data.totalOutputs} strong />
            </tbody>
          </table>
          <table className="w-full text-sm bg-panel border border-line mb-4">
            <thead><tr><th className={`${th} text-left`} colSpan={2}>VAT on Expenses and all other Inputs</th><th className={`${th} text-right`}>Amount (AED)</th><th className={`${th} text-right`}>Recoverable VAT (AED)</th><th className={`${th} text-right`}>Adjustment (AED)</th></tr></thead>
            <tbody>
              {data.inputs.map((b: Box) => <BoxRow key={b.no} b={b} />)}
              <BoxRow b={data.totalInputs} strong />
            </tbody>
          </table>
          <table className="w-full text-sm bg-panel border border-line">
            <thead><tr><th className={`${th} text-left`} colSpan={2}>Net VAT Due</th><th className={`${th} text-right`}>AED</th></tr></thead>
            <tbody>
              <tr className="border-b border-line/60"><td className={`${td} w-14`}>12</td><td className={td}>Total value of due tax for the period</td><td className={`${td} num w-40`}>{amt(data.net.box12, true)}</td></tr>
              <tr className="border-b border-line/60"><td className={td}>13</td><td className={td}>Total value of recoverable tax for the period</td><td className={`${td} num`}>{amt(data.net.box13, true)}</td></tr>
              <tr className="font-semibold"><td className={td}>14</td><td className={td}>{payable.gte(0) ? 'Payable tax for the period' : 'Refundable tax for the period'}</td>
                <td className={`${td} num ${payable.gte(0) ? 'text-bad' : 'text-ok'}`}>{amt(payable.abs(), true)}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-muted mt-3">
            Box 1 is split by the emirate of supply (the voucher's place of supply, else the customer's emirate, else yours). Credit and debit notes reduce the boxes of the original supply.
            Box 2 (tourist refunds) and Box 7 (import adjustments) are not tracked yet and show zero; enter them on the FTA portal if they apply.
          </p>
        </div>
      )}
    </Report>
  );
}
