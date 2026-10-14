import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as t from '../db/schema.js';
import { bad } from '../lib/errors.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Exec = Db | Tx;

export type Group = typeof t.groups.$inferSelect;
export type Ledger = typeof t.ledgers.$inferSelect;

/** The group tree of one company, with "is this group under that one" lookups. */
export class Chart {
  byId = new Map<number, Group>();
  byName = new Map<string, Group>();
  constructor(public groups: Group[]) {
    for (const g of groups) {
      this.byId.set(g.id, g);
      this.byName.set(g.name.toLowerCase(), g);
    }
  }
  /** True if groupId is the named group or nested anywhere beneath it. */
  isUnder(groupId: number | null, ...names: string[]) {
    const targets = names.map((n) => this.byName.get(n.toLowerCase())?.id);
    let g = groupId == null ? undefined : this.byId.get(groupId);
    while (g) {
      if (targets.includes(g.id)) return true;
      g = g.parentId == null ? undefined : this.byId.get(g.parentId);
    }
    return false;
  }
  primaryOf(groupId: number): Group {
    let g = this.byId.get(groupId)!;
    while (g.parentId != null) g = this.byId.get(g.parentId)!;
    return g;
  }
  isCashOrBank(l: Ledger) {
    return this.isUnder(l.groupId, 'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c');
  }
  isNominal(l: Ledger) {
    if (l.groupId == null) return false;
    const n = this.byId.get(l.groupId)!.nature;
    return n === 'income' || n === 'expenses';
  }
  /** IDs of the named group and every group nested beneath it. */
  descendants(name: string): number[] {
    return this.groups.filter((g) => this.isUnder(g.id, name)).map((g) => g.id);
  }
}

export async function loadChart(x: Exec, companyId: number) {
  return new Chart(await x.select().from(t.groups).where(eq(t.groups.companyId, companyId)));
}

export async function loadLedgers(x: Exec, companyId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<number, Ledger>();
  const rows = await x.select().from(t.ledgers)
    .where(and(eq(t.ledgers.companyId, companyId), inArray(t.ledgers.id, unique)));
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of unique) if (!map.has(id)) throw bad(`Ledger ${id} not found in this company`);
  return map;
}

export async function reservedLedger(x: Exec, companyId: number, key: string) {
  const [l] = await x.select().from(t.ledgers)
    .where(and(eq(t.ledgers.companyId, companyId), eq(t.ledgers.reservedKey, key)));
  return l;
}

export async function mainGodown(x: Exec, companyId: number) {
  const [g] = await x.select().from(t.godowns)
    .where(and(eq(t.godowns.companyId, companyId), eq(t.godowns.isReserved, true)));
  return g;
}

export const rows = async <T>(x: Exec, q: ReturnType<typeof sql>) => ((await x.execute(q)) as any).rows as T[];
