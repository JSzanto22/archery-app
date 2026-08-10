/**
 * Environment configuration, validated once at startup.
 *
 * A Lambda that discovers a missing variable on its first request fails a real
 * user's request. Failing at module load instead means the deploy fails, which
 * is the cheaper place to find out.
 */

import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),

    DEV_USER_ID: z.string().uuid().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),

    S3_BUCKET: z.string().optional(),
    AWS_REGION: z.string().default('eu-west-2'),
    PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    /**
     * Points the S3 client at a local MinIO instead of AWS. Unset in every
     * real environment, where the SDK resolves AWS's own endpoints and the
     * function's IAM role supplies credentials.
     */
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),

    /**
     * Comma-separated browser origins allowed to call the API in production.
     * Unset means none, which is correct for a native-only client.
     */
    CORS_ALLOWED_ORIGINS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const isProduction = env.NODE_ENV === 'production';

    // The dev bypass turns every request into "this is that user". Shipping it
    // to production would be an unauthenticated API, so make it impossible
    // rather than merely discouraged.
    if (isProduction && env.DEV_USER_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'DEV_USER_ID must not be set when NODE_ENV=production — it disables authentication entirely.',
      });
    }

    // A custom endpoint means "talk to something that is not AWS", which in
    // production would silently divert every archer's photos.
    if (isProduction && env.S3_ENDPOINT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'S3_ENDPOINT must not be set when NODE_ENV=production — it redirects object storage away from AWS.',
      });
    }

    if (isProduction && !env.COGNITO_USER_POOL_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'COGNITO_USER_POOL_ID is required when NODE_ENV=production.',
      });
    }

    if (!isProduction && !env.DEV_USER_ID && !env.COGNITO_USER_POOL_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Set DEV_USER_ID for local work, or COGNITO_USER_POOL_ID to verify real tokens.',
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || 'config'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

export const env = parsed.data;

export const isDevAuthEnabled = env.DEV_USER_ID !== undefined;
