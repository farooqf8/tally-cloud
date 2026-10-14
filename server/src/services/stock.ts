import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { D, Decimal } from '../lib/money.js';
import { rows, type Tx } from './chart.js';

// Base types whose inward lines set the weighted average cost. Sales returns (credit notes)
// come back in at selling price, so they add quantity but do not move the cost.
const COSTING_BASES = sql`('purchase','stock_journal','physical_stock')`;

export interface ItemPosition {
  id: number;
  name: string;
  stockGroupId: number | null;
  unit: string;
  qty: Decimal;
  avgRate: Decimal;
  value: Decimal;
}

/**
 * Closing quantity and value of every stock item as at a date (inclusive), valued at weighted
 * average cost. `asOf = null` gives the opening position (item opening balances only).
 */
export async function stockPosition(x: Db | Tx, companyId: number, asOf: string | null, godownId?: number) {
  const dateCond = asOf == null ? sql`false` : sql`v.date <= ${asOf}`;
  const godownCond = godownId ? sql`AND ie.godown_id = ${godownId}` : sql``;
  const r = await rows<any>(x, sql`
    SELECT si.id, si.name, si.stock_group_id, u.symbol AS unit,
           si.opening_qty, si.opening_value, si.opening_rate,
           si.opening_godown_id,
           COALESCE(SUM(m.qty), 0) AS moved,
           COALESCE(SUM(m.qty) FILTER (WHERE m.costing AND m.qty > 0), 0) AS in_qty,
           COALESCE(SUM(m.amount) FILTER (WHERE m.costing AND m.qty > 0), 0) AS in_value
    FROM stock_items si
    JOIN units u ON u.id = si.unit_id
    LEFT JOIN (
      SELECT ie.stock_item_id, ie.qty, ie.amount, vt.base IN ${COSTING_BASES} AS costing
      FROM inventory_entries ie
      JOIN vouchers v ON v.id = ie.voucher_id AND v.status = 'posted' AND NOT v.is_optional AND ${dateCond}
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE ie.company_id = ${companyId} ${godownCond}
    ) m ON m.stock_item_id = si.id
    WHERE si.company_id = ${companyId}
    GROUP BY si.id, u.symbol
    ORDER BY si.name`);
  const main = godownId ? await rows<{ id: number }>(x, sql`SELECT id FROM godowns WHERE company_id = ${companyId} AND is_reserved`) : [];
  return r.map((i): ItemPosition => {
    // Opening stock sits in its opening godown (Main Location when not set).
    const openingHere = !godownId || (i.opening_godown_id ?? main[0]?.id) === godownId;
    const oq = openingHere ? D(i.opening_qty) : D(0);
    const ov = openingHere ? D(i.opening_value) : D(0);
    const baseQty = D(i.opening_qty).plus(i.in_qty);
    const avgRate = baseQty.gt(0)
      ? D(i.opening_value).plus(i.in_value).div(baseQty)
      : D(i.opening_rate);
    const qty = oq.plus(i.moved);
    return {
      id: i.id, name: i.name, stockGroupId: i.stock_group_id, unit: i.unit,
      qty, avgRate, value: asOf == null && openingHere ? ov : qty.times(avgRate).toDecimalPlaces(2),
    };
  });
}

export async function stockValue(x: Db | Tx, companyId: number, asOf: string | null) {
  const items = await stockPosition(x, companyId, asOf);
  return items.reduce((a, i) => a.plus(i.value), D(0));
}

/** Book quantity of one item in one godown as at a date, for physical stock verification. */
export async function bookQty(x: Db | Tx, companyId: number, itemId: number, godownId: number, asOf: string) {
  const [r] = await rows<any>(x, sql`
    SELECT
      (SELECT CASE WHEN COALESCE(si.opening_godown_id, (SELECT id FROM godowns WHERE company_id = ${companyId} AND is_reserved)) = ${godownId}
                   THEN si.opening_qty ELSE 0 END FROM stock_items si WHERE si.id = ${itemId})
      + COALESCE((SELECT SUM(ie.qty) FROM inventory_entries ie
          JOIN vouchers v ON v.id = ie.voucher_id AND v.status = 'posted' AND NOT v.is_optional AND v.date <= ${asOf}
          WHERE ie.stock_item_id = ${itemId} AND ie.godown_id = ${godownId}), 0) AS qty`);
  return D(r.qty);
}
