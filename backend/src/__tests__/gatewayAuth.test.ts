/**
 * Identity taken from API Gateway's verified claims.
 *
 * In production this is the only thing standing between a request and another
 * archer's data, so the cases that matter are the ones where the claims are
 * absent or malformed. Each of those must be a 401 — never a fall-through to
 * an unauthenticated request, and never a crash that a caller could use to
 * tell one failure mode from another.
 *
 * These run without a database: the subject is the resolver, and every case
 * below is rejected before a query is reached.
 */

import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  env: {
    NODE_ENV: 'test',
    TRUST_GATEWAY_AUTHORIZER: true,
    DEV_USER_ID: undefined,
    AWS_REGION: 'eu-west-2',
  },
  isDevAuthEnabled: false,
}));

const { UnauthorizedError, authenticate } = await import('../auth.js');

/** A request as `@fastify/aws-lambda` decorates it. */
function requestWithClaims(claims: unknown): FastifyRequest {
  return {
    headers: {},
    awsLambda: {
      event: { requestContext: { authorizer: { jwt: { claims } } } },
    },
  } as unknown as FastifyRequest;
}

const SUB = '22222222-2222-4222-8222-000000000000';

describe('authenticate, behind the gateway', () => {
  it('takes the subject from the verified claims', async () => {
    const identity = await authenticate(requestWithClaims({ sub: SUB }));
    expect(identity.userId).toBe(SUB);
  });

  it('reads the email claim when the pool supplies one', async () => {
    const identity = await authenticate(
      requestWithClaims({ sub: SUB, email: 'archer@example.invalid' }),
    );
    expect(identity.email).toBe('archer@example.invalid');
  });

  it('reports no email rather than inventing one', async () => {
    // Cognito access tokens usually carry no email claim. Null is the honest
    // answer; a placeholder invented here would end up stored as if real.
    const identity = await authenticate(requestWithClaims({ sub: SUB }));
    expect(identity.email).toBeNull();
  });

  it('rejects a request with no claims at all', async () => {
    // The important one. A request that reaches the function without passing
    // the authorizer must not be treated as anonymous-but-allowed.
    const request = { headers: {} } as unknown as FastifyRequest;
    await expect(authenticate(request)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects claims with no subject', async () => {
    await expect(
      authenticate(requestWithClaims({ email: 'archer@example.invalid' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a subject that is not a string', async () => {
    await expect(
      authenticate(requestWithClaims({ sub: { toString: () => SUB } })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an empty subject', async () => {
    await expect(
      authenticate(requestWithClaims({ sub: '' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('ignores a bearer token when the gateway is trusted', async () => {
    // A caller cannot smuggle an identity past the authorizer by attaching
    // their own token: this path never looks at the header.
    const request = {
      headers: { authorization: 'Bearer not.a.real.token' },
      awsLambda: {
        event: {
          requestContext: { authorizer: { jwt: { claims: { sub: SUB } } } },
        },
      },
    } as unknown as FastifyRequest;

    const identity = await authenticate(request);
    expect(identity.userId).toBe(SUB);
  });
});
