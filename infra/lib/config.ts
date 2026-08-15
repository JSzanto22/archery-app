/**
 * Per-environment settings.
 *
 * Every difference between dev and production lives here rather than being
 * scattered through the stacks as `if (isProd)`. Reading one table is how you
 * answer "what is actually different about production?" without trusting that
 * someone remembered to branch in all six places.
 *
 * Selected with `cdk deploy -c env=prod`; dev is the default so that the
 * dangerous one has to be asked for by name.
 */

import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export type EnvName = 'dev' | 'prod';

export interface EnvConfig {
  readonly name: EnvName;

  /**
   * Whether teardown destroys data.
   *
   * Dev stacks are meant to be thrown away; production keeps its database and
   * its photos even if the stack is deleted, because `cdk destroy` on the
   * wrong terminal should not be able to end the business.
   */
  readonly removalPolicy: RemovalPolicy;

  /** Deletion protection on RDS and the Cognito pool. */
  readonly protectResources: boolean;

  /** How long CloudWatch keeps logs. Dev is short; logs cost money. */
  readonly logRetentionDays: number;

  /** RDS instance size. t4g.micro is ~$12/mo and ample for MVP traffic. */
  readonly databaseInstanceClass: string;

  /**
   * Availability zones for the VPC.
   *
   * Two is the minimum RDS accepts for a subnet group, even for a
   * single-instance deployment.
   */
  readonly availabilityZones: number;

  /** Multi-AZ RDS failover. Roughly doubles the database bill. */
  readonly databaseMultiAz: boolean;

  /** Automated backup retention. Zero disables backups entirely. */
  readonly backupRetention: Duration;

  /**
   * Browser origins allowed to call the API.
   *
   * The React Native client sends no Origin header and is unaffected. This
   * exists for the Expo web preview in dev, and is empty in production
   * because there is no browser client.
   */
  readonly corsAllowedOrigins: readonly string[];
}

const configs: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    removalPolicy: RemovalPolicy.DESTROY,
    protectResources: false,
    logRetentionDays: 7,
    databaseInstanceClass: 't4g.micro',
    availabilityZones: 2,
    databaseMultiAz: false,
    backupRetention: Duration.days(1),
    corsAllowedOrigins: ['http://localhost:8081', 'http://localhost:19006'],
  },
  prod: {
    name: 'prod',
    removalPolicy: RemovalPolicy.RETAIN,
    protectResources: true,
    logRetentionDays: 90,
    databaseInstanceClass: 't4g.micro',
    availabilityZones: 2,
    databaseMultiAz: false,
    backupRetention: Duration.days(14),
    corsAllowedOrigins: [],
  },
};

/**
 * Resolve the target environment from CDK context.
 *
 * Throws on an unrecognised name rather than falling back to dev: a typo in
 * `-c env=prd` that silently deployed dev settings to the production account
 * would be discovered by an outage.
 */
export function resolveEnv(scope: Construct): EnvConfig {
  const requested = scope.node.tryGetContext('env') as unknown;

  if (requested === undefined) return configs.dev;

  if (requested !== 'dev' && requested !== 'prod') {
    throw new Error(
      `Unknown environment ${JSON.stringify(requested)}. Use -c env=dev or -c env=prod.`,
    );
  }

  return configs[requested];
}

/** Prefix for every resource name, so two environments can share an account. */
export function resourceName(env: EnvConfig, suffix: string): string {
  return `archery-${env.name}-${suffix}`;
}
