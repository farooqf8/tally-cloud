import { useMemo, useState } from 'react';
import { useApp, useFetch } from '../lib/app';
import { amt, D, downloadCsv, qty } from '../lib/fmt';
import { Report, th, td } from '../components/Report';
import { Empty, Select, useListNav } from '../components/ui';

export function StockSummary({ active }: { active: boolean }) {
  const app = useApp();
  const [godownId, setGodownId] = useState('');
  const { data, loading } = useFetch<any>(app.cpath(`/reports/stock-summary?from=${app.period.from}&to=${app.period.to}${godownId ? `&godownId=${godownId}` : ''}`));
  const rows = useMemo(() => {
    if (!data) return [];
    const byGroup = new Map<string, any[]>();
    for (const it of data.items) {
      const g = data.groups.find((x: any) => x.id === it.stockGroupId)?.name ?? 'Primary';
      byGroup.set(g, [...(byGroup.get(g) ?? []), it]);
    }
    return [...byGroup.entries()].flatMap(([g, items]) => [
      { group: g, closingValue: items.reduce((a, i) => a.plus(D(i.closingValue)), D(0)).toFixed(2), openingValue: items.reduce((a, i) => a.plus(D(i.openingValue)), D(0)).toFixed(2), inValue: items.reduce((a, i) => a.plus(D(i.inValue)), D(0)).toFixed(2), outValue: items.reduce((a, i) => a.plus(D(i.outValue)), D(0)).toFixed(2) },
      ...items,
    ]);
  }, [data]);
  const items = rows.filter((r: any) => !r.group);
  const [sel] = useListNav(rows.length, active, () => {});
  const reorder = new Map(app.masters.stockItems.map((s) => [s.id, s]));

  return (
    <Report title="Stock Summary" active={active} loading={loading}
      toolbar={<Select className="w-48 border-b border-line" value={godownId} onChange={setGodownId}
        options={[['', 'All godowns'], ...app.masters.godowns.map((g) => [String(g.id), g.name] as [string, string])]} />}
      onExport={data ? () => downloadCsv('Stock Summary', [['Item', 'Unit', 'Opening qty', 'Opening value', 'Inward qty', 'Inward value', 'Outward qty', 'Outward value', 'Closing qty', 'Rate', 'Closing value'],
        ...items.map((i: any) => [i.name, i.unit, i.openingQty, i.openingValue, i.inQty, i.inValue, i.outQty, i.outValue, i.closingQty, i.closingRate, i.closingValue])]) : undefined}>
      {data && !items.length && <Empty>No stock items. Create them under Masters → Create → Stock Item.</Empty>}
      {!!items.length && (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={`${th} text-left`} rowSpan={2}>Particulars</th>
              <th className={`${th} text-center`} colSpan={2}>Opening Balance</th>
              <th className={`${th} text-center`} colSpan={2}>Inwards</th>
              <th className={`${th} text-center`} colSpan={2}>Outwards</th>
              <th className={`${th} text-center`} colSpan={3}>Closing Balance</th>
            </tr>
            <tr>
              {['Qty', 'Value', 'Qty', 'Value', 'Qty', 'Value', 'Qty', 'Rate', 'Value'].map((h, i) => <th key={i} className={`${th} text-right top-7`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i) => r.group ? (
              <tr key={`g${r.group}`} data-row={i} className={`border-b border-line font-semibold bg-[#f8faf6] ${i === sel ? 'row-sel' : ''}`}>
                <td className={td}>{r.group}</td><td /><td className={`${td} num`}>{amt(r.openingValue)}</td><td /><td className={`${td} num`}>{amt(r.inValue)}</td><td /><td className={`${td} num`}>{amt(r.outValue)}</td><td /><td /><td className={`${td} num`}>{amt(r.closingValue)}</td>
              </tr>
            ) : (
              <tr key={r.id} data-row={i} className={`border-b border-line/60 ${i === sel ? 'row-sel' : ''} ${D(r.closingQty).isNeg() ? 'text-bad' : ''}`}>
                <td className={td} style={{ paddingLeft: '1.75rem' }}>
                  {r.name}
                  {reorder.get(r.id)?.reorder_level != null && D(r.closingQty).lte(D(reorder.get(r.id)!.reorder_level)) && <span className="ml-2 text-[10px] uppercase bg-sel px-1">reorder</span>}
                </td>
                <td className={`${td} num`}>{qty(r.openingQty, r.unit)}</td><td className={`${td} num`}>{amt(r.openingValue)}</td>
                <td className={`${td} num`}>{qty(r.inQty, r.unit)}</td><td className={`${td} num`}>{amt(r.inValue)}</td>
                <td className={`${td} num`}>{qty(r.outQty, r.unit)}</td><td className={`${td} num`}>{amt(r.outValue)}</td>
                <td className={`${td} num`}>{qty(r.closingQty, r.unit)}</td><td className={`${td} num`}>{amt(r.closingRate)}</td><td className={`${td} num font-medium`}>{amt(r.closingValue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-ink/50 font-semibold">
            <td className={td}>Grand Total</td><td /><td className={`${td} num`}>{amt(data.totalOpening, true)}</td><td /><td /><td /><td /><td /><td /><td className={`${td} num`}>{amt(data.totalClosing, true)}</td>
          </tr></tfoot>
        </table>
      )}
      <p className="px-4 py-2 text-xs text-muted">Valuation: weighted average cost. Outward values are at selling price.</p>
    </Report>
  );
}
