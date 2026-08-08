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

const tableChanges = z.object({
  created: z.array(z.record(z.unknown())).default([]),
  updated: z.array(z.record(z.unknown())).default([]),
  deleted: z.array(z.string()).default([]),
});

const pushBody = z.object({
  lastPulledAt: z.string().datetime().nullable().optional(),
  changes: z.record(tableChanges),
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
      return reply.code(400).send({ error: 'Invalid query', detail: query.error.issues });
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
        .where(and(eq(gearProfiles.ownerId, userId), changedSince(gearProfiles.updatedAt)));

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
        .where(and(eq(sessions.ownerId, userId), changedSince(sessions.updatedAt)));

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
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    const userId = request.userId;
    const changes = body.data.changes;

    const get = (table: string): TableChanges =>
      changes[table] ?? { created: [], updated: [], deleted: [] };

    await db.transaction(async (tx) => {
      // Parents before children, so a foreign key always has something to point
      // at when a whole session arrives from an offline device in one push.
      for (const raw of [...get('gear_profiles').created, ...get('gear_profiles').updated]) {
        await tx
          .insert(gearProfiles)
          .values({
            id: str(raw.id),
            ownerId: userId,
            name: str(raw.name),
            bowType: nullableStr(raw.bow_type),
            notes: nullableStr(raw.notes),
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: gearProfiles.id,
            set: {
              name: sql`excluded.name`,
              bowType: sql`excluded.bow_type`,
              notes: sql`excluded.notes`,
              updatedAt: sql`excluded.updated_at`,
            },
            // Last write wins. An older copy arriving late must not clobber a
            // newer one already stored.
            setWhere: sql`${gearProfiles.ownerId} = ${userId} AND excluded.updated_at > ${gearProfiles.updatedAt}`,
          });
      }

      // Custom targets only. A device cannot create or edit a shared preset.
      for (const raw of [...get('targets').created, ...get('targets').updated]) {
        if (raw.type === 'preset') continue;

        await tx
          .insert(targets)
          .values({
            id: str(raw.id),
            ownerId: userId,
            name: str(raw.name),
            type: 'custom',
            baseShape: nullableStr(raw.base_shape),
            aspectRatio: nullableNumericString(raw.aspect_ratio),
            faceWidthCm: nullableNumericString(raw.face_width_cm),
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: targets.id,
            set: {
              name: sql`excluded.name`,
              baseShape: sql`excluded.base_shape`,
              aspectRatio: sql`excluded.aspect_ratio`,
              faceWidthCm: sql`excluded.face_width_cm`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`${targets.ownerId} = ${userId} AND excluded.updated_at > ${targets.updatedAt}`,
          });
      }

      const ownedTargetIds = await ownedIds(
        tx,
        targets.id,
        targets,
        eq(targets.ownerId, userId),
      );

      for (const raw of [...get('target_zones').created, ...get('target_zones').updated]) {
        // Silently skipping a zone whose target is not ours is the right call:
        // a hostile client could otherwise rewrite the scoring rings of a
        // shared preset for every user.
        if (!ownedTargetIds.has(str(raw.target_id))) continue;

        await tx
          .insert(targetZones)
          .values({
            id: str(raw.id),
            targetId: str(raw.target_id),
            zoneIndex: num(raw.zone_index),
            scoreValue: num(raw.score_value),
            shapeType: str(raw.shape_type) as 'circle' | 'ellipse' | 'rectangle' | 'polygon',
            shapeParams: parseJson(raw.shape_params),
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: targetZones.id,
            set: {
              zoneIndex: sql`excluded.zone_index`,
              scoreValue: sql`excluded.score_value`,
              shapeType: sql`excluded.shape_type`,
              shapeParams: sql`excluded.shape_params`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`excluded.updated_at > ${targetZones.updatedAt}`,
          });
      }

      for (const raw of [...get('sessions').created, ...get('sessions').updated]) {
        await tx
          .insert(sessions)
          .values({
            id: str(raw.id),
            ownerId: userId,
            shotAt: date(raw.shot_at),
            distanceM: raw.distance_m === null || raw.distance_m === undefined
              ? null
              : String(raw.distance_m),
            gearProfileId: nullableStr(raw.gear_profile_id),
            equipmentTag: nullableStr(raw.equipment_tag),
            location: nullableStr(raw.location),
            notes: nullableStr(raw.notes),
            syncStatus: 'synced',
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: sessions.id,
            set: {
              shotAt: sql`excluded.shot_at`,
              distanceM: sql`excluded.distance_m`,
              gearProfileId: sql`excluded.gear_profile_id`,
              equipmentTag: sql`excluded.equipment_tag`,
              location: sql`excluded.location`,
              notes: sql`excluded.notes`,
              syncStatus: sql`'synced'`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`${sessions.ownerId} = ${userId} AND excluded.updated_at > ${sessions.updatedAt}`,
          });
      }

      const ownedSessionIds = await ownedIds(
        tx,
        sessions.id,
        sessions,
        eq(sessions.ownerId, userId),
      );

      for (const raw of [...get('rounds').created, ...get('rounds').updated]) {
        if (!ownedSessionIds.has(str(raw.session_id))) continue;

        await tx
          .insert(rounds)
          .values({
            id: str(raw.id),
            sessionId: str(raw.session_id),
            targetId: str(raw.target_id),
            roundOrder: num(raw.round_order),
            photoKey: nullableStr(raw.photo_key),
            syncStatus: 'synced',
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: rounds.id,
            set: {
              targetId: sql`excluded.target_id`,
              roundOrder: sql`excluded.round_order`,
              photoKey: sql`excluded.photo_key`,
              syncStatus: sql`'synced'`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`excluded.updated_at > ${rounds.updatedAt}`,
          });
      }

      const ownedRoundIds = ownedSessionIds.size
        ? await ownedIds(
            tx,
            rounds.id,
            rounds,
            inArray(rounds.sessionId, [...ownedSessionIds]),
          )
        : new Set<string>();

      for (const raw of [...get('arrows').created, ...get('arrows').updated]) {
        if (!ownedRoundIds.has(str(raw.round_id))) continue;

        await tx
          .insert(arrows)
          .values({
            id: str(raw.id),
            roundId: str(raw.round_id),
            x: String(raw.x),
            y: String(raw.y),
            scoreValue: num(raw.score_value),
            shotOrder:
              raw.shot_order === null || raw.shot_order === undefined
                ? null
                : num(raw.shot_order),
            createdAt: date(raw.created_at),
            updatedAt: date(raw.updated_at),
          })
          .onConflictDoUpdate({
            target: arrows.id,
            set: {
              x: sql`excluded.x`,
              y: sql`excluded.y`,
              scoreValue: sql`excluded.score_value`,
              shotOrder: sql`excluded.shot_order`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`excluded.updated_at > ${arrows.updatedAt}`,
          });
      }

      // Deletions, children first so cascades never surprise anyone.
      await deleteOwned(tx, arrows, get('arrows').deleted, ownedRoundIds, 'roundId');
      await deleteOwned(tx, rounds, get('rounds').deleted, ownedSessionIds, 'sessionId');

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
    });

    return { ok: true };
  });
}

/* ------------------------------------------------------------------------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function str(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected a string, received ${typeof value}`);
  }
  return value;
}

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return str(value);
}

/**
 * Drizzle binds NUMERIC columns as strings, so a JS number has to be converted
 * rather than passed through. A non-finite or non-positive value is treated as
 * unknown: a face cannot be 0 cm wide, and storing one would produce a
 * divide-by-zero in the device's grouping conversion.
 */
function nullableNumericString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Expected a number, received ${String(value)}`);
  }
  return n;
}

function date(value: unknown): Date {
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Expected a timestamp, received ${String(value)}`);
  }
  return d;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return JSON.parse(str(value)) as Record<string, unknown>;
}
