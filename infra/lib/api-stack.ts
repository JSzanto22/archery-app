/**
 * The API: one Lambda behind an HTTP API.
 *
 * `backend/src/lambda.ts` already builds the Fastify app at module scope, so a
 * warm container reuses both the app and the connection pool. Everything here
 * is packaging and wiring.
 *
 * Authentication happens at the gateway. The JWT authorizer verifies the
 * Cognito access token before the function is ever invoked, which is what lets
 * the Lambda sit in a VPC with no internet access — in-app verification would
 * need to reach Cognito's JWKS endpoint, and that would mean a NAT gateway at
 * $32/month. See docs/lambda-deployment-assessment.md, option B.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_cognito as cognito,
  aws_ec2 as ec2,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { type EnvConfig, resourceName } from './config.js';

export interface ApiStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly vpc: ec2.IVpc;
  readonly securityGroup: ec2.ISecurityGroup;
  readonly proxy: rds.IDatabaseProxy;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly photoBucket: s3.IBucket;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
}

const BACKEND_ROOT = join(import.meta.dirname, '..', '..', 'backend');

/**
 * Where the RDS certificate bundle sits once `npm run fetch:rds-ca` has run in
 * the backend package. Not committed — see backend/scripts/fetch-rds-ca.mjs.
 */
const CA_BUNDLE_SOURCE = join(BACKEND_ROOT, 'certs', 'rds-global-bundle.pem');
const CA_BUNDLE_FILENAME = 'rds-global-bundle.pem';

/** Backslashes inside a quoted JavaScript string literal are escapes. */
function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;

    /*
     * Fail at synth if the certificate bundle is missing.
     *
     * Without it the function starts, connects, and fails TLS verification on
     * the first request — an outage that looks like a database problem. A
     * missing build step should break the build.
     */
    if (!existsSync(CA_BUNDLE_SOURCE)) {
      throw new Error(
        `Missing ${CA_BUNDLE_SOURCE}.\n` +
          'Run `npm run fetch:rds-ca --prefix backend` first: the deployed ' +
          'function has no internet access, so the RDS CA bundle has to be ' +
          'baked into the artifact at build time.',
      );
    }

    const handler = new nodejs.NodejsFunction(this, 'ApiFunction', {
      functionName: resourceName(config, 'api'),
      entry: join(BACKEND_ROOT, 'src', 'lambda.ts'),
      handler: 'handler',

      // The function's source lives in a sibling package, not under this one.
      // Both are needed or CDK looks for them relative to infra/ and either
      // refuses the entry point or bundles against the wrong lockfile.
      projectRoot: BACKEND_ROOT,
      depsLockFilePath: join(BACKEND_ROOT, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,

      /*
       * 1024 MB is not about memory.
       *
       * Lambda scales CPU with memory, and this function's slow part is the
       * cold start — parsing the bundle, building Fastify, opening a pooled
       * connection. More CPU shortens that for every archer whose sync lands
       * on a cold container, and the extra cost is negligible because the
       * function runs for milliseconds.
       */
      memorySize: 1024,
      // Comfortably above the slowest real request (a first sync pushing a
      // season of history) and well below API Gateway's own 30s ceiling.
      timeout: Duration.seconds(25),

      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroup],

      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,

        /*
         * `pg` is bundled rather than externalised so there is one artifact
         * with no install step at deploy. The AWS SDK is bundled too: the
         * runtime ships v3, but pinning our own version means a runtime
         * upgrade cannot change SDK behaviour underneath us.
         */
        externalModules: [],

        // Top-level await in lambda.ts needs ESM, and esbuild's CJS shims
        // (`require`, `__dirname`) are absent in ESM output. Only `pg` needs
        // them, and only on paths we do not take.
        banner:
          "import{createRequire}from'module';const require=createRequire(import.meta.url);",

        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          /*
           * The bundle is code only; the certificate is data and has to be
           * copied in beside it.
           *
           * `inputDir` is projectRoot — the backend package — so the path is
           * relative to that. Written as a node one-liner rather than `cp`
           * because this command runs on whatever shell the build machine has,
           * and that is `cmd.exe` on Windows.
           */
          afterBundling: (inputDir: string, outputDir: string) => [
            `node -e "require('fs').copyFileSync('${posix(inputDir)}/certs/${CA_BUNDLE_FILENAME}', '${posix(outputDir)}/${CA_BUNDLE_FILENAME}')"`,
          ],
        },
      },

      environment: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--enable-source-maps',

        // Host and user only. The password is an IAM token minted per
        // connection from the function's own role, so none appears here.
        DATABASE_URL: `postgresql://${props.databaseUser}@${props.proxy.endpoint}:5432/${props.databaseName}`,
        DB_IAM_AUTH: 'true',
        DB_CA_BUNDLE_PATH: `/var/task/${CA_BUNDLE_FILENAME}`,

        S3_BUCKET: props.photoBucket.bucketName,
        PRESIGNED_URL_TTL_SECONDS: '900',

        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,

        CORS_ALLOWED_ORIGINS: config.corsAllowedOrigins.join(','),

        // AWS_REGION is reserved and set by the runtime; env.ts reads it from
        // there. Setting it here would be rejected at deploy.
      },

      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        logGroupName: `/aws/lambda/${resourceName(config, 'api')}`,
        retention: config.logRetentionDays,
        removalPolicy: config.removalPolicy,
      }),
    });

    // rds-db:connect on this proxy, for this user only. The token the signer
    // mints is worthless without it.
    props.proxy.grantConnect(handler, props.databaseUser);

    /*
     * Read and write, but only under the per-user prefix scheme.
     *
     * The function signs every URL, so its own permissions are the real
     * ceiling on what any signed URL can reach. Keys are derived in
     * backend/src/storageKeys.ts as `u/{userId}/rounds/{roundId}/original.jpg`;
     * scoping the grant to `u/*` means a bug that produced a key outside that
     * space would fail rather than sign.
     */
    props.photoBucket.grantReadWrite(handler, 'u/*');

    /*
     * The JWT authorizer.
     *
     * This is the only thing verifying tokens in production. It checks
     * signature, expiry, issuer and audience against the pool before the
     * function runs, so an unauthenticated request never reaches our code and
     * never costs an invocation.
     */
    const authorizer = new authorizers.HttpUserPoolAuthorizer(
      'CognitoAuthorizer',
      props.userPool,
      {
        userPoolClients: [props.userPoolClient],
        identitySource: ['$request.header.Authorization'],
      },
    );

    const api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: resourceName(config, 'api'),
      // Everything not matched below requires a token.
      defaultAuthorizer: authorizer,
      defaultIntegration: new integrations.HttpLambdaIntegration(
        'DefaultIntegration',
        handler,
      ),

      /*
       * CORS at the gateway rather than in the app.
       *
       * A React Native client sends no Origin header and is unaffected either
       * way. In production the list is empty, so no browser may call this API
       * with a user's token — which is the entire point.
       */
      ...(config.corsAllowedOrigins.length > 0
        ? {
            corsPreflight: {
              allowOrigins: [...config.corsAllowedOrigins],
              allowMethods: [apigw.CorsHttpMethod.ANY],
              allowHeaders: ['Authorization', 'Content-Type'],
              maxAge: Duration.hours(1),
            },
          }
        : {}),
    });

    /*
     * /health, unauthenticated.
     *
     * A health check that needs a token cannot tell a load balancer or an
     * uptime monitor whether the service is up. Declared explicitly so it is
     * the single documented hole in the authorizer rather than an accident of
     * configuration.
     */
    api.addRoutes({
      path: '/health',
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'HealthIntegration',
        handler,
      ),
      authorizer: new apigw.HttpNoneAuthorizer(),
    });

    new CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      description: 'Base URL for the mobile app',
    });
  }
}
