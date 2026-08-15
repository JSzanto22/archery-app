import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../dbErrors.js';
import {
  arrows,
  gearProfiles,
  rounds,
  sessions,
  targets,
} from '../db/schema.js';

/*
 * Every array a caller controls is bounded.
 *
 * Unbounded, the 8 MB body limit was the only ceiling — roughly 35,000 arrows
 * or zones in a single request, each one a row to insert and, for zones,
 * geometry the device then evaluates per arrow. The limits below are far above
 * any real archery round (a 144-arrow FITA is the long end) and far below the
 * point where one request becomes a denial of service.
 */
export const MAX_ARROWS_PER_ROUND = 200;
export const MAX_ROUNDS_PER_SESSION = 60;

const arrowInput = z.object({
  id: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // An upper bound as well as a lower one: a 12 is the highest any face here
  // scores, and without a ceiling a caller could inflate their own history to
  // an arbitrary integer.
  scoreValue: z.number().int().min(0).max(100),
  shotOrder: z.number().int().positive().max(1000).nullable().optional(),
});

const roundInput = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  roundOrder: z.number().int().min(0).max(1000),
  // Accepted for shape compatibility and then ignored — the canonical key is
  // derived server-side. See storageKeys.ts.
  photoKey: z.string().max(1024).nullable().optional(),
  arrows: z.array(arrowInput).max(MAX_ARROWS_PER_ROUND).optional(),
});

const sessionInput = z.object({
  id: z.string().uuid(),
  shotAt: z.coerce.date(),
  // 9999.99 is what NUMERIC(6,2) holds; anything larger became a 500 from the
  // database rather than a 400 from validation.
  distanceM: z.number().positive().max(9999).nullable().optional(),
  gearProfileId: z.string().uuid().nullable().optional(),
  equipmentTag: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  rounds: z.array(roundInput).max(MAX_ROUNDS_PER_SESSION).optional(),
});

const listQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  distance: z.coerce.number().positive().optional(),
  gear_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export default async function sessionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/sessions', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query', detail: query.error.issues });
    }

    const { from, to, distance, gear_id: gearId, limit } = query.data;

    const filters = [eq(sessions.ownerId, request.userId)];
    if (from) filters.push(gte(sessions.shotAt, from));
    if (to) filters.push(lte(sessions.shotAt, to));
    if (distance !== undefined) filters.push(eq(sessions.distanceM, distance));
    if (gearId) filters.push(eq(sessions.gearProfileId, gearId));

    return db
      .select()
      .from(sessions)
      .where(and(...filters))
      .orderBy(desc(sessions.shotAt))
      .limit(limit);
  });

  /** A session with its full sub-tree: the shape the detail screen needs. */
  app.get('/sessions/:id', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const found = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, params.data.id),
          eq(sessions.ownerId, request.userId),
        ),
      )
      .limit(1);

    const session = found[0];
    if (!session) return reply.code(404).send({ error: 'Not found' });

    const sessionRounds = await db
      .select()
      .from(rounds)
      .where(eq(rounds.sessionId, session.id))
      .orderBy(asc(rounds.roundOrder));

    const roundArrows = sessionRounds.length
      ? await db
          .select()
          .from(arrows)
          .where(
            inArray(
              arrows.roundId,
              sessionRounds.map((r) => r.id),
            ),
          )
          .orderBy(asc(arrows.shotOrder))
      : [];

    const byRound = new Map<string, typeof roundArrows>();
    for (const arrow of roundArrows) {
      const bucket = byRound.get(arrow.roundId) ?? [];
      bucket.push(arrow);
      byRound.set(arrow.roundId, bucket);
    }

    return {
      ...session,
      rounds: sessionRounds.map((round) => ({
        ...round,
        arrows: byRound.get(round.id) ?? [],
      })),
    };
  });

  /**
   * Create a session, optionally with its whole sub-tree in one call.
   *
   * The nested form is what makes offline capture cheap: a session recorded at
   * the range is one request when the phone finds signal, not one per arrow.
   * The whole thing is a single transaction, so a partial session never lands.
   */
  app.post('/sessions', async (request, reply) => {
    const body = sessionInput.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const { rounds: roundPayload, distanceM, ...session } = body.data;

    if (
      session.gearProfileId &&
      !(await ownsGearProfile(session.gearProfileId, request.userId))
    ) {
      return reply.code(400).send({ error: 'Unknown gear profile' });
    }

    const visible = await visibleTargetIds(
      (roundPayload ?? []).map((r) => r.targetId),
      request.userId,
    );
    const unknownTarget = (roundPayload ?? []).find(
      (r) => !visible.has(r.targetId),
    );
    if (unknownTarget) {
      return reply.code(400).send({ error: 'Unknown target' });
    }

    try {
      const created = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(sessions)
          .values({
            ...session,
            distanceM: distanceM ?? null,
            ownerId: request.userId,
            syncStatus: 'synced',
          })
          .returning();

        if (!roundPayload?.length) return { ...inserted[0]!, rounds: [] };

        const insertedRounds = await tx
          .insert(rounds)
          .values(
            roundPayload.map((r) => ({
              id: r.id,
              sessionId: session.id,
              targetId: r.targetId,
              roundOrder: r.roundOrder,
              photoKey: r.photoKey ?? null,
              syncStatus: 'synced' as const,
            })),
          )
          .returning();

        const arrowRows = roundPayload.flatMap((r) =>
          (r.arrows ?? []).map((a) => ({
            id: a.id,
            roundId: r.id,
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
            shotOrder: a.shotOrder ?? null,
          })),
        );

        const insertedArrows = arrowRows.length
          ? await tx.insert(arrows).values(arrowRows).returning()
          : [];

        const byRound = new Map<string, typeof insertedArrows>();
        for (const arrow of insertedArrows) {
          const bucket = byRound.get(arrow.roundId) ?? [];
          bucket.push(arrow);
          byRound.set(arrow.roundId, bucket);
        }

        return {
          ...inserted[0]!,
          rounds: insertedRounds.map((r) => ({
            ...r,
            arrows: byRound.get(r.id) ?? [],
          })),
        };
      });

      return reply.code(201).send(created);
    } catch (error) {
      // A resent id, or two rounds claiming the same order in one session. The
      // offline client retries, so this is a normal thing to receive.
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'Already exists' });
      }
      throw error;
    }
  });

  app.patch('/sessions/:id', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = sessionInput
      .partial()
      .omit({ id: true, rounds: true })
      .safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const { distanceM, ...fields } = body.data;

    if (
      fields.gearProfileId &&
      !(await ownsGearProfile(fields.gearProfileId, request.userId))
    ) {
      return reply.code(400).send({ error: 'Unknown gear profile' });
    }

    const updated = await db
      .update(sessions)
      .set({
        ...fields,
        ...(distanceM === undefined ? {} : { distanceM }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sessions.id, params.data.id),
          eq(sessions.ownerId, request.userId),
        ),
      )
      .returning();

    if (!updated[0]) return reply.code(404).send({ error: 'Not found' });
    return updated[0];
  });

  app.delete('/sessions/:id', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    // Rounds and arrows go with it via ON DELETE CASCADE in the schema.
    const deleted = await db
      .delete(sessions)
      .where(
        and(
          eq(sessions.id, params.data.id),
          eq(sessions.ownerId, request.userId),
        ),
      )
      .returning({ id: sessions.id });

    if (!deleted[0]) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });

  app.post('/sessions/:id/rounds', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = roundInput.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const owns = await ownsSession(params.data.id, request.userId);
    if (!owns) return reply.code(404).send({ error: 'Not found' });

    const visible = await visibleTargetIds(
      [body.data.targetId],
      request.userId,
    );
    if (!visible.has(body.data.targetId)) {
      return reply.code(400).send({ error: 'Unknown target' });
    }

    try {
      const created = await db
        .insert(rounds)
        .values({
          id: body.data.id,
          sessionId: params.data.id,
          targetId: body.data.targetId,
          roundOrder: body.data.roundOrder,
          photoKey: body.data.photoKey ?? null,
          syncStatus: 'synced',
        })
        .returning();

      return reply.code(201).send(created[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'Already exists' });
      }
      throw error;
    }
  });

  /**
   * Replace a round's arrows wholesale.
   *
   * The marking screen is a canvas the archer adds to, drags and clears, so
   * "here is the current set" is both what the client naturally has and the
   * only formulation that cannot drift out of step with what is on screen.
   */
  app.put('/rounds/:id/arrows', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = z
      .object({ arrows: z.array(arrowInput).max(MAX_ARROWS_PER_ROUND) })
      .safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const owned = await db
      .select({ id: rounds.id })
      .from(rounds)
      .innerJoin(sessions, eq(rounds.sessionId, sessions.id))
      .where(
        and(
          eq(rounds.id, params.data.id),
          eq(sessions.ownerId, request.userId),
        ),
      )
      .limit(1);

    if (!owned[0]) return reply.code(404).send({ error: 'Not found' });

    const result = await db.transaction(async (tx) => {
      await tx.delete(arrows).where(eq(arrows.roundId, params.data.id));

      if (body.data.arrows.length === 0) return [];

      return tx
        .insert(arrows)
        .values(
          body.data.arrows.map((a) => ({
            id: a.id,
            roundId: params.data.id,
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
            shotOrder: a.shotOrder ?? null,
          })),
        )
        .returning();
    });

    return { arrows: result };
  });

  app.delete('/rounds/:id', async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const owned = await db
      .select({ id: rounds.id })
      .from(rounds)
      .innerJoin(sessions, eq(rounds.sessionId, sessions.id))
      .where(
        and(
          eq(rounds.id, params.data.id),
          eq(sessions.ownerId, request.userId),
        ),
      )
      .limit(1);

    if (!owned[0]) return reply.code(404).send({ error: 'Not found' });

    await db.delete(rounds).where(eq(rounds.id, params.data.id));
    return reply.code(204).send();
  });
}

async function ownsSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.ownerId, userId)))
    .limit(1);

  return rows.length > 0;
}

/**
 * Which of these target ids the caller is allowed to reference: shared presets
 * and their own custom faces.
 *
 * A round's target_id was passed straight to the insert. Two things followed
 * from that. A random uuid failed the foreign key and surfaced as a 500 — an
 * error the caller caused being reported as our fault. And a *real* id
 * belonging to another user was accepted, quietly attaching that user's private
 * face to this user's round, which is a reference nobody should be able to
 * create by guessing.
 */
async function visibleTargetIds(
  ids: readonly string[],
  userId: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await db
    .select({ id: targets.id })
    .from(targets)
    .where(
      and(
        inArray(targets.id, [...new Set(ids)]),
        or(isNull(targets.ownerId), eq(targets.ownerId, userId)),
      ),
    );

  return new Set(rows.map((r) => r.id));
}

/** Same reasoning as visibleTargetIds, for a session's gear profile. */
async function ownsGearProfile(
  gearProfileId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: gearProfiles.id })
    .from(gearProfiles)
    .where(
      and(eq(gearProfiles.id, gearProfileId), eq(gearProfiles.ownerId, userId)),
    )
    .limit(1);

  return rows.length > 0;
}
