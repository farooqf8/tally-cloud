import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import { bad, notFound } from '../lib/errors.js';
import { D, fils } from '../lib/money.js';
import { rows } from '../services/chart.js';

const optStr = z.string().trim().nullish().transform((v) => (v === '' ? null : v ?? null));
const optId = z.number().int().positive().nullish().transform((v) => v ?? null);
const num = z.union([z.string(), z.number()]).transform((v) => String(v).trim() || '0')
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'must be a number');
const optNum = z.union([z.string(), z.number()]).nullish()
  .transform((v) => (v == null || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v == null || /^-?\d+(\.\d+)?$/.test(v), 'must be a number');
const vatCategory = z.enum(['standard', 'zero', 'exempt', 'reverse_charge', 'import_goods', 'out_of_scope']);

interface MasterDef {
  table: PgTable & { id: any; companyId: any; name?: any };
  schema: z.ZodObject<any>;
  order: any;
  /** Fills derived fields and checks cross-field rules; may consult the DB. */
  prepare?: (cid: number, data: any, existing?: any) => Promise<any>;
  /** Fields a reserved (predefined) master may still change. */
  reservedEditable?: string[];
}

const groupSchema = z.object({
  name: z.string().trim().min(1),
  parentId: optId,
  nature: z.enum(['assets', 'liabilities', 'income', 'expenses']).optional(),
  affectsGrossProfit: z.boolean().optional(),
});

const ledgerSchema = z.object({
  name: z.string().trim().min(1),
  alias: optStr,
  groupId: z.number().int().positive(),
  openingBalance: num.default('0'), // signed: Dr +, Cr -
  maintainBillWise: z.boolean().default(false),
  creditDays: z.number().int().min(0).nullish().transform((v) => v ?? null),
  trn: optStr.refine((v) => v == null || /^\d{15}$/.test(v), 'TRN must be exactly 15 digits'),
  address: optStr, emirate: optStr, country: optStr, phone: optStr, email: optStr,
  vatTreatment: z.enum(['registered', 'unregistered', 'designated_zone', 'gcc', 'overseas']).nullish().transform((v) => v ?? null),
  vatCategory: vatCategory.nullish().transform((v) => v ?? null),
  vatRate: optNum,
  bankName: optStr, accountNo: optStr, iban: optStr, swift: optStr,
});

const stockItemSchema = z.object({
  name: z.string().trim().min(1),
  alias: optStr, partNo: optStr,
  stockGroupId: optId,
  unitId: z.number().int().positive(),
  openingQty: num.default('0'),
  openingRate: num.default('0'),
  openingGodownId: optId,
  vatCategory: vatCategory.default('standard'),
  vatRate: num.default('5'),
  salesPrice: optNum,
  reorderLevel: optNum,
});

async function ownGroup(cid: number, id: number) {
  const [g] = await db.select().from(t.groups).where(and(eq(t.groups.id, id), eq(t.groups.companyId, cid)));
  if (!g) throw bad('Group not found');
  return g;
}

const MASTERS: Record<string, MasterDef> = {
  groups: {
    table: t.groups, schema: groupSchema, order: [asc(t.groups.sortOrder), asc(t.groups.name)],
    reservedEditable: ['name'],
    async prepare(cid, d, existing) {
      if (d.parentId) {
        if (existing && d.parentId === existing.id) throw bad('A group cannot be its own parent');
        const p = await ownGroup(cid, d.parentId);
        // Sub-groups inherit nature and gross-profit treatment from their parent.
        return { ...d, nature: p.nature, affectsGrossProfit: p.affectsGrossProfit };
      }
      if (!d.nature) throw bad('Select "Under" group, or a nature for a new primary group');
      return { ...d, affectsGrossProfit: d.affectsGrossProfit ?? false };
    },
  },
  ledgers: {
    table: t.ledgers, schema: ledgerSchema, order: asc(t.ledgers.name),
    reservedEditable: ['name', 'alias', 'openingBalance', 'vatRate', 'groupId'],
    async prepare(cid, d, existing) {
      if (existing?.reservedKey === 'pl') {
        const { groupId: _g, ...rest } = d;
        return { ...rest, openingBalance: fils(d.openingBalance).toFixed(4) };
      }
      await ownGroup(cid, d.groupId);
      return { ...d, openingBalance: fils(d.openingBalance).toFixed(4) };
    },
  },
  'voucher-types': {
    table: t.voucherTypes, order: asc(t.voucherTypes.name),
    schema: z.object({
      name: z.string().trim().min(1),
      base: z.enum(['contra', 'payment', 'receipt', 'journal', 'sales', 'purchase', 'credit_note', 'debit_note', 'stock_journal', 'physical_stock']),
      abbreviation: optStr,
      prefix: z.string().trim().default(''),
      nextNumber: z.number().int().positive().default(1),
      autoNumber: z.boolean().default(true),
      active: z.boolean().default(true),
    }),
    reservedEditable: ['prefix', 'nextNumber', 'autoNumber', 'abbreviation'],
    async prepare(_cid, d, existing) {
      if (existing && d.base !== existing.base) throw bad('The voucher type it is based on cannot be changed');
      return d;
    },
  },
  units: {
    table: t.units, order: asc(t.units.symbol),
    schema: z.object({ symbol: z.string().trim().min(1), formalName: optStr, decimals: z.number().int().min(0).max(4).default(0) }),
  },
  'stock-groups': {
    table: t.stockGroups, order: asc(t.stockGroups.name),
    schema: z.object({ name: z.string().trim().min(1), parentId: optId }),
  },
  godowns: {
    table: t.godowns, order: asc(t.godowns.name),
    schema: z.object({ name: z.string().trim().min(1), parentId: optId }),
    reservedEditable: ['name'],
  },
  'stock-items': {
    table: t.stockItems, schema: stockItemSchema, order: asc(t.stockItems.name),
    async prepare(_cid, d) {
      return { ...d, openingValue: fils(D(d.openingQty).times(d.openingRate)).toFixed(4) };
    },
  },
};

export const mastersRouter = Router({ mergeParams: true });

// Ledger list with current balances, for pickers ("Cur Bal" in Tally).
mastersRouter.get('/ledgers', async (req, res) => {
  const cid = Number((req.params as any).cid);
  res.json(await rows(db, sql`
    SELECT l.*, g.name AS group_name,
      l.opening_balance + COALESCE((SELECT SUM(e.amount) FROM ledger_entries e
        JOIN vouchers v ON v.id = e.voucher_id AND v.status = 'posted' AND NOT v.is_optional
        WHERE e.ledger_id = l.id), 0) AS balance
    FROM ledgers l LEFT JOIN groups g ON g.id = l.group_id
    WHERE l.company_id = ${cid} ORDER BY l.name`));
});

mastersRouter.get('/stock-items', async (req, res) => {
  const cid = Number((req.params as any).cid);
  res.json(await rows(db, sql`
    SELECT s.*, u.symbol AS unit, u.decimals AS unit_decimals, sg.name AS group_name,
      s.opening_qty + COALESCE((SELECT SUM(ie.qty) FROM inventory_entries ie
        JOIN vouchers v ON v.id = ie.voucher_id AND v.status = 'posted' AND NOT v.is_optional
        WHERE ie.stock_item_id = s.id), 0) AS balance_qty
    FROM stock_items s JOIN units u ON u.id = s.unit_id LEFT JOIN stock_groups sg ON sg.id = s.stock_group_id
    WHERE s.company_id = ${cid} ORDER BY s.name`));
});

for (const [path, def] of Object.entries(MASTERS)) {
  const tbl: any = def.table;
  const own = (cid: number, id: number) => and(eq(tbl.id, id), eq(tbl.companyId, cid));

  mastersRouter.get(`/${path}`, async (req, res) => {
    const cid = Number((req.params as any).cid);
    res.json(await db.select().from(tbl).where(eq(tbl.companyId, cid)).orderBy(...[def.order].flat()));
  });

  mastersRouter.get(`/${path}/:id`, async (req, res) => {
    const cid = Number((req.params as any).cid);
    const [row] = await db.select().from(tbl).where(own(cid, Number(req.params.id)));
    if (!row) throw notFound();
    res.json(row);
  });

  mastersRouter.post(`/${path}`, async (req, res) => {
    const cid = Number((req.params as any).cid);
    let data = def.schema.parse(req.body);
    if (def.prepare) data = await def.prepare(cid, data);
    const [row] = (await db.insert(tbl).values({ ...data, companyId: cid }).returning()) as any[];
    await db.insert(t.auditLog).values({ companyId: cid, entity: path, entityId: (row as any).id, action: 'create', after: row });
    res.status(201).json(row);
  });

  mastersRouter.put(`/${path}/:id`, async (req, res) => {
    const cid = Number((req.params as any).cid);
    const id = Number(req.params.id);
    const [existing] = await db.select().from(tbl).where(own(cid, id)) as any[];
    if (!existing) throw notFound();
    let data = def.schema.partial().parse(req.body);
    data = def.prepare ? await def.prepare(cid, { ...existing, ...data }, existing) : data;
    if (existing.isReserved) {
      const allowed = def.reservedEditable ?? [];
      data = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
    }
    delete data.id; delete data.companyId; delete data.isReserved; delete data.reservedKey; delete data.createdAt;
    const [row] = await db.update(tbl).set(data).where(own(cid, id)).returning();
    await db.insert(t.auditLog).values({ companyId: cid, entity: path, entityId: id, action: 'alter', before: existing, after: row });
    res.json(row);
  });

  mastersRouter.delete(`/${path}/:id`, async (req, res) => {
    const cid = Number((req.params as any).cid);
    const id = Number(req.params.id);
    const [existing] = (await db.select().from(tbl).where(own(cid, id))) as any[];
    if (!existing) throw notFound();
    if ((existing as any).reservedKey) throw bad('This ledger is used by the system (VAT, cash or default sales/purchase) and cannot be deleted');
    await db.delete(tbl).where(own(cid, id));
    await db.insert(t.auditLog).values({ companyId: cid, entity: path, entityId: id, action: 'delete', before: existing });
    res.status(204).end();
  });
}
