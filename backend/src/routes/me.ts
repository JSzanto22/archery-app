import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

const patchBody = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  researchConsent: z.boolean().optional(),
});

export default async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The users row is created on first call rather than by a signup webhook.
   *
   * Cognito owns identity, and it can mint a user without ever telling us. If
   * the profile row only appeared via a webhook, a dropped delivery would leave
   * an account that can authenticate but has nowhere to store data.
   */
  app.get('/me', async (request) => {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (existing[0]) return existing[0];

    const email = (request.headers['x-user-email'] as string | undefined) ?? null;

    const created = await db
      .insert(users)
      .values({
        id: request.userId,
        // Cognito's email claim is the real source; this fallback keeps the
        // NOT NULL satisfied when the claim is absent (dev bypass, or a pool
        // configured without email scope).
        email: email ?? `${request.userId}@placeholder.invalid`,
      })
      .onConflictDoNothing()
      .returning();

    return created[0] ?? existing[0];
  });

  app.patch('/me', async (request, reply) => {
    const body = patchBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', detail: body.error.issues });
    }

    const updated = await db
      .update(users)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(users.id, request.userId))
      .returning();

    if (!updated[0]) return reply.code(404).send({ error: 'User not found' });
    return updated[0];
  });
}
