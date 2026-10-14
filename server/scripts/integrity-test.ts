// Runs against a throwaway in-memory database: `npm test`.
// Proves the accounting rules hold at the database level, not just in the API.
process.env.PGLITE_DIR = 'memory://';
const { db, migrate } = await import('../src/db/client.js');
const { createCompany } = await import('../src/services/company.js');
const { createVoucher, updateVoucher } = await import('../src/services/vouchers.js');
const { trialBalance, vat201 } = await import('../src/services/reports.js');
const { sql } = await import('drizzle-orm');

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const rejects = async (name: string, fn: () => Promise<unknown>, match: RegExp) => {
  try { await fn(); ok(name, false); }
  catch (e: any) { const m = String(e?.cause?.message ?? e?.message); ok(`${name}  -> "${m}"`, match.test(m)); }
};

await migrate();
const c = await createCompany({ name: 'Test LLC', emirate: 'dubai', fyStart: '2026-01-01', booksFrom: '2026-01-01', vatRegistered: true });
const q = async (s: any) => ((await db.execute(s)) as any).rows;
const L = Object.fromEntries((await q(sql`SELECT reserved_key, id FROM ledgers WHERE company_id = ${c.id}`)).map((r: any) => [r.reserved_key, r.id]));
const VT = Object.fromEntries((await q(sql`SELECT base, id FROM voucher_types WHERE company_id = ${c.id}`)).map((r: any) => [r.base, r.id]));
const [debtors] = await q(sql`SELECT id FROM groups WHERE company_id = ${c.id} AND name = 'Sundry Debtors'`);
const [cust] = await q(sql`INSERT INTO ledgers (company_id, name, group_id) VALUES (${c.id}, 'Customer A', ${debtors.id}) RETURNING id`);

ok('28 predefined groups created', (await q(sql`SELECT count(*)::int AS n FROM groups WHERE company_id = ${c.id}`))[0].n === 28);

// 1. The database rejects an unbalanced voucher even when written with raw SQL.
await rejects('raw SQL unbalanced voucher rejected at COMMIT', () => db.transaction(async (tx) => {
  const [v] = ((await tx.execute(sql`INSERT INTO vouchers (company_id, voucher_type_id, number, date) VALUES (${c.id}, ${VT.journal}, 'X1', '2026-03-01') RETURNING id`)) as any).rows;
  await tx.execute(sql`INSERT INTO ledger_entries (voucher_id, company_id, ledger_id, amount, line_no) VALUES (${v.id}, ${c.id}, ${cust.id}, 100, 1)`);
  await tx.execute(sql`INSERT INTO ledger_entries (voucher_id, company_id, ledger_id, amount, line_no) VALUES (${v.id}, ${c.id}, ${L.sales}, -99.99, 2)`);
}), /not balanced/);
ok('rejected voucher left nothing behind', (await q(sql`SELECT count(*)::int AS n FROM vouchers WHERE number = 'X1'`))[0].n === 0);

// 2. The API rejects it too, with a readable message.
await rejects('API unbalanced journal rejected', () => createVoucher(c.id, {
  voucherTypeId: VT.journal, date: '2026-03-01',
  entries: [{ ledgerId: cust.id, side: 'dr', amount: '100' }, { ledgerId: L.sales, side: 'cr', amount: '90' }],
}), /differ by 10\.00/);
await rejects('journal with cash ledger rejected', () => createVoucher(c.id, {
  voucherTypeId: VT.journal, date: '2026-03-01',
  entries: [{ ledgerId: L.cash, side: 'dr', amount: '100' }, { ledgerId: L.sales, side: 'cr', amount: '100' }],
}), /Cash or Bank/);

// 3. Decimal safety: 0.1 + 0.2 must be exactly 0.3.
const inv = await createVoucher(c.id, {
  voucherTypeId: VT.sales, date: '2026-03-02', partyLedgerId: cust.id,
  lines: [{ ledgerId: L.sales, amount: '0.1', vatCategory: 'out_of_scope' }, { ledgerId: L.sales, amount: '0.2', vatCategory: 'out_of_scope' }],
});
ok('0.1 + 0.2 posts as exactly 0.3000', inv.totalAmount === '0.3000');

// 4. VAT at 5% rounds per line to fils.
const v2 = await createVoucher(c.id, {
  voucherTypeId: VT.sales, date: '2026-03-03', partyLedgerId: cust.id,
  lines: [{ ledgerId: L.sales, amount: '33.33', vatCategory: 'standard', vatRate: '5' }],
});
ok('VAT 5% of 33.33 = 1.67, invoice 35.00', v2.totalAmount === '35.0000');
const r = await vat201(c.id, '2026-01-01', '2026-12-31');
ok('VAT 201 Box 1b Dubai = 33.33 / 1.67', r.outputs.find((o) => o.no === '1b')?.vat === '1.67');

// 5. Period lock blocks create, alter and delete.
await db.execute(sql`UPDATE companies SET locked_until = '2026-03-31' WHERE id = ${c.id}`);
await rejects('posting into locked period rejected', () => createVoucher(c.id, {
  voucherTypeId: VT.sales, date: '2026-03-15', partyLedgerId: cust.id,
  lines: [{ ledgerId: L.sales, amount: '10', vatCategory: 'standard' }],
}), /locked/);
await rejects('altering a locked voucher rejected', () => updateVoucher(c.id, v2.id, {
  voucherTypeId: VT.sales, date: '2026-04-02', partyLedgerId: cust.id,
  lines: [{ ledgerId: L.sales, amount: '10', vatCategory: 'standard' }],
}), /locked/);
await rejects('deleting a locked voucher rejected', () => db.execute(sql`DELETE FROM vouchers WHERE id = ${v2.id}`), /locked/);
await rejects('date before books beginning rejected', () => db.execute(sql`UPDATE companies SET locked_until = NULL WHERE id = ${c.id}`).then(() => createVoucher(c.id, {
  voucherTypeId: VT.sales, date: '2025-12-31', partyLedgerId: cust.id,
  lines: [{ ledgerId: L.sales, amount: '10', vatCategory: 'standard' }],
})), /books beginning/);

// 6. Predefined masters are protected.
await rejects('deleting a predefined group rejected', () => db.execute(sql`DELETE FROM groups WHERE company_id = ${c.id} AND name = 'Fixed Assets'`), /predefined/);

const tb = await trialBalance(c.id, '2026-01-01', '2026-12-31');
ok('trial balance closing Dr = Cr', tb.totals.closingDr === tb.totals.closingCr);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
