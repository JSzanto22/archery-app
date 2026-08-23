/**
 * Cognito errors, in words an archer can act on.
 *
 * Amplify throws exceptions named things like `NotAuthorizedException`.
 * Showing that raw is doubly bad: it means nothing to the person reading it,
 * and it leaks how the backend is built to anyone probing the form.
 *
 * The messages here deliberately do not distinguish "no such account" from
 * "wrong password". The pool is configured with `preventUserExistenceErrors`
 * so Cognito does not tell us either, and reconstructing the difference would
 * hand back the account enumerator that setting exists to remove.
 */

const MESSAGES: Record<string, string> = {
  // Covers wrong password, unknown account, and disabled user alike.
  NotAuthorizedException: 'That email and password do not match an account.',
  UserNotFoundException: 'That email and password do not match an account.',

  UserNotConfirmedException:
    'This account still needs confirming. Check your email for the code.',
  UsernameExistsException:
    'There is already an account with that email. Try signing in.',
  InvalidPasswordException:
    'That password is too weak. Use at least 12 characters, with an uppercase letter and a number.',
  InvalidParameterException: 'Check the details above and try again.',

  CodeMismatchException: 'That code is not right. Check it and try again.',
  ExpiredCodeException: 'That code has expired. Ask for a new one.',
  CodeDeliveryFailureException:
    'We could not send the code. Check the email address.',

  // Cognito rate-limits confirmation codes and sign-in attempts.
  LimitExceededException:
    'Too many attempts. Wait a few minutes and try again.',
  TooManyRequestsException:
    'Too many attempts. Wait a few minutes and try again.',
  TooManyFailedAttemptsException:
    'Too many attempts. Wait a few minutes and try again.',

  // Amplify reports a failed request this way — confirmed against
  // AmplifyErrorCode.NetworkError rather than guessed. Worth its own message:
  // an archer at a range with no signal should be told it is the network, not
  // that their password is wrong.
  NetworkError:
    'No connection. Your practice is saved on this phone either way.',

  // Not the archer's problem: it means the app is pointed at a pool or client
  // that does not exist. Nothing they type will fix it, so the message says
  // so rather than inviting them to keep trying.
  ResourceNotFoundException:
    'This app is not set up correctly for sign-in. Please report this.',
};

const FALLBACK = 'Something went wrong. Try again.';

export function authErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return FALLBACK;

  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && name in MESSAGES) {
    return MESSAGES[name] as string;
  }

  // An unmapped error otherwise disappears into the generic message with no
  // way to find out what it was. Naming it in development is how the table
  // above grows; production still shows only the generic text.
  if (__DEV__) {
    console.warn(
      `[auth] unmapped error: ${typeof name === 'string' ? name : typeof name}`,
      error,
    );
  }

  return FALLBACK;
}
