import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
/** Rounds to fils (2 dp), the smallest AED unit used on invoices. */
export const fils = (v: Decimal.Value) => D(v).toDecimalPlaces(2);
export const str = (v: Decimal) => v.toFixed(4);
export const sum = (vals: Decimal.Value[]) => vals.reduce<Decimal>((a, b) => a.plus(b), D(0));
