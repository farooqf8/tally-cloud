import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Company {
  id: number; name: string; mailingName: string | null; address: string | null; emirate: string;
  trn: string | null; phone: string | null; email: string | null; baseCurrency: string;
  fyStart: string; booksFrom: string; vatRegistered: boolean; lockedUntil: string | null;
}
export interface Group { id: number; name: string; parentId: number | null; nature: string; affectsGrossProfit: boolean; isReserved: boolean; sortOrder: number }
export interface Ledger {
  id: number; name: string; alias: string | null; group_id: number | null; group_name: string | null;
  opening_balance: string; balance: string; maintain_bill_wise: boolean; credit_days: number | null;
  trn: string | null; emirate: string | null; vat_treatment: string | null; tax_type: string | null;
  vat_category: string | null; vat_rate: string | null; reserved_key: string | null; address: string | null;
}
export interface VoucherType { id: number; name: string; base: string; abbreviation: string | null; prefix: string; nextNumber: number; autoNumber: boolean; isReserved: boolean; active: boolean }
export interface StockItem {
  id: number; name: string; unit: string; unit_decimals: number; group_name: string | null; stock_group_id: number | null;
  vat_category: string; vat_rate: string; sales_price: string | null; balance_qty: string; opening_rate: string; reorder_level: string | null;
}
export interface Godown { id: number; name: string; parentId: number | null; isReserved: boolean }
export interface Unit { id: number; symbol: string; formalName: string | null; decimals: number }
export interface StockGroup { id: number; name: string; parentId: number | null }

export interface Masters {
  groups: Group[]; ledgers: Ledger[]; voucherTypes: VoucherType[]; stockItems: StockItem[];
  godowns: Godown[]; units: Unit[]; stockGroups: StockGroup[];
}
const EMPTY: Masters = { groups: [], ledgers: [], voucherTypes: [], stockItems: [], godowns: [], units: [], stockGroups: [] };

export interface Screen { id: number; type: string; props: Record<string, any> }
export interface Period { from: string; to: string }

interface Toast { id: number; text: string; kind: 'ok' | 'bad' }

interface AppCtx {
  company: Company | null;
  openCompany: (c: Company | null) => void;
  refreshCompany: () => Promise<void>;
  period: Period; setPeriod: (p: Period) => void;
  date: string; setDate: (d: string) => void;
  stack: Screen[];
  push: (type: string, props?: Record<string, any>) => void;
  pop: () => void;
  replace: (type: string, props?: Record<string, any>) => void;
  masters: Masters; reloadMasters: () => Promise<void>;
  /** Bumped after any voucher or master change so open reports refetch. */
  dataVersion: number; bump: () => void;
  toasts: Toast[]; toast: (text: string, kind?: 'ok' | 'bad') => void;
  cpath: (p: string) => string;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

let screenSeq = 1;

function fyFor(c: Company, today: string): Period {
  const md = c.fyStart.slice(5);
  const y = Number(today.slice(0, 4));
  let from = `${y}-${md}`;
  if (from > today) from = `${y - 1}-${md}`;
  if (from < c.booksFrom) from = c.booksFrom;
  const end = new Date(`${Number(from.slice(0, 4)) + 1}-${md}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10) };
}

export function AppProvider({ children, today }: { children: ReactNode; today: string }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [period, setPeriod] = useState<Period>({ from: today, to: today });
  const [date, setDate] = useState(today);
  const [stack, setStack] = useState<Screen[]>([{ id: 0, type: 'companies', props: {} }]);
  const [masters, setMasters] = useState<Masters>(EMPTY);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const companyRef = useRef<Company | null>(null);

  const cpath = useCallback((p: string) => `/c/${companyRef.current?.id}${p}`, []);

  const reloadMasters = useCallback(async () => {
    const c = companyRef.current;
    if (!c) return setMasters(EMPTY);
    const base = `/c/${c.id}`;
    const [groups, ledgers, voucherTypes, stockItems, godowns, units, stockGroups] = await Promise.all([
      api(`${base}/groups`), api(`${base}/ledgers`), api(`${base}/voucher-types`), api(`${base}/stock-items`),
      api(`${base}/godowns`), api(`${base}/units`), api(`${base}/stock-groups`),
    ]);
    setMasters({ groups, ledgers, voucherTypes, stockItems, godowns, units, stockGroups });
  }, []);

  const openCompany = useCallback((c: Company | null) => {
    companyRef.current = c;
    setCompany(c);
    if (c) {
      const p = fyFor(c, today);
      setPeriod(p);
      setDate(today >= p.from && today <= p.to ? today : p.to);
      setStack([{ id: screenSeq++, type: 'gateway', props: {} }]);
      reloadMasters();
    } else {
      setMasters(EMPTY);
      setStack([{ id: screenSeq++, type: 'companies', props: {} }]);
    }
  }, [today, reloadMasters]);

  const refreshCompany = useCallback(async () => {
    if (!companyRef.current) return;
    const c = await api<Company>(`/companies/${companyRef.current.id}`);
    companyRef.current = c;
    setCompany(c);
  }, []);

  const toast = useCallback((text: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 6000 : 3000);
  }, []);

  const value = useMemo<AppCtx>(() => ({
    company, openCompany, refreshCompany, period, setPeriod, date, setDate, stack,
    push: (type, props = {}) => setStack((s) => [...s, { id: screenSeq++, type, props }]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (type, props = {}) => setStack((s) => [...s.slice(0, -1), { id: screenSeq++, type, props }]),
    masters, reloadMasters,
    dataVersion, bump: () => { setDataVersion((v) => v + 1); reloadMasters(); },
    toasts, toast, cpath,
  }), [company, openCompany, refreshCompany, period, date, stack, masters, reloadMasters, dataVersion, toasts, toast, cpath]);

  useEffect(() => {
    // Reopen the last company after a reload.
    let last = 0;
    try { last = Number(localStorage.getItem('tally.company') ?? 0); } catch { /* storage unavailable */ }
    if (last) api<Company>(`/companies/${last}`).then(openCompany).catch(() => { try { localStorage.removeItem('tally.company'); } catch { /* ignore */ } });
  }, [openCompany]);
  useEffect(() => {
    try { company ? localStorage.setItem('tally.company', String(company.id)) : localStorage.removeItem('tally.company'); } catch { /* storage unavailable */ }
  }, [company]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Fetches `path` whenever it or the data version changes. */
export function useFetch<T>(path: string | null) {
  const { dataVersion, toast } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path).then((d) => live && setData(d)).catch((e) => toast(e.message, 'bad')).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [path, dataVersion, toast]);
  return { data, loading, setData };
}

export const BASE_LABEL: Record<string, string> = {
  contra: 'Contra', payment: 'Payment', receipt: 'Receipt', journal: 'Journal', sales: 'Sales', purchase: 'Purchase',
  credit_note: 'Credit Note', debit_note: 'Debit Note', stock_journal: 'Stock Journal', physical_stock: 'Physical Stock',
};
export const VOUCHER_KEYS: [string, string][] = [
  ['F4', 'contra'], ['F5', 'payment'], ['F6', 'receipt'], ['F7', 'journal'], ['F8', 'sales'], ['F9', 'purchase'],
  ['ctrl+F8', 'credit_note'], ['ctrl+F9', 'debit_note'], ['alt+F7', 'stock_journal'], ['alt+F10', 'physical_stock'],
];
