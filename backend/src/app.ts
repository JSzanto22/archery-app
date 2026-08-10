import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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

  await app.register(helmet, {
    // The API serves JSON to a native app, never HTML to a browser, so the
    // script-oriented CSP directives have nothing to protect and only risk
    // breaking a future docs route.
    contentSecurityPolicy: false,
  });

  /*
   * CORS.
   *
   * A React Native app sends no Origin header, so it is unaffected either way;
   * this is entirely about what a browser is allowed to do with a user's
   * token. `origin: true` reflected whatever asked, which meant any site could
   * call the API from a victim's browser. Development keeps that latitude for
   * the Expo web preview; production is an explicit allowlist, empty by
   * default.
   */
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? (allowedOrigins ?? false) : true,
  });

  /*
   * Rate limiting.
   *
   * Keyed on the authenticated user where there is one, falling back to IP —
   * behind API Gateway every request arrives from a small set of addresses, so
   * an IP-only limit would have one heavy syncer throttle everyone else.
   *
   * The ceiling is generous because the expensive endpoint is /sync/push,
   * which a device calls a handful of times a day, not per interaction.
   */
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.userId ?? request.ip,
    // A health check that can be rate-limited cannot report health.
    allowList: (request) => request.url === '/health',
  });

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
