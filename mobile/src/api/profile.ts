/**
 * The archer's profile, as the API holds it.
 *
 * Small enough not to need a client library. It exists as its own module
 * because it is the only part of the app that reads or writes anything about
 * the person rather than about their shooting.
 */

import { config } from '../config';
import { fetchWithTimeout } from '../lib/http';

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  researchConsent: boolean;
}

interface Options {
  getAccessToken: () => Promise<string | null>;
}

/** Thrown when the caller is not signed in, so screens can say so plainly. */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotSignedInError';
  }
}

async function request<T>(
  path: string,
  { getAccessToken }: Options,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (token === null) throw new NotSignedInError();

  const response = await fetchWithTimeout(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

/**
 * Read the profile, creating it if this is the first call.
 *
 * The creation is the server's doing — see backend/src/profile.ts. Worth
 * knowing here because it means this is safe to call on a brand new account
 * and will not 404.
 */
export function getProfile(options: Options): Promise<Profile> {
  return request<Profile>('/me', options);
}

export function updateProfile(
  changes: { displayName?: string; researchConsent?: boolean },
  options: Options,
): Promise<Profile> {
  return request<Profile>('/me', options, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}
