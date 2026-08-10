import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { arrows, rounds, sessions } from '../db/schema.js';

const arrowInput = z.object({
  id: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scoreValue: z.number().int().min(0),
  shotOrder: z.number().int().positive().nullable().optional(),
});

const roundInput = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  roundOrder: z.number().int().min(0),
  photoKey: z.string().max(1024).nullable().optional(),
  arrows: z.array(arrowInput).optional(),
});

const sessionInput = z.object({
  id: z.string().uuid(),
  shotAt: z.coerce.date(),
  distanceM: z.number().positive().nullable().optional(),
  gearProfileId: z.string().uuid().nullable().optional(),
  equipmentTag: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  rounds: z.array(roundInput).optional(),
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
      .object({ arrows: z.array(arrowInput) })
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
