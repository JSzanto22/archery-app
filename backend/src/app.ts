import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { env } from './env.js';
import gearRoutes from './routes/gear.js';
import meRoutes from './routes/me.js';
import photoRoutes from './routes/photos.js';
import sessionRoutes from './routes/sessions.js';
import syncRoutes from './routes/sync.js';
import targetRoutes from './routes/targets.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      // Never log a token or an email. CloudWatch retains logs far longer than
      // a credential stays valid.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // API Gateway already imposes limits; this stops a runaway client from
    // parsing a huge body before Fastify has a chance to reject it.
    bodyLimit: 8 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  // Unauthenticated by design: a health check that needs a token cannot tell a
  // load balancer whether the service is up.
  app.get('/health', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
  }));

  await app.register(meRoutes);
  await app.register(gearRoutes);
  await app.register(targetRoutes);
  await app.register(sessionRoutes);
  await app.register(photoRoutes);
  await app.register(syncRoutes);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');

    const status = error.statusCode ?? 500;

    // Internal messages can carry SQL fragments and column names. Clients get
    // a generic message; the detail stays in the log.
    reply.code(status).send({
      error: status >= 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}
