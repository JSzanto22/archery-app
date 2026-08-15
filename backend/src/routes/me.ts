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
  app.get('/me', async (request, reply) => {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (existing[0]) return existing[0];

    const created = await db
      .insert(users)
      .values({
        id: request.userId,
        // The verified token's claim, never a header. Absent on most Cognito
        // pools, so the placeholder keeps the NOT NULL satisfied — and keeps
        // the row unambiguously ours rather than squatting on an address the
        // caller merely typed.
        email: request.userEmail ?? `${request.userId}@placeholder.invalid`,
      })
      .onConflictDoNothing()
      .returning();

    if (created[0]) return created[0];

    /*
     * The insert did nothing, so something already occupies the id or the
     * email. Re-read rather than returning `created[0] ?? existing[0]`, which
     * was `undefined ?? undefined` — an empty 200 body that the app parsed as
     * a profile with no fields.
     *
     * Two ways to get here: a concurrent first request from the user's other
     * device (the row now exists and this returns it), or an email collision
     * with a different account, which is a conflict we cannot resolve for them.
     */
    const afterConflict = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (afterConflict[0]) return afterConflict[0];

    request.log.error(
      { userId: request.userId },
      'user row could not be created: email already belongs to another account',
    );
    return reply.code(409).send({ error: 'Could not create profile' });
  });

  app.patch('/me', async (request, reply) => {
    const body = patchBody.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
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
