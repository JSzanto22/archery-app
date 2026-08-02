/**
 * Lambda entry point.
 *
 * The app is built once at module scope, outside the handler, so a warm
 * container reuses both the Fastify instance and the Postgres pool. Building
 * inside the handler would re-register every route and open a fresh connection
 * on every request.
 */

import awsLambdaFastify from '@fastify/aws-lambda';

import { buildApp } from './app.js';

const app = await buildApp();
await app.ready();

export const handler = awsLambdaFastify(app);
