/**
 * Sync endpoints.
 *
 * The wire format is WatermelonDB's: `{ [table]: { created, updated, deleted } }`
 * with the *client's* column names, because the client applies these rows
 * directly into its local schema. Anything the device does not have a column
 * for (owner_id, sync_status) is dropped on the way out, and the JSONB
 * shape_params is stringified because SQLite has no JSON type.
 *
 * Conflict resolution is last-write-wins on `updated_at`, which is supplied by
 * the client and never stamped by the server. That is why the migration has no
 * updated_at trigger: a trigger would overwrite the very value this comparison
 * depends on.
 */

import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { ensureProfile } from '../profile.js';
import { isCanonicalPhotoKey } from '../storageKeys.js';
import { parseZoneShape } from '../zoneShapes.js';
import {
  arrows,
  gearProfiles,
  rounds,
  sessions,
  targetZones,
  targets,
} from '../db/schema.js';

type Raw = Record<string, unknown>;

interface TableChanges {
  created: Raw[];
  updated: Raw[];
  deleted: string[];
}

/*
 * Bounds on a push.
 *
 * The 8 MB body limit was the only ceiling before, and it is the wrong kind of
 * limit: it caps bytes, not rows to insert or foreign keys to check. These
 * numbers are far above a real device's backlog — a season of daily practice
 * is a few thousand arrows — and far below the point where one request becomes
 * a denial of service. A device with more than this to send syncs twice.
 */
const MAX_ROWS_PER_TABLE = 10_000;
const MAX_TABLES = 32;

const tableChanges = z.object({
  created: z.array(z.record(z.unknown())).max(MAX_ROWS_PER_TABLE).default([]),
  updated: z.array(z.record(z.unknown())).max(MAX_ROWS_PER_TABLE).default([]),
  deleted: z.array(z.string().uuid()).max(MAX_ROWS_PER_TABLE).default([]),
});

const pushBody = z.object({
  lastPulledAt: z.string().datetime().nullable().optional(),
  changes: z
    .record(tableChanges)
    .refine((c) => Object.keys(c).length <= MAX_TABLES, {
      message: `At most ${MAX_TABLES} tables per push`,
    }),
});

const pullQuery = z.object({
  since: z.string().datetime().optional(),
});

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Split rows into created/updated by whether the client can already have them. */
function bucket<T extends { createdAt: Date }>(
  rows: T[],
  since: Date | null,
  serialize: (row: T) => Raw,
): TableChanges {
  const created: Raw[] = [];
  const updated: Raw[] = [];

  for (const row of rows) {
    // On a first sync everything is new to the client. Afterwards, a row the
    // client has never seen must arrive as `created` — Watermelon rejects an
    // `updated` record it has no local copy of.
    if (!since || row.createdAt > since) created.push(serialize(row));
    else updated.push(serialize(row));
  }

  return { created, updated, deleted: [] };
}

export default async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/sync/pull', async (request, reply) => {
    const query = pullQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query', detail: query.error.issues });
    }

    const since = query.data.since ? new Date(query.data.since) : null;
    const userId = request.userId;

    // Read everything at one point in time. Without a snapshot, a row written
    // between two of these queries could be missed by this pull and never
    // reported by the next one, because the returned timestamp would already
    // be past it.
    const result = await db.transaction(async (tx) => {
      // Every column this is called with is a `timestamp with time zone`, but
      // Drizzle bakes the table name into a column's type, so a signature tied
      // to one table's updated_at rejects the other five. The loose generic is
      // the narrowest way to say "any timestamp column".
      const changedSince = (column: PgColumn<any, any, any>) =>
        since ? gt(column, since) : undefined;

      const gear = await tx
        .select()
        .from(gearProfiles)
        .where(
          and(
            eq(gearProfiles.ownerId, userId),
            changedSince(gearProfiles.updatedAt),
          ),
        );

      // Presets (owner NULL) belong to everyone and must reach every device.
      const targetRows = await tx
        .select()
        .from(targets)
        .where(
          and(
            or(isNull(targets.ownerId), eq(targets.ownerId, userId)),
            changedSince(targets.updatedAt),
          ),
        );

      const visibleTargets = await tx
        .select({ id: targets.id })
        .from(targets)
        .where(or(isNull(targets.ownerId), eq(targets.ownerId, userId)));

      const zoneRows = visibleTargets.length
        ? await tx
            .select()
            .from(targetZones)
            .where(
              and(
                inArray(
                  targetZones.targetId,
                  visibleTargets.map((t) => t.id),
                ),
                changedSince(targetZones.updatedAt),
              ),
            )
        : [];

      const sessionRows = await tx
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.ownerId, userId), changedSince(sessions.updatedAt)),
        );

      const ownedSessions = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.ownerId, userId));

      const roundRows = ownedSessions.length
        ? await tx
            .select()
            .from(rounds)
            .where(
              and(
                inArray(
                  rounds.sessionId,
                  ownedSessions.map((s) => s.id),
                ),
                changedSince(rounds.updatedAt),
              ),
            )
        : [];

      const ownedRounds = ownedSessions.length
        ? await tx
            .select({ id: rounds.id })
            .from(rounds)
            .where(
              inArray(
                rounds.sessionId,
                ownedSessions.map((s) => s.id),
              ),
            )
        : [];

      const arrowRows = ownedRounds.length
        ? await tx
            .select()
            .from(arrows)
            .where(
              and(
                inArray(
                  arrows.roundId,
                  ownedRounds.map((r) => r.id),
                ),
                changedSince(arrows.updatedAt),
              ),
            )
        : [];

      return { gear, targetRows, zoneRows, sessionRows, roundRows, arrowRows };
    });

    return {
      changes: {
        gear_profiles: bucket(result.gear, since, (g) => ({
          id: g.id,
          name: g.name,
          bow_type: g.bowType,
          notes: g.notes,
          created_at: iso(g.createdAt),
          updated_at: iso(g.updatedAt),
        })),

        targets: bucket(result.targetRows, since, (t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          base_shape: t.baseShape,
          // Both are round-tripped now. Sending null here (as this did before
          // the 0002 migration) wiped the device's face geometry on first pull.
          aspect_ratio: t.aspectRatio,
          face_width_cm: t.faceWidthCm,
          created_at: iso(t.createdAt),
          updated_at: iso(t.updatedAt),
        })),

        target_zones: bucket(result.zoneRows, since, (z) => ({
          id: z.id,
          target_id: z.targetId,
          zone_index: z.zoneIndex,
          score_value: z.scoreValue,
          shape_type: z.shapeType,
          // SQLite has no JSON type; the device stores and parses text.
          shape_params: JSON.stringify(z.shapeParams),
          created_at: iso(z.createdAt),
          updated_at: iso(z.updatedAt),
        })),

        sessions: bucket(result.sessionRows, since, (s) => ({
          id: s.id,
          shot_at: iso(s.shotAt),
          round_format_id: s.roundFormatId,
          distance_m: s.distanceM,
          gear_profile_id: s.gearProfileId,
          equipment_tag: s.equipmentTag,
          location: s.location,
          notes: s.notes,
          created_at: iso(s.createdAt),
          updated_at: iso(s.updatedAt),
        })),

        rounds: bucket(result.roundRows, since, (r) => ({
          id: r.id,
          session_id: r.sessionId,
          target_id: r.targetId,
          round_order: r.roundOrder,
          photo_key: r.photoKey,
          created_at: iso(r.createdAt),
          updated_at: iso(r.updatedAt),
        })),

        arrows: bucket(result.arrowRows, since, (a) => ({
          id: a.id,
          round_id: a.roundId,
          x: a.x,
          y: a.y,
          score_value: a.scoreValue,
          shot_order: a.shotOrder,
          created_at: iso(a.createdAt),
          updated_at: iso(a.updatedAt),
        })),
      },
      // The server's clock. Devices at a field range routinely have the wrong
      // time, and a client-supplied watermark would drop or replay changes.
      timestamp: new Date().toISOString(),
    };
  });

  app.post('/sync/push', async (request, reply) => {
    const body = pushBody.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const userId = request.userId;
    const changes = body.data.changes;

    const get = (table: string): TableChanges =>
      changes[table] ?? { created: [], updated: [], deleted: [] };

    try {
      await db.transaction(async (tx) => {
        /*
         * The caller's profile row, before anything that references it.
         *
         * Cognito mints users without telling us, and nothing in the app
         * called GET /me — so a brand new account's first sync failed the
         * owner_id foreign key and returned a 500. The device retried, hit the
         * same wall, and reported "sync failed" forever while the archer's
         * sessions sat on their phone. Inside the transaction, so a push that
         * rolls back does not leave a profile behind for a sync that never
         * happened.
         */
        await ensureProfile(tx, userId, request.userEmail);

        // Parents before children, so a foreign key always has something to point
        // at when a whole session arrives from an offline device in one push.
        const incoming = (table: string) => [
          ...get(table).created,
          ...get(table).updated,
        ];

        /*
         * Deletions run BEFORE the upserts, children first.
         *
         * Deleting an arrow and shooting another reuses the freed shot number —
         * correct for the archer, since the replacement really is the second
         * arrow. But the deleted row still occupies (round_id, shot_order) until
         * its tombstone is applied, so upserting first hits the unique index,
         * the whole transaction rolls back, and the archer's sync fails with
         * nothing to show for it.
         *
         * The ordering costs nothing: a record cannot be in both `deleted` and
         * `updated` in one push, so nothing that is about to be written is being
         * removed here.
         */
        const ownedSessionsForDelete = await ownedIds(
          tx,
          sessions.id,
          sessions,
          eq(sessions.ownerId, userId),
        );

        const ownedRoundsForDelete = ownedSessionsForDelete.size
          ? await ownedIds(
              tx,
              rounds.id,
              rounds,
              inArray(rounds.sessionId, [...ownedSessionsForDelete]),
            )
          : new Set<string>();

        await deleteOwned(
          tx,
          arrows,
          get('arrows').deleted,
          ownedRoundsForDelete,
          'roundId',
        );
        await deleteOwned(
          tx,
          rounds,
          get('rounds').deleted,
          ownedSessionsForDelete,
          'sessionId',
        );

        if (get('sessions').deleted.length) {
          await tx
            .delete(sessions)
            .where(
              and(
                inArray(sessions.id, get('sessions').deleted),
                eq(sessions.ownerId, userId),
              ),
            );
        }

        if (get('gear_profiles').deleted.length) {
          await tx
            .delete(gearProfiles)
            .where(
              and(
                inArray(gearProfiles.id, get('gear_profiles').deleted),
                eq(gearProfiles.ownerId, userId),
              ),
            );
        }

        if (get('targets').deleted.length) {
          await tx
            .delete(targets)
            .where(
              and(
                inArray(targets.id, get('targets').deleted),
                eq(targets.ownerId, userId),
              ),
            );
        }

        await upsertMany(
          tx,
          gearProfiles,
          incoming('gear_profiles').map((raw) => ({
            id: uuid(raw.id),
            ownerId: userId,
            name: requiredStr(raw.name, 120),
            bowType: boundedStr(raw.bow_type, 60),
            notes: boundedStr(raw.notes, 2000),
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })),
          gearProfiles.id,
          {
            name: sql`excluded.name`,
            bowType: sql`excluded.bow_type`,
            notes: sql`excluded.notes`,
            updatedAt: sql`excluded.updated_at`,
          },
          // Last write wins. An older copy arriving late must not clobber a
          // newer one already stored.
          sql`${gearProfiles.ownerId} = ${userId} AND excluded.updated_at > ${gearProfiles.updatedAt}`,
        );

        // Custom targets only. A device cannot create or edit a shared preset.
        await upsertMany(
          tx,
          targets,
          incoming('targets')
            .filter((raw) => raw.type !== 'preset')
            .map((raw) => ({
              id: uuid(raw.id),
              ownerId: userId,
              name: requiredStr(raw.name, 120),
              type: 'custom' as const,
              baseShape: boundedStr(raw.base_shape, 60),
              aspectRatio: nullablePositiveNumber(raw.aspect_ratio),
              faceWidthCm: nullablePositiveNumber(raw.face_width_cm),
              createdAt: date(raw.created_at),
              updatedAt: date(raw.updated_at),
            })),
          targets.id,
          {
            name: sql`excluded.name`,
            baseShape: sql`excluded.base_shape`,
            aspectRatio: sql`excluded.aspect_ratio`,
            faceWidthCm: sql`excluded.face_width_cm`,
            updatedAt: sql`excluded.updated_at`,
          },
          sql`${targets.ownerId} = ${userId} AND excluded.updated_at > ${targets.updatedAt}`,
        );

        // Read after the upserts above, so a session can reference gear and a
        // round can reference a face that arrived in the same push.
        const ownedGearIds = await ownedIds(
          tx,
          gearProfiles.id,
          gearProfiles,
          eq(gearProfiles.ownerId, userId),
        );

        const ownedTargetIds = await ownedIds(
          tx,
          targets.id,
          targets,
          eq(targets.ownerId, userId),
        );

        // Presets included: every device may shoot at a shared face, and only
        // custom faces are owned.
        const visibleTargets = await ownedIds(
          tx,
          targets.id,
          targets,
          or(isNull(targets.ownerId), eq(targets.ownerId, userId)),
        );

        await upsertMany(
          tx,
          targetZones,
          incoming('target_zones')
            // Silently skipping a zone whose target is not ours is the right
            // call: a hostile client could otherwise rewrite the scoring rings
            // of a shared preset for every user.
            .filter((raw) => ownedTargetIds.has(str(raw.target_id)))
            .map((raw) => {
              // Same rules as POST /targets. Geometry that reaches the device
              // unvalidated turns into NaN comparisons, and an arrow inside a
              // broken ring scores as a miss with nothing on screen to explain
              // it.
              const shape = parseZoneShape(raw.shape_type, raw.shape_params);
              if (!shape) {
                throw new PushValidationError('Invalid zone geometry');
              }

              return {
                id: uuid(raw.id),
                targetId: uuid(raw.target_id),
                zoneIndex: boundedInt(raw.zone_index, 0, 1000),
                scoreValue: boundedInt(raw.score_value, 0, 100),
                shapeType: shape.shapeType,
                shapeParams: shape.shapeParams as Record<string, unknown>,
                createdAt: date(raw.created_at),
                updatedAt: date(raw.updated_at),
              };
            }),
          targetZones.id,
          {
            zoneIndex: sql`excluded.zone_index`,
            scoreValue: sql`excluded.score_value`,
            shapeType: sql`excluded.shape_type`,
            shapeParams: sql`excluded.shape_params`,
            updatedAt: sql`excluded.updated_at`,
          },
          sql`excluded.updated_at > ${targetZones.updatedAt}`,
        );

        await upsertMany(
          tx,
          sessions,
          incoming('sessions').map((raw) => {
            const gearId = nullableStr(raw.gear_profile_id);

            return {
              id: uuid(raw.id),
              ownerId: userId,
              shotAt: date(raw.shot_at),
              // A catalogue id, so bounded like any other client string.
              roundFormatId: boundedStr(raw.round_format_id, 64),
              distanceM:
                raw.distance_m === null || raw.distance_m === undefined
                  ? null
                  : bounded(raw.distance_m, 0, 9999),
              // Dropped rather than rejected when it is not ours: an id we have
              // never heard of fails the foreign key and rolls back the archer's
              // whole push, and one belonging to someone else must not become a
              // reference either way.
              gearProfileId: gearId && ownedGearIds.has(gearId) ? gearId : null,
              equipmentTag: boundedStr(raw.equipment_tag, 200),
              location: boundedStr(raw.location, 200),
              notes: boundedStr(raw.notes, 4000),
              syncStatus: 'synced' as const,
              createdAt: date(raw.created_at),
              updatedAt: date(raw.updated_at),
            };
          }),
          sessions.id,
          {
            shotAt: sql`excluded.shot_at`,
            roundFormatId: sql`excluded.round_format_id`,
            distanceM: sql`excluded.distance_m`,
            gearProfileId: sql`excluded.gear_profile_id`,
            equipmentTag: sql`excluded.equipment_tag`,
            location: sql`excluded.location`,
            notes: sql`excluded.notes`,
            syncStatus: sql`'synced'`,
            updatedAt: sql`excluded.updated_at`,
          },
          sql`${sessions.ownerId} = ${userId} AND excluded.updated_at > ${sessions.updatedAt}`,
        );

        const ownedSessionIds = await ownedIds(
          tx,
          sessions.id,
          sessions,
          eq(sessions.ownerId, userId),
        );

        await upsertMany(
          tx,
          rounds,
          incoming('rounds')
            .filter((raw) => ownedSessionIds.has(str(raw.session_id)))
            // A target that is neither a shared preset nor ours is not a
            // reference this device gets to create. Left in, a guessed id
            // attached another user's private face to this round; a made-up one
            // failed the foreign key and rolled back the entire push.
            .filter((raw) => visibleTargets.has(str(raw.target_id)))
            .map((raw) => {
              const id = uuid(raw.id);
              const suppliedKey = boundedStr(raw.photo_key, 1024);

              return {
                id,
                sessionId: uuid(raw.session_id),
                targetId: uuid(raw.target_id),
                roundOrder: boundedInt(raw.round_order, 0, 1000),
                // Same rule as PATCH /rounds/:id — a photo key is derived from
                // the owner and the round, never taken from the wire. Sync would
                // otherwise be a second way to point a round at someone else's
                // object and have the API sign a URL for it.
                photoKey: isCanonicalPhotoKey(suppliedKey, userId, id)
                  ? suppliedKey
                  : null,
                syncStatus: 'synced' as const,
                createdAt: date(raw.created_at),
                updatedAt: date(raw.updated_at),
              };
            }),
          rounds.id,
          {
            targetId: sql`excluded.target_id`,
            roundOrder: sql`excluded.round_order`,
            photoKey: sql`excluded.photo_key`,
            syncStatus: sql`'synced'`,
            updatedAt: sql`excluded.updated_at`,
          },
          sql`excluded.updated_at > ${rounds.updatedAt}`,
        );

        const ownedRoundIds = ownedSessionIds.size
          ? await ownedIds(
              tx,
              rounds.id,
              rounds,
              inArray(rounds.sessionId, [...ownedSessionIds]),
            )
          : new Set<string>();

        await upsertMany(
          tx,
          arrows,
          incoming('arrows')
            .filter((raw) => ownedRoundIds.has(str(raw.round_id)))
            .map((raw) => ({
              id: uuid(raw.id),
              roundId: uuid(raw.round_id),
              // Normalized to the face, so 0-1 is the whole domain. The column
              // is NUMERIC(9,6) with a CHECK, and anything outside took down the
              // transaction rather than the row.
              x: bounded(raw.x, 0, 1),
              y: bounded(raw.y, 0, 1),
              scoreValue: boundedInt(raw.score_value, 0, 100),
              shotOrder:
                raw.shot_order === null || raw.shot_order === undefined
                  ? null
                  : boundedInt(raw.shot_order, 1, 1000),
              createdAt: date(raw.created_at),
              updatedAt: date(raw.updated_at),
            })),
          arrows.id,
          {
            x: sql`excluded.x`,
            y: sql`excluded.y`,
            scoreValue: sql`excluded.score_value`,
            shotOrder: sql`excluded.shot_order`,
            updatedAt: sql`excluded.updated_at`,
          },
          sql`excluded.updated_at > ${arrows.updatedAt}`,
        );
      });
    } catch (error) {
      if (error instanceof PushValidationError) {
        return reply
          .code(400)
          .send({ error: 'Invalid changes', detail: error.message });
      }
      throw error;
    }

    return { ok: true };
  });
}

/* ------------------------------------------------------------------------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rows per statement.
 *
 * Postgres caps a statement at 65535 bound parameters. The widest table here
 * binds nine columns, so 1000 rows is ~9000 parameters — comfortably inside
 * the limit with room for the schema to grow.
 */
const UPSERT_CHUNK = 1000;

function chunked<T>(items: T[], size = UPSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Upsert many rows in as few statements as possible.
 *
 * The previous implementation awaited one round-trip per record inside the
 * transaction. A first sync after a season is a few thousand rows, which meant
 * a few thousand sequential statements in a single request — slow locally and
 * a likely Lambda timeout in production, with the whole transaction rolled
 * back at the end of it.
 *
 * Every caller passes the same last-write-wins `setWhere`, so a stale copy
 * arriving late still loses regardless of batching.
 */
async function upsertMany<T extends Record<string, unknown>>(
  tx: Tx,
  table: any,
  rows: T[],
  conflictTarget: any,
  set: Record<string, unknown>,
  setWhere: unknown,
): Promise<void> {
  if (rows.length === 0) return;

  for (const batch of chunked(rows)) {
    await tx
      .insert(table)
      .values(batch)
      .onConflictDoUpdate({
        target: conflictTarget,
        set: set as never,
        setWhere: setWhere as never,
      });
  }
}

/**
 * Ids of rows the caller owns, used to reject pushed children whose parent is
 * not theirs. Loosely typed on purpose: it is called with five different
 * tables, and Drizzle's column types are table-specific.
 */
async function ownedIds(
  tx: Tx,
  column: PgColumn<any, any, any>,
  table: any,
  where: any,
): Promise<Set<string>> {
  const rows = await tx.select({ id: column }).from(table).where(where);
  return new Set(rows.map((r: { id: string }) => r.id));
}

async function deleteOwned(
  tx: Tx,
  table: any,
  ids: string[],
  ownedParents: Set<string>,
  parentColumn: 'roundId' | 'sessionId',
): Promise<void> {
  if (ids.length === 0 || ownedParents.size === 0) return;

  await tx
    .delete(table)
    .where(
      and(
        inArray(table.id, ids),
        inArray(table[parentColumn], [...ownedParents]),
      ),
    );
}

/**
 * A row in a push was not what it claimed to be.
 *
 * The coercion helpers below used to throw a plain Error, which reached the
 * generic handler as a 500. That is the wrong answer twice over: the caller
 * caused it, so it is a 400, and a request any client can send at will should
 * not raise the server's error rate or wake anyone up.
 */
class PushValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushValidationError';
  }
}

function str(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PushValidationError(
      `Expected a string, received ${typeof value}`,
    );
  }
  return value;
}

function uuid(value: unknown): string {
  const s = str(value);
  if (!UUID_PATTERN.test(s)) {
    throw new PushValidationError('Expected a uuid');
  }
  return s;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return str(value);
}

/**
 * A required string bounded in length.
 *
 * Every text column here is unbounded in Postgres, so without a ceiling a
 * single push could store megabytes in a session's notes and hand them back on
 * every subsequent pull to every device the archer owns.
 */
function requiredStr(value: unknown, max: number): string {
  const s = str(value);
  if (s.length > max) {
    throw new PushValidationError(`Expected at most ${max} characters`);
  }
  return s;
}

/** The same, for a column that accepts NULL. */
function boundedStr(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  return requiredStr(value, max);
}

/**
 * A positive dimension from the wire, or null when it is unusable.
 *
 * Non-finite and non-positive values are treated as unknown rather than
 * stored: a face cannot be 0 cm wide, and storing one would divide by zero in
 * the device's grouping conversion.
 */
function nullablePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new PushValidationError(
      `Expected a number, received ${String(value)}`,
    );
  }
  return n;
}

/**
 * A number inside the range its column actually accepts.
 *
 * Unbounded, these values reached the database and failed a CHECK or a NUMERIC
 * precision limit, which rolled back the whole transaction and returned a 500.
 * The REST routes have validated the same fields for a while; sync was the way
 * round them — an arrow at x = 1e9 or scoring 2^31 went in through here.
 */
function bounded(value: unknown, min: number, max: number): number {
  const n = num(value);
  if (n < min || n > max) {
    throw new PushValidationError(
      `Expected a number between ${min} and ${max}`,
    );
  }
  return n;
}

function boundedInt(value: unknown, min: number, max: number): number {
  const n = bounded(value, min, max);
  if (!Number.isInteger(n)) {
    throw new PushValidationError('Expected an integer');
  }
  return n;
}

/** Timestamps outside this are a corrupt clock, not archery history. */
const MIN_TIMESTAMP_MS = Date.UTC(1970, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2200, 0, 1);

function date(value: unknown): Date {
  const d = new Date(value as string | number);
  const ms = d.getTime();
  if (Number.isNaN(ms)) {
    throw new PushValidationError(
      `Expected a timestamp, received ${String(value)}`,
    );
  }
  // A year outside Postgres's practical range aborts the statement, which
  // rolls back every other row in the same push.
  if (ms < MIN_TIMESTAMP_MS || ms > MAX_TIMESTAMP_MS) {
    throw new PushValidationError('Timestamp out of range');
  }
  return d;
}
