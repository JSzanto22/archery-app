import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { gearProfiles } from '../db/schema.js';

const createBody = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  bowType: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const patchBody = createBody.partial().omit({ id: true });

export default async function gearRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/gear', async (request) =>
    db
      .select()
      .from(gearProfiles)
      .where(eq(gearProfiles.ownerId, request.userId)),
  );

  app.post('/gear', async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    // ownerId comes from the token. A client-supplied owner would let anyone
    // write rows into someone else's account.
    const created = await db
      .insert(gearProfiles)
      .values({ ...body.data, ownerId: request.userId })
      .returning();

    return reply.code(201).send(created[0]);
  });

  app.patch('/gear/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = patchBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    const updated = await db
      .update(gearProfiles)
      .set({ ...body.data, updatedAt: new Date() })
      .where(
        and(
          eq(gearProfiles.id, params.data.id),
          eq(gearProfiles.ownerId, request.userId),
        ),
      )
      .returning();

    // 404 rather than 403 when the row belongs to someone else: a 403 would
    // confirm the id exists, which is information the caller has no right to.
    if (!updated[0]) return reply.code(404).send({ error: 'Not found' });
    return updated[0];
  });

  app.delete('/gear/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });

    const deleted = await db
      .delete(gearProfiles)
      .where(
        and(
          eq(gearProfiles.id, params.data.id),
          eq(gearProfiles.ownerId, request.userId),
        ),
      )
      .returning({ id: gearProfiles.id });

    if (!deleted[0]) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });
}
