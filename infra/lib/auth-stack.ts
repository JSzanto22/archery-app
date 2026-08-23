/**
 * Cognito user pool and app client.
 *
 * Settings follow docs/cognito-integration-plan.md. The backend is already
 * shaped for this: `auth.ts` verifies tokens with `aws-jwt-verify` and takes
 * identity exclusively from the `sub` claim, and `users.id` mirrors that sub.
 *
 * Nothing about a user other than their email lives here. Display name and
 * research consent are app data, queried relationally, so they belong in
 * Postgres where SQL can see them — not in Cognito attributes where they would
 * be invisible to every report we might want to run.
 */

import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
  aws_cognito as cognito,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { type EnvConfig, resourceName } from './config.js';

export interface AuthStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: resourceName(config, 'users'),

      selfSignUpEnabled: true,

      // Email as the username. `signInAliases` rather than a separate username
      // means an archer signs in with the address they already gave us, and
      // `signInCaseSensitive: false` stops "Joe@" and "joe@" becoming two
      // accounts that each own half a shooting history.
      signInAliases: { email: true },
      signInCaseSensitive: false,

      autoVerify: { email: true },
      userVerification: {
        emailSubject: 'Your Archery App verification code',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailBody:
          'Your verification code is {####}. It expires in 24 hours.\n\n' +
          'If you did not create an account, you can ignore this email.',
      },

      standardAttributes: {
        email: { required: true, mutable: true },
      },

      /*
       * Length over composition.
       *
       * NIST SP 800-63B advises against forcing symbols and rotations: they
       * push people towards "Password1!" and a sticky note. Twelve characters
       * with mixed case and a digit is stronger in practice than eight with
       * every box ticked, and it is a rule someone can satisfy with a
       * passphrase they will actually remember.
       */
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },

      // Off for MVP per the plan, and a deliberate choice rather than an
      // oversight: this is a casual-use scoring app, and mandatory MFA on a
      // phone at a field range with no signal is a way to lock people out of
      // their own practice notes. Revisit before anything sensitive lands here.
      mfa: cognito.Mfa.OFF,

      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Cognito's default sender is rate-limited to roughly 50 emails a day,
      // which is fine for dev and for a small pilot. Moving to SES is a
      // prerequisite for real signup volume — see the README.
      email: cognito.UserPoolEmail.withCognito(),

      deletionProtection: config.protectResources,
      removalPolicy: config.removalPolicy,
    });

    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: resourceName(config, 'mobile'),

      // A mobile binary cannot keep a secret — anyone can extract it from the
      // APK — so the client is public and security rests on SRP plus the
      // user's password.
      generateSecret: false,

      authFlows: {
        // SRP only. USER_PASSWORD_AUTH would put the password in the request
        // body, and the admin flows would let anything holding AWS credentials
        // sign in as any user without one.
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },

      /*
       * Token lifetimes.
       *
       * A 30-day sliding refresh means a regular archer signs in about once a
       * month at worst; the hour-long access token bounds how long a stolen
       * one is useful. Refresh rotation is left at Cognito's default because
       * enabling it requires the client to handle a rotated token on every
       * call, which Amplify does but our own retry paths would need auditing.
       */
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),

      // Cognito otherwise answers "no such user" differently from "wrong
      // password", which turns the sign-in form into a way to enumerate who
      // has an account.
      preventUserExistenceErrors: true,

      // The app reads the email claim from the ID token to bootstrap the
      // profile row. Nothing else is needed, and anything not listed here the
      // client cannot see.
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
      }),
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
      }),
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'COGNITO_USER_POOL_ID for the backend and the mobile app',
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'COGNITO_CLIENT_ID for the backend and the mobile app',
    });
  }
}
