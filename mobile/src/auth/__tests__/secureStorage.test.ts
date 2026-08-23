/**
 * Keychain-backed token storage.
 *
 * The cases below are the ones that fail silently in production if they are
 * wrong: a key Amplify builds from an email address, and a token longer than
 * SecureStore will hold. Both present as "the app keeps signing me out"
 * rather than as a storage error, which is why they are pinned here.
 */

import { createSecureStorage } from '../secureStorage';

/**
 * A stand-in keychain, so the assertions are about our layer only.
 *
 * Named with the `mock` prefix because jest.mock is hoisted above this
 * declaration and only permits out-of-scope variables spelled that way.
 */
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

beforeEach(() => {
  mockStore.clear();
});

/** SecureStore rejects anything outside this set. */
const SAFE_KEY = /^[A-Za-z0-9._-]+$/;

/** Amplify builds keys from the username, which for this pool is an email. */
const AMPLIFY_KEY =
  'CognitoIdentityServiceProvider.4f8n2q.archer@example.com.accessToken';

describe('secure storage', () => {
  it('round-trips a value', async () => {
    const storage = createSecureStorage()!;

    await storage.setItem('plain', 'value');
    expect(await storage.getItem('plain')).toBe('value');
  });

  it('reports a missing key as null', async () => {
    const storage = createSecureStorage()!;
    expect(await storage.getItem('absent')).toBeNull();
  });

  it('accepts a key containing an email address', async () => {
    // The `@` alone would make SecureStore reject every write, so an
    // unsanitised key means no token is ever stored.
    const storage = createSecureStorage()!;

    await storage.setItem(AMPLIFY_KEY, 'token-value');

    expect(await storage.getItem(AMPLIFY_KEY)).toBe('token-value');
    for (const key of mockStore.keys()) {
      expect(key).toMatch(SAFE_KEY);
    }
  });

  it('does not confuse two keys that sanitise alike', async () => {
    // Sanitising alone maps both of these onto the same slot, which would
    // serve one account's token in place of another's.
    const storage = createSecureStorage()!;

    await storage.setItem('user@example.com', 'first');
    await storage.setItem('user_example.com', 'second');

    expect(await storage.getItem('user@example.com')).toBe('first');
    expect(await storage.getItem('user_example.com')).toBe('second');
  });

  it('round-trips a token larger than SecureStore will hold', async () => {
    const storage = createSecureStorage()!;
    // Real ID tokens pass 2048 bytes once a pool carries a few claims.
    const token = 'a'.repeat(6000);

    await storage.setItem(AMPLIFY_KEY, token);

    expect(await storage.getItem(AMPLIFY_KEY)).toBe(token);
    for (const value of mockStore.values()) {
      expect(value.length).toBeLessThanOrEqual(2048);
    }
  });

  it('round-trips an empty string rather than losing it', async () => {
    const storage = createSecureStorage()!;

    await storage.setItem('empty', '');

    expect(await storage.getItem('empty')).toBe('');
  });

  it('leaves no stale chunks when a value shrinks', async () => {
    // Without clearing first, reassembly would append the tail of the old
    // token to the new one and produce something that parses as neither.
    const storage = createSecureStorage()!;

    await storage.setItem('token', 'b'.repeat(6000));
    await storage.setItem('token', 'short');

    expect(await storage.getItem('token')).toBe('short');
  });

  it('treats a partially written value as absent', async () => {
    const storage = createSecureStorage()!;
    await storage.setItem('token', 'c'.repeat(6000));

    // Simulate a write interrupted part way through.
    const chunkKey = [...mockStore.keys()].find((k) => k.endsWith('__2'));
    mockStore.delete(chunkKey!);

    // Half a JWT is not a token. Absence sends the archer to sign in again,
    // which is recoverable; a truncated token fails somewhere less obvious.
    expect(await storage.getItem('token')).toBeNull();
  });

  it('removes a value and its chunks', async () => {
    const storage = createSecureStorage()!;

    await storage.setItem('token', 'd'.repeat(6000));
    await storage.removeItem('token');

    expect(await storage.getItem('token')).toBeNull();
  });

  it('clears everything on sign-out', async () => {
    const storage = createSecureStorage()!;

    await storage.setItem('a', 'one');
    await storage.setItem(AMPLIFY_KEY, 'e'.repeat(6000));
    await storage.clear();

    expect(await storage.getItem('a')).toBeNull();
    expect(await storage.getItem(AMPLIFY_KEY)).toBeNull();
    // No orphans: a token left behind after sign-out is the whole thing this
    // storage exists to prevent.
    expect(mockStore.size).toBe(0);
  });
});
