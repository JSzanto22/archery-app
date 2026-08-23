/**
 * Authentication boundary.
 *
 * Deliberately an interface with two implementations rather than a direct
 * Cognito dependency: the app needs to be runnable and testable against a
 * local backend with no AWS account, and the sync layer only ever needs
 * "give me a bearer token or tell me I'm signed out".
 *
 * Which implementation runs is decided by whether a Cognito pool is
 * configured, and `backend/src/env.ts` refuses the dev path outright in
 * production — so the convenience cannot become a way to ship an
 * unauthenticated build.
 */

import {
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut as amplifySignOut,
  signUp,
} from 'aws-amplify/auth';
import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { config } from '../config';
import { configureAmplify } from './amplify';

configureAmplify();

export interface AuthUser {
  id: string;
  email: string | null;
}

/** What a sign-in or sign-up needs the caller to do next. */
export type AuthStep = 'done' | 'confirmSignUp' | 'unsupported';

export interface Auth {
  user: AuthUser | null;
  isSignedIn: boolean;
  /** True until the stored session has been checked on cold start. */
  isRestoring: boolean;
  /**
   * Bearer token for the API, or null when signed out. Implementations are
   * expected to refresh silently — callers must not cache the result.
   */
  getAccessToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<AuthStep>;
  signUp: (email: string, password: string) => Promise<AuthStep>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (
    email: string,
    code: string,
    password: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  /** True while running without a Cognito pool, against the backend's dev path. */
  isDevAuth: boolean;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * The development identity.
 *
 * The backend's DEV_USER_ID path ignores the token's contents entirely, so
 * this returns a placeholder rather than pretending to mint a real one.
 */
const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@localhost',
};

export function AuthProvider({ children }: PropsWithChildren) {
  const devAuth = config.usesDevAuth;

  const [user, setUser] = useState<AuthUser | null>(devAuth ? DEV_USER : null);
  // Dev auth has nothing to restore, so it starts settled. Under Cognito this
  // gates the navigator: rendering the sign-in screen before the stored
  // session has been read would flash it at an archer who is signed in.
  const [isRestoring, setRestoring] = useState(!devAuth);

  /**
   * Read the signed-in user from the stored session.
   *
   * `fetchAuthSession` is the call that refreshes, and it is used for the
   * email rather than `getCurrentUser` alone because that claim lives on the
   * id token.
   */
  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const current = await getCurrentUser();
      const session = await fetchAuthSession();
      const email = session.tokens?.idToken?.payload['email'];

      return {
        id: current.userId,
        email: typeof email === 'string' ? email : null,
      };
    } catch {
      // Not an error worth surfacing: "no stored session" and "the refresh
      // token expired" mean the same thing to the caller.
      return null;
    }
  }, []);

  useEffect(() => {
    if (devAuth) return;

    let cancelled = false;

    void (async () => {
      const restored = await refreshUser();
      if (cancelled) return;
      setUser(restored);
      setRestoring(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [devAuth, refreshUser]);

  const getAccessToken = useCallback(async () => {
    if (devAuth) return 'dev';

    try {
      // The access token, not the id token: the backend's verifier is
      // configured with tokenUse: 'access', and so is the gateway authorizer.
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() ?? null;
    } catch {
      // A failed refresh means sync pauses and retries later, which is the
      // right behaviour at a field range with no signal.
      return null;
    }
  }, [devAuth]);

  const doSignIn = useCallback(
    async (email: string, password: string): Promise<AuthStep> => {
      const result = await signIn({ username: email, password });

      if (result.isSignedIn) {
        setUser(await refreshUser());
        return 'done';
      }

      // The pool runs plain SRP with no MFA, so the only step that should
      // reach here is an unconfirmed sign-up. Anything else means the pool
      // was changed without the app being updated, and saying so is better
      // than a blank screen.
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        return 'confirmSignUp';
      }

      return 'unsupported';
    },
    [refreshUser],
  );

  const doSignUp = useCallback(
    async (email: string, password: string): Promise<AuthStep> => {
      const result = await signUp({
        username: email,
        password,
        options: { userAttributes: { email } },
      });

      if (result.isSignUpComplete) return 'done';
      return result.nextStep.signUpStep === 'CONFIRM_SIGN_UP'
        ? 'confirmSignUp'
        : 'unsupported';
    },
    [],
  );

  const doConfirmSignUp = useCallback(async (email: string, code: string) => {
    await confirmSignUp({ username: email, confirmationCode: code });
  }, []);

  const doResendCode = useCallback(async (email: string) => {
    await resendSignUpCode({ username: email });
  }, []);

  const doRequestPasswordReset = useCallback(async (email: string) => {
    await resetPassword({ username: email });
  }, []);

  const doConfirmPasswordReset = useCallback(
    async (email: string, code: string, password: string) => {
      await confirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword: password,
      });
    },
    [],
  );

  const doSignOut = useCallback(async () => {
    if (devAuth) return;
    await amplifySignOut();
    setUser(null);
  }, [devAuth]);

  const value = useMemo<Auth>(
    () => ({
      user,
      isSignedIn: user !== null,
      isRestoring,
      getAccessToken,
      signIn: doSignIn,
      signUp: doSignUp,
      confirmSignUp: doConfirmSignUp,
      resendCode: doResendCode,
      requestPasswordReset: doRequestPasswordReset,
      confirmPasswordReset: doConfirmPasswordReset,
      signOut: doSignOut,
      isDevAuth: devAuth,
    }),
    [
      user,
      isRestoring,
      getAccessToken,
      doSignIn,
      doSignUp,
      doConfirmSignUp,
      doResendCode,
      doRequestPasswordReset,
      doConfirmPasswordReset,
      doSignOut,
      devAuth,
    ],
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
