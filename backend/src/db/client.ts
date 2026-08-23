/**
 * Postgres connection.
 *
 * The pool is module-scoped so it survives across Lambda invocations on a warm
 * container — creating one per request would open a connection per request and
 * exhaust the database under any real concurrency.
 *
 * `max` is deliberately small. Each concurrent Lambda gets its own container
 * and therefore its own pool, so the cluster-wide connection count is
 * (concurrency x max), not max. This is why the infrastructure puts RDS Proxy
 * in front in AWS: it multiplexes those onto a bounded set of real
 * connections. Locally there is no proxy, so a small number here keeps a
 * runaway loop from taking out the Docker database.
 */

import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

import { Signer } from '@aws-sdk/rds-signer';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

// NUMERIC-to-number conversion is declared per column in schema.ts via
// `mode: 'number'`, rather than by overriding the driver's parser for OID 1700
// process-wide. Same effect where it is wanted, and no effect on a column that
// later needs full NUMERIC precision.

/**
 * Password for a connection, generated fresh each time one is opened.
 *
 * With IAM authentication there is no database password anywhere — not in the
 * function's environment, not in the CloudFormation template, not in anyone's
 * shell history. The signer mints a token from the Lambda's own role, signed
 * locally with credentials the runtime already holds, so this costs no network
 * call despite looking like it should.
 *
 * Tokens last 15 minutes. `pg` calls this per new connection rather than once,
 * which is exactly the behaviour that makes them safe to use: a pooled
 * connection that outlives its token stays authenticated, and the next one to
 * open gets a fresh token.
 */
function iamTokenProvider(): () => Promise<string> {
  const url = new URL(env.DATABASE_URL);

  const signer = new Signer({
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    username: decodeURIComponent(url.username),
    region: env.AWS_REGION,
  });

  return () => signer.getAuthToken();
}

/**
 * TLS settings.
 *
 * RDS presents a certificate from Amazon's own CA, which is not in Node's
 * bundled trust store, so `rejectUnauthorized: true` fails without the bundle
 * supplied explicitly. There is no fallback to the system roots here on
 * purpose: quietly downgrading to an unverified connection is how a database
 * ends up reachable by anything that can get between the function and the
 * proxy.
 */
function tlsConfig(): ConnectionOptions | undefined {
  if (env.NODE_ENV !== 'production') return undefined;

  if (!env.DB_CA_BUNDLE_PATH) {
    throw new Error(
      'DB_CA_BUNDLE_PATH is required in production: Amazon RDS certificates ' +
        "are not signed by a CA in Node's default trust store, so TLS " +
        'verification cannot succeed without the bundle.',
    );
  }

  return {
    ca: readFileSync(env.DB_CA_BUNDLE_PATH, 'utf8'),
    rejectUnauthorized: true,
  };
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ...(env.DB_IAM_AUTH ? { password: iamTokenProvider() } : {}),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: tlsConfig(),
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
