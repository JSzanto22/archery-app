/**
 * Authentication boundary.
 *
 * Deliberately an interface with two implementations rather than a direct
 * Cognito dependency: the app needs to be runnable and testable against a
 * local backend with no AWS account, and the sync layer only ever needs
 * "give me a bearer token or tell me I'm signed out".
 *
 * Swapping the dev provider for Cognito is a change to this file alone —
 * `useSync`, `runSync` and every screen are already written against the
 * token-provider shape. See docs/cognito-integration-plan.md.
 */

import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';

import { config } from '../config';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface Auth {
  user: AuthUser | null;
  isSignedIn: boolean;
  /**
   * Bearer token for the API, or null when signed out. Implementations are
   * expected to refresh silently — callers must not cache the result.
   */
  getAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** True while running without a Cognito pool, against the backend's dev path. */
  isDevAuth: boolean;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * The development identity.
 *
 * The backend's DEV_USER_ID path ignores the token's contents entirely, so
 * this returns a placeholder rather than pretending to mint a real one. That
 * path is refused outright when NODE_ENV=production (backend/src/env.ts), so
 * this cannot become a way to ship an unauthenticated build.
 */
const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@localhost',
};

export function AuthProvider({ children }: PropsWithChildren) {
  const getAccessToken = useCallback(async () => {
    if (config.usesDevAuth) return 'dev';
    // Cognito lands here: fetchAuthSession().tokens?.accessToken?.toString().
    return null;
  }, []);

  const signOut = useCallback(async () => {
    // No-op under dev auth; Cognito's signOut() replaces this.
  }, []);

  const value = useMemo<Auth>(
    () => ({
      user: config.usesDevAuth ? DEV_USER : null,
      isSignedIn: config.usesDevAuth,
      getAccessToken,
      signOut,
      isDevAuth: config.usesDevAuth,
    }),
    [getAccessToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return auth;
}
