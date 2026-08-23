/**
 * Token storage backed by the device keychain.
 *
 * Amplify's default is AsyncStorage, which is an unencrypted file in the app's
 * sandbox — readable on a rooted or jailbroken device, and included in some
 * backup paths. Refresh tokens live for thirty days, so that is thirty days of
 * an attacker being able to act as the archer from anywhere.
 *
 * `expo-secure-store` puts them in the iOS Keychain and Android Keystore
 * instead. Two of its constraints have to be worked around, and both fail
 * silently if ignored:
 *
 * 1. **Keys are restricted to `[A-Za-z0-9._-]`.** Amplify builds keys from the
 *    username, which for this pool is an email address — the `@` alone would
 *    reject every write.
 * 2. **Values above 2048 bytes are unreliable.** Cognito ID tokens routinely
 *    exceed that once a pool carries more than a couple of claims. A token
 *    that fails to persist logs the archer out on the next cold start, which
 *    presents as "the app forgets me" rather than as a storage error.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Amplify's shape. Kept structural so no Amplify type is imported here. */
export interface KeyValueStorage {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Comfortably under the 2048-byte ceiling.
 *
 * The limit is on the encoded value, and multi-byte characters in a JWT's
 * payload would push a 2048-character chunk over it.
 */
const CHUNK_SIZE = 1800;

/** Tracks which keys exist, because SecureStore cannot enumerate them. */
const INDEX_KEY = 'archery_storage_index';

const SAFE_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * A deterministic, SecureStore-legal name for an arbitrary key.
 *
 * The hash suffix matters: sanitising alone would map `a@b` and `a_b` onto the
 * same slot, and silently serving one account's token to another is a worse
 * bug than the one being fixed.
 */
function safeKey(key: string): string {
  if (SAFE_KEY.test(key) && key.length <= 64) return key;

  // FNV-1a. Not a security primitive — this only needs to separate keys that
  // sanitise identically, and it must be synchronous.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const stem = key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
  return `${stem}_${hash.toString(16)}`;
}

function chunkKey(base: string, index: number): string {
  return `${base}__${index}`;
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    // A corrupt index costs a sign-in, not correctness: the tokens it pointed
    // at become unreachable and Amplify treats that as signed out.
    return [];
  }
}

async function writeIndex(keys: string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(keys));
}

class SecureKeyValueStorage implements KeyValueStorage {
  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);

    // Remove first: a shorter value than last time would otherwise leave
    // trailing chunks behind, and reassembly would append stale bytes to an
    // otherwise valid token.
    await this.removeChunks(base);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    // An empty string is a legitimate value and must round-trip, so the count
    // is stored even when there is nothing to chunk.
    await SecureStore.setItemAsync(base, String(chunks.length));

    for (const [index, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(chunkKey(base, index), chunk);
    }

    const index = await readIndex();
    if (!index.includes(base)) await writeIndex([...index, base]);
  }

  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const header = await SecureStore.getItemAsync(base);
    if (header === null) return null;

    const count = Number.parseInt(header, 10);
    if (!Number.isInteger(count) || count < 0) return null;

    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(chunkKey(base, i));
      // A missing chunk means a partial write. Half a JWT is not a token, so
      // report absence rather than hand back something that will fail to
      // parse somewhere less obvious.
      if (chunk === null) return null;
      parts.push(chunk);
    }

    return parts.join('');
  }

  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    await this.removeChunks(base);
    await writeIndex((await readIndex()).filter((k) => k !== base));
  }

  async clear(): Promise<void> {
    for (const base of await readIndex()) {
      await this.removeChunks(base);
    }
    await SecureStore.deleteItemAsync(INDEX_KEY);
  }

  private async removeChunks(base: string): Promise<void> {
    const header = await SecureStore.getItemAsync(base);
    if (header === null) return;

    const count = Number.parseInt(header, 10);
    if (Number.isInteger(count)) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(chunkKey(base, i));
      }
    }

    await SecureStore.deleteItemAsync(base);
  }
}

/**
 * The keychain-backed store, or null where there is no keychain.
 *
 * Web has none — the Expo preview runs against the dev backend anyway — so
 * Amplify's own storage is left in place there rather than pretending to
 * offer a guarantee the platform cannot make.
 */
export function createSecureStorage(): KeyValueStorage | null {
  if (Platform.OS === 'web') return null;
  return new SecureKeyValueStorage();
}
