/**
 * Authentication.
 *
 * The authenticated user id comes from a verified token's `sub` claim and from
 * nowhere else. It is never read from a request body, a path parameter or a
 * header the client controls — those are all attacker-supplied, and treating
 * one as identity would let any user read any other user's data by editing a
 * field.
 *
 * *Where* the verification happens depends on how the app is running, and the
 * choice is explicit rather than inferred:
 *
 * - **Behind API Gateway** (`TRUST_GATEWAY_AUTHORIZER=true`), the JWT
 *   authorizer has already checked signature, expiry, issuer and audience
 *   before the function was invoked, and the claims arrive on the event. This
 *   is what lets the Lambda sit in a VPC with no internet route: verifying
 *   in-app would mean fetching Cognito's JWKS over the public internet, and
 *   that would mean a NAT gateway at $32/month. See option B in
 *   docs/lambda-deployment-assessment.md.
 * - **Anywhere else** — locally, in tests, behind a different front door — the
 *   token is verified here with `aws-jwt-verify`.
 *
 * The two paths are mutually exclusive and neither can silently degrade into
 * "no authentication": if the gateway is trusted and the claims are missing,
 * that is a 401, not a fall-through.
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

/**
 * The claims API Gateway attached after verifying the token.
 *
 * Shape is HTTP API payload v2. Typed loosely and read defensively because it
 * arrives from outside our own code: everything below treats a missing or
 * malformed claim as "not authenticated" rather than assuming the gateway
 * always populates it.
 */
interface GatewayEvent {
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
}

function gatewayClaims(
  request: FastifyRequest,
): Record<string, unknown> | null {
  const decorated = (request as { awsLambda?: { event?: GatewayEvent } })
    .awsLambda;

  const claims = decorated?.event?.requestContext?.authorizer?.jwt?.claims;
  return claims && typeof claims === 'object' ? claims : null;
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

  /*
   * The gateway has already done the verification.
   *
   * Note what is *not* done here: there is no fallback to in-app verification
   * if the claims are absent. The Lambda's resource policy only permits API
   * Gateway to invoke it, so a request arriving without claims either came
   * through an unauthenticated route or is not what it appears to be. Either
   * way the answer is 401.
   */
  if (env.TRUST_GATEWAY_AUTHORIZER) {
    const claims = gatewayClaims(request);
    if (!claims) throw new UnauthorizedError('Missing authorizer claims');

    const sub = claims['sub'];
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedError('Authorizer claims carry no subject');
    }

    return { userId: sub, email: resolveEmail(claims) };
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
