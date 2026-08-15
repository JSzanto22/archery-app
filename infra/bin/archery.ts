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

import { AuthStack } from '../lib/auth-stack.js';
import { resolveEnv } from '../lib/config.js';
import { StorageStack } from '../lib/storage-stack.js';

const app = new App();
const config = resolveEnv(app);

/*
 * Account and region come from the ambient CLI credentials.
 *
 * Left unspecified, CDK would build environment-agnostic templates, which
 * cannot look up an availability zone and quietly produce a two-AZ VPC using
 * dummy zone names. Binding them here makes a deploy to the wrong account fail
 * loudly instead.
 */
const account = process.env['CDK_DEFAULT_ACCOUNT'];

const envBinding = {
  ...(account === undefined ? {} : { account }),
  region: process.env['CDK_DEFAULT_REGION'] ?? 'eu-west-2',
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

// Tags land on every resource in every stack, which is what makes the bill
// legible later: "what is dev costing me" is otherwise unanswerable once two
// environments share an account.
for (const stack of [auth, storage]) {
  Tags.of(stack).add('Application', 'archery-app');
  Tags.of(stack).add('Environment', config.name);
  Tags.of(stack).add('ManagedBy', 'cdk');
}
