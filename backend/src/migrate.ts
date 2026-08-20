/**
 * Schema migration runner.
 *
 * Locally the schema is applied by Postgres's initdb hook, which only fires on
 * an empty data directory — fine for a container you throw away, useless for
 * RDS. This is the explicit step that applies the same files, in the same
 * order, to a real database.
 *
 * It runs as a Lambda because the database sits in isolated subnets with no
 * public address: nothing outside the VPC can reach it, by design. Invoke it
 * after deploying, before pointing traffic at a new schema:
 *
 *   aws lambda invoke --function-name archery-dev-migrate /dev/stdout
 *
 * Deliberately not wired to run automatically on deploy. A migration that
 * fails half way through cannot be undone by a CloudFormation rollback, and a
 * custom resource that fails can hold a stack hostage for an hour. Running it
 * as its own step means a failure is a failure of that step, with the output
 * in front of whoever ran it.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './db/client.js';

/**
 * Every file, in the order it must be applied.
 *
 * Listed explicitly rather than globbed. The order here is not alphabetical —
 * the preset seed runs before 0002 because that migration backfills the rows
 * the seed creates — and a glob would silently get that wrong. It mirrors the
 * mount order in docker-compose.yml, so local and deployed schemas cannot
 * drift apart.
 *
 * `0002_demo_data.sql` is absent on purpose. It is a fabricated archer with a
 * season of invented scores, useful for development and actively harmful in a
 * real database.
 */
const FILES = [
  'migrations/0001_init.sql',
  'seeds/0001_preset_targets.sql',
  'migrations/0002_target_face_dimensions.sql',
  'migrations/0003_session_round_format.sql',
  'migrations/0004_arrow_set_size.sql',
] as const;

/*
 * Where the .sql files are.
 *
 * From source, migrate.ts sits in src/ and the files are one level up in db/.
 * Bundled, everything collapses to /var/task and that relative path resolves
 * outside it — so deployment states the directory rather than relying on a
 * layout the bundler is free to change. Read here rather than in env.ts
 * because it configures this entry point alone.
 */
const DB_ROOT =
  process.env['DB_MIGRATIONS_DIR'] ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'db');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Record of what has run.
 *
 * The checksum is the point. Editing a migration that has already been applied
 * is a mistake that otherwise shows up much later as two environments with
 * different schemas and no explanation; comparing hashes turns it into a loud
 * failure on the next run.
 */
const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function migrate(): Promise<MigrationResult> {
  const applied: string[] = [];
  const skipped: string[] = [];

  await pool.query(MIGRATIONS_TABLE);

  for (const file of FILES) {
    const sql = await readFile(join(DB_ROOT, file), 'utf8');
    const hash = checksum(sql);

    const existing = await pool.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE filename = $1',
      [file],
    );

    const previous = existing.rows[0];

    if (previous) {
      if (previous.checksum !== hash) {
        throw new Error(
          `${file} has changed since it was applied. Migrations are immutable ` +
            'once run — add a new file instead of editing this one.',
        );
      }
      skipped.push(file);
      continue;
    }

    /*
     * One transaction per file.
     *
     * The bookkeeping row is written inside it, so a file either applies
     * completely and is recorded, or does neither. A crash between the two
     * would otherwise leave a migration that has run but will run again.
     */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, hash],
      );
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed to apply: ${String(error)}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

/** Lambda entry point. Returns the summary so `invoke` prints something useful. */
export async function handler(): Promise<MigrationResult> {
  const result = await migrate();
  console.log(
    `Applied ${result.applied.length}, already present ${result.skipped.length}`,
  );
  return result;
}
