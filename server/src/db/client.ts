import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, types } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Keep NUMERIC and DATE as strings end to end: money never passes through a JS float, and
// dates never shift by a timezone.
const keep = (v: string) => v;
pg.types.setTypeParser(1700, keep);
pg.types.setTypeParser(1082, keep);
pg.types.setTypeParser(20, (v) => Number(v));

let exec: (sql: string) => Promise<unknown>;
export let db: Db;

if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzleNode(pool, { schema }) as unknown as Db;
  exec = (sql) => pool.query(sql);
  console.log('Database: PostgreSQL via DATABASE_URL');
} else {
  const dataDir = process.env.PGLITE_DIR ?? path.resolve(here, '../../data/pgdata');
  if (!dataDir.startsWith('memory://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir, {
    parsers: { [types.NUMERIC]: keep, [types.DATE]: keep, [types.INT8]: (v: string) => Number(v) },
  });
  db = drizzlePglite(client, { schema }) as unknown as Db;
  exec = (sql) => client.exec(sql);
  console.log(`Database: embedded PostgreSQL (PGlite) at ${dataDir}`);
}

/** Applies migrations/*.sql in name order, each once, recording them in schema_migrations. */
export async function migrate() {
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = ((await db.execute(`SELECT name FROM schema_migrations` as any)) as any).rows.map((r: { name: string }) => r.name);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.includes(file)) continue;
    const body = readFileSync(path.join(migrationsDir, file), 'utf8');
    await exec(`BEGIN;\n${body}\nINSERT INTO schema_migrations (name) VALUES ('${file}');\nCOMMIT;`);
    console.log(`Applied migration ${file}`);
  }
}
