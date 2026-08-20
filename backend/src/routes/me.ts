import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { ensureProfile, placeholderEmail } from '../profile.js';

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

    // Shared with /sync/push, which needs the same row to exist before it can
    // write anything that references it. The email is the verified token's
    // claim, never a header — see profile.ts.
    await ensureProfile(db, request.userId, request.userEmail);

    /*
     * Read back rather than trusting the insert's RETURNING.
     *
     * `onConflictDoNothing` returns nothing when the row already existed, and
     * this used to end in `created[0] ?? existing[0]` — both undefined on that
     * path, so the response was an empty 200 body that the app parsed as a
     * profile with no fields. A concurrent first request from the archer's
     * other device is enough to reach it.
     */
    const afterConflict = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (afterConflict[0]) return afterConflict[0];

    request.log.error(
      { userId: request.userId, placeholder: placeholderEmail(request.userId) },
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
