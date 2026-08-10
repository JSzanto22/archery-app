/**
 * Pre-signed S3 URLs for round photos.
 *
 * The image bytes never pass through this Lambda. The app uploads straight to
 * S3 with a short-lived signed PUT, then PATCHes the round with the returned
 * key. Proxying uploads through Lambda would cost payload limits, memory and
 * latency for no benefit.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth.js';
import { db } from '../db/client.js';
import { rounds, sessions } from '../db/schema.js';
import { env } from '../env.js';

/**
 * In AWS this is a plain client: the region comes from config and credentials
 * from the function's IAM role. Locally it is pointed at MinIO, which needs an
 * explicit endpoint, static credentials, and path-style addressing — MinIO
 * serves `host/bucket/key` rather than the virtual-host form AWS uses.
 */
const s3 = env.S3_BUCKET
  ? new S3Client({
      region: env.AWS_REGION,
      ...(env.S3_ENDPOINT
        ? {
            endpoint: env.S3_ENDPOINT,
            forcePathStyle: true,
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY ?? '',
              secretAccessKey: env.S3_SECRET_KEY ?? '',
            },
          }
        : {}),
    })
  : null;

const params = z.object({ id: z.string().uuid() });

export default async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/rounds/:id/photo-url', async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid id' });
    if (!s3 || !env.S3_BUCKET) {
      return reply.code(503).send({ error: 'Photo storage is not configured' });
    }

    const round = await findOwnedRound(parsed.data.id, request.userId);
    if (!round) return reply.code(404).send({ error: 'Not found' });

    // The key embeds the owner so a bucket policy can scope access by prefix,
    // and so an object is traceable to a user without a database lookup.
    const key = `u/${request.userId}/rounds/${round.id}/original.jpg`;

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: 'image/jpeg',
      }),
      { expiresIn: env.PRESIGNED_URL_TTL_SECONDS },
    );

    return {
      uploadUrl: url,
      photoKey: key,
      expiresIn: env.PRESIGNED_URL_TTL_SECONDS,
    };
  });

  app.get('/rounds/:id/photo-url', async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid id' });
    if (!s3 || !env.S3_BUCKET) {
      return reply.code(503).send({ error: 'Photo storage is not configured' });
    }

    const round = await findOwnedRound(parsed.data.id, request.userId);
    if (!round) return reply.code(404).send({ error: 'Not found' });
    if (!round.photoKey)
      return reply.code(404).send({ error: 'No photo for this round' });

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: round.photoKey }),
      { expiresIn: env.PRESIGNED_URL_TTL_SECONDS },
    );

    return { url, expiresIn: env.PRESIGNED_URL_TTL_SECONDS };
  });

  app.patch('/rounds/:id', async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid id' });

    const body = z
      .object({
        targetId: z.string().uuid().optional(),
        roundOrder: z.number().int().min(0).optional(),
        photoKey: z.string().max(1024).nullable().optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid body', detail: body.error.issues });
    }

    const round = await findOwnedRound(parsed.data.id, request.userId);
    if (!round) return reply.code(404).send({ error: 'Not found' });

    const updated = await db
      .update(rounds)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(rounds.id, parsed.data.id))
      .returning();

    return updated[0];
  });
}

async function findOwnedRound(roundId: string, userId: string) {
  const rows = await db
    .select({ id: rounds.id, photoKey: rounds.photoKey })
    .from(rounds)
    .innerJoin(sessions, eq(rounds.sessionId, sessions.id))
    .where(and(eq(rounds.id, roundId), eq(sessions.ownerId, userId)))
    .limit(1);

  return rows[0] ?? null;
}
