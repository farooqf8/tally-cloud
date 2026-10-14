import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { createCompany, deleteCompany, EMIRATES } from '../services/company.js';
import { createDemoCompany } from '../services/demo.js';
import * as reports from '../services/reports.js';
import * as vouchers from '../services/vouchers.js';
import { mastersRouter } from './masters.js';

export const api = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const companySchema = z.object({
  name: z.string().trim().min(1),
  mailingName: z.string().trim().nullish(),
  address: z.string().nullish(),
  emirate: z.enum(EMIRATES),
  trn: z.string().trim().nullish().transform((v) => v || null)
    .refine((v) => v == null || /^\d{15}$/.test(v), 'TRN must be exactly 15 digits'),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  fyStart: dateStr,
  booksFrom: dateStr,
  vatRegistered: z.boolean().default(true),
});

api.get('/companies', async (_req, res) => {
  res.json(await db.select().from(t.companies).orderBy(asc(t.companies.name)));
});
api.post('/companies', async (req, res) => {
  res.status(201).json(await createCompany(companySchema.parse(req.body)));
});
api.post('/companies/demo', async (_req, res) => {
  res.status(201).json(await createDemoCompany());
});
api.get('/companies/:cid', async (req, res) => {
  const [c] = await db.select().from(t.companies).where(eq(t.companies.id, Number(req.params.cid)));
  if (!c) throw notFound('Company');
  res.json(c);
});
api.put('/companies/:cid', async (req, res) => {
  const data = companySchema.partial().extend({ lockedUntil: dateStr.nullish() }).parse(req.body);
  const [c] = await db.update(t.companies).set(data).where(eq(t.companies.id, Number(req.params.cid))).returning();
  if (!c) throw notFound('Company');
  res.json(c);
});
api.delete('/companies/:cid', async (req, res) => {
  await deleteCompany(Number(req.params.cid));
  res.status(204).end();
});

const c = Router({ mergeParams: true });
api.use('/c/:cid', c);
c.use(mastersRouter);
const cid = (req: any) => Number(req.params.cid);
const q = (req: any, k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
const period = (req: any) => ({ from: dateStr.parse(q(req, 'from')), to: dateStr.parse(q(req, 'to')) });

// vouchers
c.get('/vouchers', async (req, res) => {
  const { from, to } = period(req);
  res.json(await reports.dayBook(cid(req), from, to, {
    voucherTypeId: q(req, 'voucherTypeId') ? Number(q(req, 'voucherTypeId')) : undefined,
    base: q(req, 'base'),
  }));
});
c.get('/vouchers/:id', async (req, res) => res.json(await vouchers.getVoucher(cid(req), Number(req.params.id))));
c.post('/vouchers', async (req, res) => res.status(201).json(await vouchers.createVoucher(cid(req), req.body)));
c.put('/vouchers/:id', async (req, res) => res.json(await vouchers.updateVoucher(cid(req), Number(req.params.id), req.body)));
c.post('/vouchers/:id/cancel', async (req, res) => res.json(await vouchers.cancelVoucher(cid(req), Number(req.params.id))));
c.delete('/vouchers/:id', async (req, res) => {
  await vouchers.deleteVoucher(cid(req), Number(req.params.id));
  res.status(204).end();
});
c.get('/ledgers/:id/pending-bills', async (req, res) => {
  const ex = q(req, 'excludeVoucherId');
  res.json(await vouchers.pendingBills(cid(req), Number(req.params.id), ex ? Number(ex) : undefined));
});

// reports
c.get('/reports/dashboard', async (req, res) => { const p = period(req); res.json(await reports.dashboard(cid(req), p.from, p.to)); });
c.get('/reports/trial-balance', async (req, res) => { const p = period(req); res.json(await reports.trialBalance(cid(req), p.from, p.to)); });
c.get('/reports/profit-loss', async (req, res) => { const p = period(req); res.json(await reports.profitAndLoss(cid(req), p.from, p.to)); });
c.get('/reports/balance-sheet', async (req, res) => res.json(await reports.balanceSheet(cid(req), dateStr.parse(q(req, 'to')))));
c.get('/reports/ledger/:id', async (req, res) => { const p = period(req); res.json(await reports.ledgerStatement(cid(req), Number(req.params.id), p.from, p.to)); });
c.get('/reports/stock-summary', async (req, res) => {
  const p = period(req);
  res.json(await reports.stockSummary(cid(req), p.from, p.to, q(req, 'godownId') ? Number(q(req, 'godownId')) : undefined));
});
c.get('/reports/outstanding', async (req, res) => {
  const kind = z.enum(['receivable', 'payable']).parse(q(req, 'kind'));
  res.json(await reports.outstanding(cid(req), kind, dateStr.parse(q(req, 'to'))));
});
c.get('/reports/vat-201', async (req, res) => { const p = period(req); res.json(await reports.vat201(cid(req), p.from, p.to)); });
c.get('/reports/ratios', async (req, res) => { const p = period(req); res.json(await reports.ratios(cid(req), p.from, p.to)); });
c.get('/reports/brs/:id', async (req, res) => { const p = period(req); res.json(await reports.bankReconciliation(cid(req), Number(req.params.id), p.from, p.to)); });
c.put('/entries/:id/bank-date', async (req, res) => {
  const { bankDate } = z.object({ bankDate: dateStr.nullable() }).parse(req.body);
  await reports.setBankDate(cid(req), Number(req.params.id), bankDate);
  res.status(204).end();
});
c.get('/audit-log', async (req, res) => res.json(await reports.auditTrail(cid(req))));
