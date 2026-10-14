import { useMemo } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, emirateName, fdate } from '../lib/fmt';
import { useKeys } from '../lib/keys';
import { Menu, type MenuSection } from '../components/Menu';
import { ScreenTitle } from '../components/ui';

export function Gateway({ active }: { active: boolean }) {
  const app = useApp();
  const c = app.company!;
  const { data: dash } = useFetch<any>(app.cpath(`/reports/dashboard?from=${app.period.from}&to=${app.period.to}`));
  const go = (type: string, props: Record<string, any> = {}) => () => app.push(type, props);
  const sections = useMemo<MenuSection[]>(() => [
    { title: 'Masters', items: [
      { label: 'Create', hotkey: 'C', run: go('mastersMenu', { mode: 'create' }) },
      { label: 'Alter', hotkey: 'A', run: go('mastersMenu', { mode: 'alter' }) },
      { label: 'Chart of Accounts', hotkey: 'H', run: go('chart') },
    ] },
    { title: 'Transactions', items: [
      { label: 'Vouchers', hotkey: 'V', run: go('voucher', { base: 'sales' }), hint: 'F4–F9' },
      { label: 'Day Book', hotkey: 'K', run: go('daybook') },
    ] },
    { title: 'Utilities', items: [
      { label: 'Banking', hotkey: 'N', run: go('banking') },
    ] },
    { title: 'Reports', items: [
      { label: 'Balance Sheet', hotkey: 'B', run: go('balanceSheet') },
      { label: 'Profit & Loss A/c', hotkey: 'P', run: go('profitLoss') },
      { label: 'Stock Summary', hotkey: 'S', run: go('stockSummary') },
      { label: 'Ratio Analysis', hotkey: 'R', run: go('ratios') },
      { label: 'VAT Return (VAT 201)', hotkey: 'T', run: go('vat201') },
      { label: 'Display More Reports', hotkey: 'D', run: go('displayMore') },
    ] },
    { title: '', items: [{ label: 'Quit', hotkey: 'Q', run: () => app.openCompany(null) }] },
  ], [app]);
  useKeys([
    { key: 'alt+k', label: 'Company Features', run: () => app.push('companyForm', { alter: true }) },
  ], active);

  const figures: [string, string | undefined, string?][] = dash ? [
    ['Cash-in-Hand', dash.cashInHand], ['Bank Accounts', dash.bank],
    ['Receivables', dash.receivables], ['Payables', dash.payables],
    ['Sales (period)', dash.sales], ['Closing Stock', dash.closingStock],
    ['Net Profit / (Loss)', dash.netProfit, Number(dash.netProfit) < 0 ? 'text-bad' : 'text-ok'],
  ] : [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenTitle title="Gateway of Tally" />
      <div className="flex-1 flex gap-6 p-6 overflow-auto items-start flex-wrap">
        <div className="flex-1 min-w-72 max-w-xl space-y-4">
          <div className="bg-panel border border-line">
            <div className="grid grid-cols-2 border-b border-line">
              <div className="p-3 border-r border-line">
                <div className="text-xs text-muted">Current Period</div>
                <div className="font-semibold">{fdate(app.period.from)} to {fdate(app.period.to)}</div>
              </div>
              <div className="p-3">
                <div className="text-xs text-muted">Current Date</div>
                <div className="font-semibold">{fdate(app.date)}</div>
              </div>
            </div>
            <div className="p-3">
              <div className="text-xs text-muted">Name of Company</div>
              <div className="font-semibold text-brand-dark">{c.name}</div>
              <div className="text-xs text-muted mt-1">
                {emirateName(c.emirate)} · {c.vatRegistered ? `VAT registered${c.trn ? `, TRN ${c.trn}` : ''}` : 'Not VAT registered'} · Books from {fdate(c.booksFrom)}
              </div>
            </div>
          </div>
          <div className="bg-panel border border-line">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand px-3 pt-2">Key figures</div>
            <table className="w-full text-sm">
              <tbody>
                {figures.map(([k, v, cls]) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">{k}</td>
                    <td className={`num px-3 py-1.5 ${cls ?? ''}`}>{amt(v, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Menu title="Gateway of Tally" sections={sections} active={active} />
      </div>
    </div>
  );
}

const MASTER_KINDS: [string, string, string][] = [
  ['groups', 'Group', 'G'], ['ledgers', 'Ledger', 'L'], ['voucher-types', 'Voucher Type', 'V'],
  ['stock-groups', 'Stock Group', 'R'], ['stock-items', 'Stock Item', 'I'], ['units', 'Unit', 'U'], ['godowns', 'Godown / Location', 'O'],
];
export const MASTER_LABEL = Object.fromEntries(MASTER_KINDS.map(([k, l]) => [k, l]));

export function MastersMenu({ active, mode }: { active: boolean; mode: 'create' | 'alter' }) {
  const app = useApp();
  const sections: MenuSection[] = [
    { title: 'Accounting Masters', items: MASTER_KINDS.slice(0, 3).map(([k, l, h]) => ({ label: l, hotkey: h, run: () => app.push(mode === 'create' ? 'masterForm' : 'masterList', { kind: k }) })) },
    { title: 'Inventory Masters', items: MASTER_KINDS.slice(3).map(([k, l, h]) => ({ label: l, hotkey: h, run: () => app.push(mode === 'create' ? 'masterForm' : 'masterList', { kind: k }) })) },
  ];
  useKeys([{ key: 'Escape', label: 'Back', run: () => app.pop() }], active);
  return (
    <div className="flex-1 flex flex-col">
      <ScreenTitle title={mode === 'create' ? 'Master Creation' : 'Master Alteration'} />
      <div className="flex-1 flex justify-center pt-10"><Menu title={mode === 'create' ? 'Create' : 'Alter'} sections={sections} active={active} /></div>
    </div>
  );
}

export function DisplayMore({ active }: { active: boolean }) {
  const app = useApp();
  const go = (type: string, props: Record<string, any> = {}) => () => app.push(type, props);
  const sections: MenuSection[] = [
    { title: 'Accounting', items: [
      { label: 'Trial Balance', hotkey: 'T', run: go('trialBalance') },
      { label: 'Day Book', hotkey: 'D', run: go('daybook') },
      { label: 'Ledger', hotkey: 'L', run: go('ledger') },
      { label: 'Cash / Bank Book', hotkey: 'C', run: go('ledger', { cashBank: true }) },
      { label: 'Sales Register', hotkey: 'S', run: go('daybook', { base: 'sales' }) },
      { label: 'Purchase Register', hotkey: 'P', run: go('daybook', { base: 'purchase' }) },
    ] },
    { title: 'Statements of Accounts', items: [
      { label: 'Receivables', hotkey: 'R', run: go('outstanding', { kind: 'receivable' }) },
      { label: 'Payables', hotkey: 'Y', run: go('outstanding', { kind: 'payable' }) },
    ] },
    { title: 'Inventory', items: [{ label: 'Stock Summary', hotkey: 'K', run: go('stockSummary') }] },
    { title: 'Statutory', items: [{ label: 'VAT Return (Form VAT 201)', hotkey: 'V', run: go('vat201') }] },
    { title: 'Exception', items: [{ label: 'Audit Trail (Edit Log)', hotkey: 'A', run: go('auditLog') }] },
  ];
  useKeys([{ key: 'Escape', label: 'Back', run: () => app.pop() }], active);
  return (
    <div className="flex-1 flex flex-col">
      <ScreenTitle title="Display More Reports" />
      <div className="flex-1 flex justify-center pt-8 overflow-auto"><Menu title="Display More Reports" sections={sections} active={active} /></div>
    </div>
  );
}

export function BankingMenu({ active }: { active: boolean }) {
  const app = useApp();
  const sections: MenuSection[] = [
    { title: 'Banking', items: [
      { label: 'Bank Reconciliation', hotkey: 'R', run: () => app.push('brs') },
      { label: 'Bank Book', hotkey: 'B', run: () => app.push('ledger', { cashBank: true }) },
    ] },
  ];
  useKeys([{ key: 'Escape', label: 'Back', run: () => app.pop() }], active);
  return (
    <div className="flex-1 flex flex-col">
      <ScreenTitle title="Banking" />
      <div className="flex-1 flex justify-center pt-10"><Menu title="Banking" sections={sections} active={active} /></div>
    </div>
  );
}
