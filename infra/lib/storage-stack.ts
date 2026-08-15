/**
 * S3 bucket for round photos.
 *
 * Image bytes never pass through the API. The app uploads straight to S3 with
 * a short-lived pre-signed PUT and reads back through a pre-signed GET, which
 * is why this bucket can stay completely closed to the public while still
 * serving a mobile client.
 *
 * Object keys are `u/{userId}/rounds/{roundId}/original.jpg`, derived
 * server-side in `backend/src/storageKeys.ts` and never accepted from a
 * client. The prefix is what makes a future per-user IAM condition possible;
 * today the isolation is enforced in the API, which is the only thing holding
 * a signing key.
 */

import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
  aws_iam as iam,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { type EnvConfig, resourceName } from './config.js';

export interface StorageStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class StorageStack extends Stack {
  readonly photoBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.photoBucket = new s3.Bucket(this, 'PhotoBucket', {
      bucketName: resourceName(config, `photos-${this.account}`),

      // Nothing here is ever public. Every read is a pre-signed URL minted for
      // a caller the API has already checked owns the round.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,

      // ACLs disabled entirely. With BUCKET_OWNER_ENFORCED there is no
      // object-level ACL to get wrong, which removes the single most common
      // way an S3 bucket ends up world-readable.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,

      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,

      /*
       * Versioning in production only.
       *
       * A photo is the archer's own record of an end they have already shot
       * and cannot re-take. Versioning makes an accidental overwrite — the app
       * re-uploading over a round, a bug in key derivation — recoverable.
       * Dev does not need the storage cost.
       */
      versioned: config.name === 'prod',

      lifecycleRules: [
        {
          // A phone that loses signal mid-upload leaves parts behind that are
          // invisible in the console and billed forever.
          id: 'abort-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          enabled: true,
        },
        ...(config.name === 'prod'
          ? [
              {
                // Old versions exist to recover from a mistake noticed soon
                // after. Keeping them indefinitely is just cost.
                id: 'expire-old-versions',
                noncurrentVersionExpiration: Duration.days(30),
                enabled: true,
              },
            ]
          : []),
        {
          // Photos are looked at in the days after a session and then almost
          // never again. Infrequent Access is roughly half the price and has
          // no retrieval delay.
          id: 'age-out-to-infrequent-access',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(60),
            },
          ],
          enabled: true,
        },
      ],

      cors: [
        {
          /*
           * Only the Expo web preview needs this.
           *
           * A React Native app is not a browser and does not perform preflight
           * checks, so the native client would work with no CORS rules at all.
           * In production the list is empty, which means no browser can PUT
           * here even holding a valid signed URL.
           */
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: [...config.corsAllowedOrigins],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],

      removalPolicy: config.removalPolicy,
      // Dev only. A bucket with objects in it refuses to delete, so without
      // this a dev teardown leaves an orphan; in production the same setting
      // would let a stack deletion take every archer's photos with it.
      autoDeleteObjects: config.name === 'dev',
    });

    /*
     * Deny anything that is not a pre-signed request from our own role.
     *
     * enforceSSL above already rejects plaintext HTTP. This adds the other
     * half: reject requests signed with anything weaker than SigV4, which
     * closes off the legacy signature formats that predate the security
     * properties we are relying on.
     */
    this.photoBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyOutdatedSignatureVersions',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [
          this.photoBucket.bucketArn,
          this.photoBucket.arnForObjects('*'),
        ],
        conditions: {
          StringNotEquals: { 's3:signatureversion': 'AWS4-HMAC-SHA256' },
        },
      }),
    );

    new CfnOutput(this, 'PhotoBucketName', {
      value: this.photoBucket.bucketName,
      description: 'S3_BUCKET for the backend',
    });
  }
}
