/**
 * Amplify configuration.
 *
 * Only the Auth category. Amplify is a large library and the rest of it — API,
 * Storage, DataStore — would duplicate things this app already does its own
 * way: sync is WatermelonDB's, and photos go through pre-signed URLs the
 * backend mints. Importing from `aws-amplify/auth` keeps the rest out of the
 * bundle.
 *
 * Configuration is idempotent and runs at module load rather than in a
 * component, so a screen cannot render against an unconfigured Amplify.
 */

// Amplify's SRP implementation needs a CSPRNG, and React Native has no
// crypto.getRandomValues until this polyfill installs one. It must load before
// anything from aws-amplify, so it sits above that import rather than being
// tidied into alphabetical order.
import 'react-native-get-random-values';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

import { config } from '../config';
import { createSecureStorage } from './secureStorage';

let configured = false;

export function configureAmplify(): void {
  if (configured) return;

  const { userPoolId, clientId } = config.cognito;

  // Without a pool the app runs against the backend's DEV_USER_ID path, and
  // configuring Amplify with nulls would only produce confusing errors from
  // inside the library instead of the clear dev-auth behaviour.
  if (!userPoolId || !clientId) return;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: clientId,
        signUpVerificationMethod: 'code',
        loginWith: { email: true },
      },
    },
  });

  const storage = createSecureStorage();
  if (storage) cognitoUserPoolsTokenProvider.setKeyValueStorage(storage);

  configured = true;
}
