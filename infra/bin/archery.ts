#!/usr/bin/env node
/**
 * CDK app entry point.
 *
 * Stacks are split by lifecycle rather than by service. The database and the
 * photo bucket outlive every deploy of the API; separating them means routine
 * application deploys cannot roll back a change to durable state, and a
 * mistake in the API stack cannot take the data with it.
 *
 * Deploy with:
 *   npm run deploy -- -c env=dev
 */

import { App, Tags } from 'aws-cdk-lib';

import { ApiStack } from '../lib/api-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { resolveEnv, resolveRegion } from '../lib/config.js';
import { DataStack } from '../lib/data-stack.js';
import { StorageStack } from '../lib/storage-stack.js';

const app = new App();
const config = resolveEnv(app);

/*
 * The account comes from the ambient CLI credentials; the region does not.
 *
 * Binding the account here means a deploy to the wrong one fails loudly rather
 * than building environment-agnostic templates. The region is deliberately
 * *not* taken from CDK_DEFAULT_REGION: the CDK CLI sets that itself, so a
 * fallback in application code never runs, and an unconfigured machine
 * silently deploys to us-east-1. It lives in config.ts instead.
 */
const account = process.env['CDK_DEFAULT_ACCOUNT'];

const envBinding = {
  ...(account === undefined ? {} : { account }),
  region: resolveRegion(app, config),
};

const auth = new AuthStack(app, `Archery-${config.name}-Auth`, {
  config,
  env: envBinding,
  description: 'Cognito user pool and mobile app client',
});

const storage = new StorageStack(app, `Archery-${config.name}-Storage`, {
  config,
  env: envBinding,
  description: 'S3 bucket for round photos',
});

const data = new DataStack(app, `Archery-${config.name}-Data`, {
  config,
  env: envBinding,
  description: 'VPC, Postgres and RDS Proxy',
});

/*
 * The API stack is the only one that depends on the others, and it holds no
 * state of its own — so it is the one that gets deployed often, and the only
 * one a routine release touches.
 */
const api = new ApiStack(app, `Archery-${config.name}-Api`, {
  config,
  env: envBinding,
  description: 'Lambda and HTTP API',
  vpc: data.vpc,
  securityGroup: data.lambdaSecurityGroup,
  proxy: data.proxy,
  databaseName: data.databaseName,
  databaseUser: data.databaseUser,
  photoBucket: storage.photoBucket,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

// Tags land on every resource in every stack, which is what makes the bill
// legible later: "what is dev costing me" is otherwise unanswerable once two
// environments share an account.
for (const stack of [auth, storage, data, api]) {
  Tags.of(stack).add('Application', 'archery-app');
  Tags.of(stack).add('Environment', config.name);
  Tags.of(stack).add('ManagedBy', 'cdk');
}
