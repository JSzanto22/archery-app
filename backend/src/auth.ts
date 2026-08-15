/**
 * Authentication.
 *
 * The authenticated user id comes from the verified token's `sub` claim and
 * from nowhere else. It is never read from a request body, a path parameter or
 * a header the client controls — those are all attacker-supplied, and treating
 * one as identity would let any user read any other user's data by editing a
 * field.
 *
 * API Gateway's Cognito authorizer already rejects invalid tokens before the
 * Lambda runs. Verifying again here is not redundant: it keeps the app correct
 * when run outside API Gateway (locally, in tests, or behind a different
 * front door) rather than silently trusting whatever arrives.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { env, isDevAuthEnabled } from './env.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    /** From the verified token only, and often absent — see resolveEmail. */
    userEmail: string | null;
  }
}

interface Identity {
  userId: string;
  email: string | null;
}

/**
 * The email claim, if the pool puts one in the access token.
 *
 * Most Cognito pools do not — email lives on the id token — so this is usually
 * null and the caller falls back to a placeholder. What matters is that it is
 * null rather than something a client sent us: `/me` used to take the address
 * from an `x-user-email` header, which any caller can set to any value. Since
 * users.email is UNIQUE, that let one account claim a stranger's address and
 * permanently block that person's first `/me` from creating their row.
 */
function resolveEmail(payload: Record<string, unknown>): string | null {
  const email = payload['email'];
  return typeof email === 'string' && email.length > 0 ? email : null;
}

const verifier = env.COGNITO_USER_POOL_ID
  ? CognitoJwtVerifier.create({
      userPoolId: env.COGNITO_USER_POOL_ID,
      tokenUse: 'access',
      clientId: env.COGNITO_CLIENT_ID ?? null,
    })
  : null;

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

/**
 * Resolve the caller's user id.
 *
 * In development, `DEV_USER_ID` short-circuits this so the app is usable
 * without a Cognito pool. `env.ts` makes that impossible in production.
 */
export async function authenticate(request: FastifyRequest): Promise<Identity> {
  if (isDevAuthEnabled) {
    // The header is honoured here and only here. Dev auth already means "trust
    // this caller completely", and seeding a recognisable email makes the
    // local database readable.
    return {
      userId: env.DEV_USER_ID!,
      email: (request.headers['x-user-email'] as string | undefined) ?? null,
    };
  }

  const token = bearerToken(request);
  if (!token) throw new UnauthorizedError('Missing bearer token');
  if (!verifier) throw new UnauthorizedError('No token verifier configured');

  try {
    const payload = await verifier.verify(token);
    return { userId: payload.sub, email: resolveEmail(payload) };
  } catch {
    // Deliberately opaque: telling a caller *why* a token failed helps them
    // craft a better one.
    throw new UnauthorizedError('Invalid token');
  }
}

/** Fastify preHandler that populates `request.userId` and `request.userEmail`. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const identity = await authenticate(request);
    request.userId = identity.userId;
    request.userEmail = identity.email;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await reply.code(401).send({ error: error.message });
      return;
    }
    throw error;
  }
}
