/**
 * Environment configuration.
 *
 * Per the design's environments rule, a debug build points at the dev stack
 * automatically — an archer should never be able to send real sessions to a
 * scratch database because someone forgot to flip a switch.
 *
 * Values come from `expo.extra` in app.json so that a build carries its own
 * configuration; the defaults below only apply to local development.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

interface Extra {
  apiBaseUrl?: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoRegion?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * Where the API lives during local development.
 *
 * A device on the same Wi-Fi cannot reach the laptop on `localhost`, so the
 * host is taken from whatever address Metro is being served on — the one
 * address we know the phone can already reach. The emulator's 10.0.2.2 alias
 * is handled by the same mechanism, since Metro reports it too.
 */
function inferDevApiBaseUrl(): string {
  if (Platform.OS === 'web') return 'http://localhost:3000';

  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? inferDevApiBaseUrl(),
  cognito: {
    userPoolId: extra.cognitoUserPoolId ?? null,
    clientId: extra.cognitoClientId ?? null,
    region: extra.cognitoRegion ?? 'eu-west-2',
  },
  /**
   * True when no Cognito pool is configured. The app then runs against the
   * backend's DEV_USER_ID path, which `backend/src/env.ts` refuses to allow in
   * production — so this cannot become a way to ship an unauthenticated build.
   */
  get usesDevAuth(): boolean {
    return !extra.cognitoUserPoolId;
  },
} as const;
