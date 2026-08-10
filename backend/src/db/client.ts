/**
 * Postgres connection.
 *
 * The pool is module-scoped so it survives across Lambda invocations on a warm
 * container — creating one per request would open a connection per request and
 * exhaust the database under any real concurrency.
 *
 * `max` is deliberately small. Each concurrent Lambda gets its own container
 * and therefore its own pool, so the cluster-wide connection count is
 * (concurrency x max), not max. This is why the design puts RDS Proxy in front
 * in AWS: it multiplexes those onto a bounded set of real connections. Locally
 * there is no proxy, so a small number here keeps a runaway loop from taking
 * out the Docker database.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

// NUMERIC-to-number conversion is declared per column in schema.ts via
// `mode: 'number'`, rather than by overriding the driver's parser for OID 1700
// process-wide. Same effect where it is wanted, and no effect on a column that
// later needs full NUMERIC precision.

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : undefined,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
