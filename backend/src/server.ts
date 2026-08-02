/**
 * Local HTTP entry point.
 *
 * Running the same Fastify app as a plain server is the reason for the
 * single-Lambda shape: local development needs no AWS, no emulator and no
 * deploy — just `npm run dev` against the Docker Postgres.
 */

// Must come first: env.ts validates process.env at module load, and ESM
// evaluates imports in declaration order. Local only — in Lambda the values
// come from the function's own configuration, and there is no .env to read.
import 'dotenv/config';

import { buildApp } from './app.js';
import { closeDatabase } from './db/client.js';
import { env } from './env.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDatabase();
    process.exit(0);
  });
}
