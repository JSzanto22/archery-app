import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { targetZones, targets } from '../db/schema.js';

const zoneInput = z.object({
  id: z.string().uuid(),
  zoneIndex: z.number().int().min(0),
  scoreValue: z.number().int().min(0),
  shapeType: z.enum(['circle', 'ellipse', 'rectangle', 'polygon']),
  shapeParams: z.record(z.unknown()),
});

const createBody = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  baseShape: z.enum(['circle', 'rectangle', 'silhouette', 'freeform']).nullable().optional(),
  /** faceWidth / faceHeight. Rejected at zero — it divides in the client. */
  aspectRatio: z.number().positive().max(100).nullable().optional(),
  /** Physical width in centimetres. A face wider than 5 m is a typo. */
  faceWidthCm: z.number().positive().max(500).nullable().optional(),
  zones: z.array(zoneInput).min(1),
});

export default async function targetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Shared presets (owner NULL) plus this user's custom targets, with zones. */
  app.get('/targets', async (request) => {
    const rows = await db
      .select()
      .from(targets)
      .where(or(isNull(targets.ownerId), eq(targets.ownerId, request.userId)));

    if (rows.length === 0) return [];

    // One query for all zones rather than one per target: the library screen
    // loads every face at once, and per-target queries would make it N+1.
    const zones = await db
      .select()
      .from(targetZones)
      .where(
        inArray(
          targetZones.targetId,
          rows.map((t) => t.id),
        ),
      );

    const byTarget = new Map<string, typeof zones>();
    for (const zone of zones) {
      const bucket = byTarget.get(zone.targetId) ?? [];
      bucket.push(zone);
      byTarget.set(zone.targetId, bucket);
    }

    return rows.map((target) => ({
      ...target,
      zones: (byTarget.get(target.id) ?? []).sort(
        (a, b) => a.zoneIndex - b.zoneIndex,
      ),
    }));
  });

  app.get('/targets/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const rows = await db
      .select()
      .from(targets)
      .where(
        and(
          eq(targets.id, params.data.id),
          or(isNull(targets.ownerId), eq(targets.ownerId, request.userId)),
        ),
      )
      .limit(1);

    const target = rows[0];
    if (!target) return reply.code(404).send({ error: 'Not found' });

    const zones = await db
      .select()
      .from(targetZones)
      .where(eq(targetZones.targetId, target.id));

    return {
      ...target,
      zones: zones.sort((a, b) => a.zoneIndex - b.zoneIndex),
    };
  });

  app.post('/targets', async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    const { zones, aspectRatio, faceWidthCm, ...target } = body.data;

    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(targets)
        .values({
          ...target,
          aspectRatio: aspectRatio ?? null,
          faceWidthCm: faceWidthCm ?? null,
          ownerId: request.userId,
          // Always 'custom' here. The only way to create a preset is a seed
          // script, because presets are shared by every user.
          type: 'custom',
        })
        .returning();

      const insertedZones = await tx
        .insert(targetZones)
        .values(zones.map((z) => ({ ...z, targetId: target.id })))
        .returning();

      return { ...inserted[0]!, zones: insertedZones };
    });

    return reply.code(201).send(created);
  });

  app.patch('/targets/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = createBody.partial().omit({ id: true }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    const { zones, aspectRatio, faceWidthCm, ...rest } = body.data;

    const fields = {
      ...rest,
      ...(aspectRatio === undefined ? {} : { aspectRatio }),
      ...(faceWidthCm === undefined ? {} : { faceWidthCm }),
    };

    // eq(ownerId, userId) is what stops a user editing a preset: presets have a
    // NULL owner and never match.
    const owned = await db
      .select({ id: targets.id })
      .from(targets)
      .where(
        and(eq(targets.id, params.data.id), eq(targets.ownerId, request.userId)),
      )
      .limit(1);

    if (!owned[0]) return reply.code(404).send({ error: 'Not found' });

    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(targets)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(targets.id, params.data.id))
        .returning();

      if (!zones) return { ...updated[0]!, zones: undefined };

      // Replace wholesale. Diffing zone-by-zone would need stable identity for
      // a shape the builder lets you drag, split and delete freely; replacing
      // is both simpler and matches what the editor actually produces.
      await tx.delete(targetZones).where(eq(targetZones.targetId, params.data.id));

      const newZones = await tx
        .insert(targetZones)
        .values(zones.map((z) => ({ ...z, targetId: params.data.id })))
        .returning();

      return { ...updated[0]!, zones: newZones };
    });

    return result;
  });

  app.delete('/targets/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    try {
      const deleted = await db
        .delete(targets)
        .where(
          and(
            eq(targets.id, params.data.id),
            eq(targets.ownerId, request.userId),
          ),
        )
        .returning({ id: targets.id });

      if (!deleted[0]) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    } catch (error) {
      // rounds.target_id is ON DELETE RESTRICT, so a face with shot history
      // cannot be removed. That is a 409, not a 500.
      if (isForeignKeyViolation(error)) {
        return reply.code(409).send({
          error: 'Target is still used by recorded rounds and cannot be deleted.',
        });
      }
      throw error;
    }
  });
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23503'
  );
}
