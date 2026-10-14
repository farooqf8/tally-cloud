// Bill-wise allocation for a party line in a payment, receipt or journal: settle pending bills
// (Agst Ref) oldest first, and put any remainder on account, as an advance or a new bill.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { D, Decimal, amt, drcr, fdate } from '../lib/fmt';
import { Form, Modal, Num, Select, Text } from './ui';

export interface BillAlloc { type: 'new_ref' | 'agst_ref' | 'advance' | 'on_account'; name?: string | null; dueDate?: string | null; amount: string }
interface Pending { name: string; date: string; due_date: string | null; pending: string }

export function BillModal({ ledgerName, ledgerId, amount, side, bills, voucherId, onAccept, onClose }: {
  ledgerName: string; ledgerId: number; amount: string; side: 'dr' | 'cr'; bills?: BillAlloc[];
  voucherId?: number; onAccept: (b: BillAlloc[]) => void; onClose: () => void;
}) {
  const app = useApp();
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [restType, setRestType] = useState<BillAlloc['type']>('on_account');
  const [restName, setRestName] = useState('');
  const total = D(amount);

  useEffect(() => {
    api<Pending[]>(app.cpath(`/ledgers/${ledgerId}/pending-bills${voucherId ? `?excludeVoucherId=${voucherId}` : ''}`)).then((p) => {
      // Only bills on the opposite side can be settled by this line (a credit settles debit bills).
      const usable = p.filter((b) => (side === 'cr' ? D(b.pending).gt(0) : D(b.pending).lt(0)));
      setPending(usable);
      const a: Record<string, string> = {};
      if (bills?.length) {
        for (const b of bills) if (b.type === 'agst_ref' && b.name) a[b.name] = b.amount;
        const rest = bills.find((b) => b.type !== 'agst_ref');
        if (rest) { setRestType(rest.type); setRestName(rest.name ?? ''); }
      } else {
        let left = total;
        for (const b of usable) {
          if (left.lte(0)) break;
          const take = Decimal.min(left, D(b.pending).abs());
          a[b.name] = take.toFixed(2);
          left = left.minus(take);
        }
      }
      setAlloc(a);
    }).catch((e) => app.toast(e.message, 'bad'));
  }, []);

  const allocated = useMemo(() => Object.values(alloc).reduce((s, v) => s.plus(D(v)), D(0)), [alloc]);
  const rest = total.minus(allocated);

  const accept = () => {
    if (rest.lt(0)) return app.toast('Allocated more than the line amount', 'bad');
    if (rest.gt(0) && restType !== 'on_account' && !restName.trim()) return app.toast('Give the new reference / advance a name', 'bad');
    const out: BillAlloc[] = Object.entries(alloc).filter(([, v]) => D(v).gt(0)).map(([name, v]) => ({ type: 'agst_ref', name, amount: D(v).toFixed(2) }));
    if (rest.gt(0)) out.push({ type: restType, name: restType === 'on_account' ? null : restName.trim(), amount: rest.toFixed(2) });
    onAccept(out);
  };

  return (
    <Modal title={`Bill-wise Details for: ${ledgerName}`} onClose={onClose} width="max-w-3xl"
      keys={[{ key: 'ctrl+a', run: accept, inInputs: true }]}>
      <div className="text-sm mb-2">Up to <b className="num">{amt(total, true)}</b> {side === 'dr' ? 'Dr' : 'Cr'}</div>
      <Form onEnd={accept}>
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="border-b border-line text-left text-muted text-xs">
              <th className="py-1">Agst Ref</th><th>Bill date</th><th>Due</th><th className="text-right">Pending</th><th className="text-right w-40">Allocate now</th>
            </tr>
          </thead>
          <tbody>
            {pending === null && <tr><td colSpan={5} className="py-3 text-muted">Loading pending bills…</td></tr>}
            {pending?.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">No pending bills to settle for this ledger.</td></tr>}
            {pending?.map((b, i) => (
              <tr key={b.name} className="border-b border-line/60">
                <td className="py-0.5 font-medium">{b.name}</td>
                <td>{fdate(b.date)}</td>
                <td>{fdate(b.due_date)}</td>
                <td className="num">{drcr(b.pending)}</td>
                <td><Num autoFocus={i === 0} value={alloc[b.name] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [b.name]: e.target.value }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3 text-sm bg-sel-soft px-2 py-1.5">
          <span>Balance <b className="num">{amt(rest, true)}</b> as</span>
          <Select className="w-40" value={restType} onChange={(v) => setRestType(v as BillAlloc['type'])}
            options={[['on_account', 'On Account'], ['advance', 'Advance'], ['new_ref', 'New Ref']]} />
          {restType !== 'on_account' && <Text className="w-48" placeholder="Reference name" value={restName} onChange={(e) => setRestName(e.target.value)} />}
        </div>
      </Form>
      <div className="flex justify-end gap-2 mt-4">
        <button className="px-3 py-1 border border-line" onClick={onClose}>Esc: Cancel</button>
        <button className="px-3 py-1 bg-brand text-white" onClick={accept}>Ctrl+A: Accept</button>
      </div>
    </Modal>
  );
}
