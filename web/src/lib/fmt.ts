import Decimal from 'decimal.js';

export { Decimal };
export const D = (v: Decimal.Value | null | undefined) => {
  try { return new Decimal(v === '' || v == null ? 0 : v); } catch { return new Decimal(0); }
};

const grouping = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1234.5 -> "1,234.50"; zero -> "" unless keepZero. */
export function amt(v: Decimal.Value | null | undefined, keepZero = false) {
  const d = D(v);
  if (d.isZero() && !keepZero) return '';
  return grouping.format(Number(d.toFixed(2)));
}
/** Signed balance -> "1,234.50 Dr" / "Cr". */
export function drcr(v: Decimal.Value | null | undefined) {
  const d = D(v);
  if (d.isZero()) return '';
  return `${amt(d.abs())} ${d.isNeg() ? 'Cr' : 'Dr'}`;
}
export function qty(v: Decimal.Value | null | undefined, unit?: string) {
  const d = D(v);
  if (d.isZero()) return '';
  const s = d.toDecimalPlaces(3).toString();
  return unit ? `${s} ${unit}` : s;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-02-12" -> "12-Feb-2026" */
export function fdate(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MON[Number(m) - 1]}-${y}`;
}
export const fday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

/**
 * Accepts the shortcuts accountants type: "12", "12-2", "12/2/26", "12-Feb-2026", "2026-02-12".
 * Missing parts come from `ref`. Returns ISO or null.
 */
export function parseDate(text: string, ref: string): string | null {
  const s = text.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return valid(s);
  const parts = s.split(/[-/.\s]+/);
  const ry = Number(ref.slice(0, 4));
  const rm = Number(ref.slice(5, 7));
  const d = Number(parts[0]);
  let m = rm;
  if (parts[1]) {
    const mi = MON.findIndex((x) => x.toLowerCase() === parts[1].slice(0, 3).toLowerCase());
    m = mi >= 0 ? mi + 1 : Number(parts[1]);
  }
  let y = parts[2] ? Number(parts[2]) : ry;
  if (y < 100) y += 2000;
  if (!d || !m || !y) return null;
  return valid(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}
function valid(iso: string) {
  const dt = new Date(`${iso}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const EMIRATES: [string, string][] = [
  ['abu_dhabi', 'Abu Dhabi'], ['dubai', 'Dubai'], ['sharjah', 'Sharjah'], ['ajman', 'Ajman'],
  ['umm_al_quwain', 'Umm Al Quwain'], ['ras_al_khaimah', 'Ras Al Khaimah'], ['fujairah', 'Fujairah'],
];
export const emirateName = (k?: string | null) => EMIRATES.find((e) => e[0] === k)?.[1] ?? '';
export const VAT_CATEGORIES: [string, string][] = [
  ['standard', 'Standard 5%'], ['zero', 'Zero rated'], ['exempt', 'Exempt'],
  ['reverse_charge', 'Reverse charge'], ['import_goods', 'Import of goods'], ['out_of_scope', 'Out of scope'],
];
export const vatLabel = (k?: string | null) => VAT_CATEGORIES.find((e) => e[0] === k)?.[1] ?? '';
export const VAT_BEARING = ['standard', 'reverse_charge', 'import_goods'];
export const VAT_TREATMENTS: [string, string][] = [
  ['registered', 'Registered business'], ['unregistered', 'Unregistered / consumer'],
  ['designated_zone', 'Designated zone'], ['gcc', 'GCC'], ['overseas', 'Outside GCC'],
];

type Cell = string | number | null | undefined;
export function downloadCsv(name: string, rows: Cell[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
