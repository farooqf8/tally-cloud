import { useApp, useFetch } from '../lib/app';
import { amt } from '../lib/fmt';
import { Report, th, td } from '../components/Report';

const PRINCIPAL: [string, string][] = [
  ['workingCapital', 'Working Capital (Current Assets − Current Liabilities)'], ['cashBankBalance', 'Cash-in-Hand + Bank Accounts'],
  ['sundryDebtors', 'Sundry Debtors (receivables)'], ['sundryCreditors', 'Sundry Creditors (payables)'],
  ['sales', 'Sales Accounts'], ['purchases', 'Purchase Accounts'], ['stockInHand', 'Stock-in-Hand'],
  ['grossProfit', 'Gross Profit'], ['netProfit', 'Net Profit'], ['capitalAndReserves', 'Capital + Reserves + P&L'], ['loans', 'Loans (Liability)'],
];
const RATIOS: [string, string, string][] = [
  ['currentRatio', 'Current Ratio', ': 1'], ['quickRatio', 'Quick Ratio', ': 1'], ['debtEquity', 'Debt / Equity', ': 1'],
  ['grossProfitPct', 'Gross Profit %', '%'], ['netProfitPct', 'Net Profit %', '%'],
  ['receivableDays', 'Receivable Turnover in Days', ' days'], ['returnOnInvestmentPct', 'Return on Investment %', '%'],
];

export function Ratios({ active }: { active: boolean }) {
  const app = useApp();
  const { data, loading } = useFetch<any>(app.cpath(`/reports/ratios?from=${app.period.from}&to=${app.period.to}`));
  return (
    <Report title="Ratio Analysis" active={active} loading={loading}>
      {data && (
        <div className="p-4 flex gap-4 flex-col lg:flex-row">
          <table className="flex-1 text-sm bg-panel border border-line">
            <thead><tr><th className={`${th} text-left`}>Principal Groups</th><th className={`${th} text-right`}>AED</th></tr></thead>
            <tbody>{PRINCIPAL.map(([k, l]) => <tr key={k} className="border-b border-line/60"><td className={td}>{l}</td><td className={`${td} num`}>{amt(data.principal[k], true)}</td></tr>)}</tbody>
          </table>
          <table className="flex-1 text-sm bg-panel border border-line self-start">
            <thead><tr><th className={`${th} text-left`}>Principal Ratios</th><th className={`${th} text-right`}>Value</th></tr></thead>
            <tbody>{RATIOS.map(([k, l, unit]) => <tr key={k} className="border-b border-line/60"><td className={td}>{l}</td><td className={`${td} num`}>{data.ratios[k] == null ? '—' : `${data.ratios[k]}${unit}`}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Report>
  );
}
