// Printable UAE tax invoice / credit note with the particulars the FTA requires:
// "Tax Invoice" heading, supplier and recipient TRN, number, date, line VAT and totals in AED.
import { useApp, useFetch } from '../lib/app';
import { amt, D, emirateName, fdate, vatLabel } from '../lib/fmt';
import { useKeys } from '../lib/keys';

const HEADINGS: Record<string, string> = { sales: 'Tax Invoice', credit_note: 'Tax Credit Note', purchase: 'Purchase Invoice (record)', debit_note: 'Debit Note' };

export function InvoicePrint({ active, id }: { active: boolean; id: number }) {
  const app = useApp();
  const c = app.company!;
  const { data: v } = useFetch<any>(app.cpath(`/vouchers/${id}`));
  useKeys([
    { key: 'ctrl+p', label: 'Print', run: () => window.print() },
    { key: 'Escape', label: 'Back', run: () => app.pop() },
  ], active);
  if (!v) return <div className="p-6 text-muted">Loading…</div>;

  const lines: any[] = v.payload?.lines ?? [];
  const items = new Map(app.masters.stockItems.map((s) => [s.id, s]));
  const ledgers = new Map(app.masters.ledgers.map((l) => [l.id, l]));
  const rows = lines.map((l) => {
    const taxable = l.stockItemId
      ? D(l.qty).times(D(l.rate)).times(D(100).minus(D(l.discountPct))).div(100).toDecimalPlaces(2)
      : D(l.amount).toDecimalPlaces(2);
    const rate = ['standard', 'reverse_charge', 'import_goods'].includes(l.vatCategory) ? D(l.vatRate ?? 0) : D(0);
    const vat = l.vatCategory === 'standard' ? taxable.times(rate).div(100).toDecimalPlaces(2) : D(0);
    const item = l.stockItemId ? items.get(l.stockItemId) : null;
    return {
      desc: item?.name ?? ledgers.get(l.ledgerId)?.name ?? '', qty: l.stockItemId ? `${D(l.qty).toString()} ${item?.unit ?? ''}` : '',
      rate: l.stockItemId ? l.rate : '', disc: l.discountPct && D(l.discountPct).gt(0) ? `${D(l.discountPct)}%` : '',
      taxable, vatRate: rate, vat, category: l.vatCategory,
    };
  });
  const taxable = rows.reduce((a, r) => a.plus(r.taxable), D(0));
  const vat = rows.reduce((a, r) => a.plus(r.vat), D(0));
  const cancelled = v.status === 'cancelled';

  return (
    <div className="flex-1 overflow-auto bg-[#e9ece6] print:bg-white">
      <div className="no-print flex gap-2 justify-end max-w-[210mm] mx-auto pt-4">
        <button className="px-3 py-1 bg-brand text-white" onClick={() => window.print()}>Print (Ctrl+P)</button>
        <button className="px-3 py-1 border border-line bg-panel" onClick={() => app.pop()}>Back (Esc)</button>
      </div>
      <div className="print-area bg-white max-w-[210mm] mx-auto my-4 p-10 shadow print:shadow-none print:my-0 text-[13px] text-black">
        <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-4">
          <div>
            <div className="text-xl font-bold">{c.mailingName || c.name}</div>
            <div className="whitespace-pre-line">{c.address}</div>
            <div>{emirateName(c.emirate)}, United Arab Emirates</div>
            {c.phone && <div>Tel: {c.phone}</div>}
            <div className="font-semibold mt-1">TRN: {c.trn ?? '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold uppercase tracking-wide">{HEADINGS[v.base] ?? v.type_name}</div>
            {cancelled && <div className="text-red-700 font-bold">CANCELLED</div>}
            <div className="mt-2">No.: <b>{v.number}</b></div>
            <div>Date: <b>{fdate(v.date)}</b></div>
            {v.reference_no && <div>Reference: {v.reference_no}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-xs uppercase text-gray-600">{v.base === 'purchase' || v.base === 'debit_note' ? 'Supplier' : 'Bill to'}</div>
            <div className="font-semibold">{v.party_name}</div>
            {v.party_address && <div className="whitespace-pre-line">{v.party_address}</div>}
            {v.party_emirate && <div>{emirateName(v.party_emirate)}, UAE</div>}
            <div>TRN: {v.party_trn ?? 'Not registered'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-gray-600">Place of supply</div>
            <div>{emirateName(v.place_of_supply || v.party_emirate || c.emirate)}</div>
          </div>
        </div>
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr className="border-y-2 border-black text-left text-xs">
              <th className="py-1 w-8">#</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th>
              <th className="text-right">Disc.</th><th className="text-right">Taxable (AED)</th><th className="text-right">VAT %</th><th className="text-right">VAT (AED)</th><th className="text-right">Total (AED)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-300 align-top">
                <td className="py-1">{i + 1}</td>
                <td>{r.desc}{r.category !== 'standard' && <div className="text-[11px] text-gray-600">{vatLabel(r.category)}</div>}</td>
                <td className="text-right num">{r.qty}</td><td className="text-right num">{amt(r.rate)}</td><td className="text-right">{r.disc}</td>
                <td className="text-right num">{amt(r.taxable, true)}</td><td className="text-right num">{r.vatRate.toString()}%</td>
                <td className="text-right num">{amt(r.vat, true)}</td><td className="text-right num">{amt(r.taxable.plus(r.vat), true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end">
          <table className="min-w-72">
            <tbody>
              <tr><td className="pr-6 py-0.5">Total taxable value</td><td className="text-right num">{amt(taxable, true)}</td></tr>
              <tr><td className="pr-6 py-0.5">Total VAT</td><td className="text-right num">{amt(vat, true)}</td></tr>
              <tr className="border-t-2 border-black font-bold text-base"><td className="pr-6 py-1">Total payable (AED)</td><td className="text-right num">{amt(taxable.plus(vat), true)}</td></tr>
            </tbody>
          </table>
        </div>
        {rows.some((r) => r.category === 'zero') && <p className="mt-4 text-xs">Zero-rated supply under the UAE VAT Law.</p>}
        {v.narration && <p className="mt-4 text-xs"><b>Notes:</b> {v.narration}</p>}
        <div className="mt-16 flex justify-between text-xs">
          <div>Received by: ____________________</div>
          <div className="text-right">For {c.name}<div className="mt-10">Authorised signatory</div></div>
        </div>
      </div>
    </div>
  );
}
