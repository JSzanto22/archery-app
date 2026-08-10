/**
 * Sync against `/sync/pull` and `/sync/push`.
 *
 * WatermelonDB's `synchronize()` supplies the hard part — change tracking,
 * conflict application, and the local transaction. This module is the adapter
 * between its shape and the API contract in docs/technical-design.md.
 *
 * Two shape mismatches are handled here rather than pushed onto either side:
 *
 * 1. **Timestamps.** Watermelon uses epoch milliseconds; the API uses ISO
 *    strings, because that is what Postgres `timestamptz` round-trips cleanly.
 *    Converted in both directions below.
 *
 * 2. **Deletions.** The server's `/sync/pull` cannot currently report deleted
 *    rows — a hard-deleted row leaves nothing to return, so `deleted` comes back
 *    empty and a session deleted on another device is never removed here. This
 *    is a known gap, written up in `backend/db/README.md`. The client side is
 *    ready for it: as soon as the server returns ids in `deleted`, they are
 *    applied with no change to this file.
 *
 * ## The preset diagnostic on first sync
 *
 * WatermelonDB logs "Server wants client to create record target_zones#…, but
 * it already exists locally" the first time an install syncs. That is expected
 * and harmless: both sides ship the World Archery faces — the app so a new
 * install can score before it ever reaches the network, the server so every
 * account sees the same standards — and they now agree on ids, so the applier
 * updates the existing row exactly as intended.
 *
 * The alternative is worse in both directions. Not bundling the presets breaks
 * offline-first for a fresh install; sending them as `updated` instead trades
 * this diagnostic for the mirror-image one on any client that does not have
 * them yet. The ids agreeing is the part that matters, and it is asserted on
 * both sides (mobile/src/db/__tests__/presets.test.ts and the backend suite).
 */

import {
  synchronize,
  SyncDatabaseChangeSet,
  SyncPullResult,
} from '@nozbe/watermelondb/sync';

import { fetchWithTimeout } from '../lib/http';
import { database } from './index';

export interface SyncOptions {
  apiBaseUrl: string;
  /** Cognito access token. The server derives the user from it, never from us. */
  getAccessToken: () => Promise<string>;
}

/** Tables that participate in sync, in dependency order for the push. */
const SYNCED_TABLES = [
  'gear_profiles',
  'targets',
  'target_zones',
  'sessions',
  'rounds',
  'arrows',
] as const;

type SyncedTable = (typeof SYNCED_TABLES)[number];

type RawRecord = Record<string, unknown>;

function msToIso(value: unknown): unknown {
  return typeof value === 'number' ? new Date(value).toISOString() : value;
}

function isoToMs(value: unknown): unknown {
  return typeof value === 'string' ? new Date(value).getTime() : value;
}

const TIMESTAMP_FIELDS = ['created_at', 'updated_at', 'shot_at'];

function toWire(record: RawRecord): RawRecord {
  const out: RawRecord = { ...record };
  for (const field of TIMESTAMP_FIELDS) {
    if (field in out) out[field] = msToIso(out[field]);
  }
  // Local-only: a file:// path on this device means nothing to the server or to
  // any other device, so it never leaves the phone.
  delete out.local_photo_uri;
  return out;
}

function fromWire(record: RawRecord): RawRecord {
  const out: RawRecord = { ...record };
  for (const field of TIMESTAMP_FIELDS) {
    if (field in out) out[field] = isoToMs(out[field]);
  }
  return out;
}

interface WireChanges {
  [table: string]: {
    created: RawRecord[];
    updated: RawRecord[];
    deleted: string[];
  };
}

function mapChanges(
  changes: WireChanges,
  map: (r: RawRecord) => RawRecord,
): WireChanges {
  const out: WireChanges = {};

  for (const table of SYNCED_TABLES) {
    const bucket = changes[table] ?? { created: [], updated: [], deleted: [] };
    out[table] = {
      created: bucket.created.map(map),
      updated: bucket.updated.map(map),
      deleted: bucket.deleted,
    };
  }

  return out;
}

export async function runSync(options: SyncOptions): Promise<void> {
  const { apiBaseUrl, getAccessToken } = options;

  const authorizedFetch = async (path: string, init: RequestInit = {}) => {
    const token = await getAccessToken();

    const response = await fetchWithTimeout(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      // Surface the server's message: a sync that fails silently looks to the
      // archer exactly like a sync that worked.
      const body = await response.text();
      throw new Error(`sync ${path} failed (${response.status}): ${body}`);
    }

    return response;
  };

  await synchronize({
    database,

    pullChanges: async ({ lastPulledAt }): Promise<SyncPullResult> => {
      const since = lastPulledAt ? new Date(lastPulledAt).toISOString() : '';
      const query = since ? `?since=${encodeURIComponent(since)}` : '';

      const response = await authorizedFetch(`/sync/pull${query}`);
      const body = (await response.json()) as {
        changes: WireChanges;
        timestamp: string;
      };

      return {
        changes: mapChanges(
          body.changes,
          fromWire,
        ) as unknown as SyncDatabaseChangeSet,
        // The server's clock, not ours. Using the device clock here would make
        // sync correctness depend on the phone's time being right, and phones
        // at a field range are frequently not.
        timestamp: new Date(body.timestamp).getTime(),
      };
    },

    pushChanges: async ({ changes, lastPulledAt }) => {
      await authorizedFetch('/sync/push', {
        method: 'POST',
        body: JSON.stringify({
          lastPulledAt: lastPulledAt
            ? new Date(lastPulledAt).toISOString()
            : null,
          changes: mapChanges(changes, toWire),
        }),
      });
    },

    /*
     * `sendCreatedAsUpdated` is deliberately NOT set.
     *
     * It is for backends that cannot tell a create from an update, and it made
     * WatermelonDB log a diagnostic on every pull: the option promises the
     * server never distinguishes the two, while `/sync/pull` genuinely does —
     * it buckets by whether a row was created after the client's watermark.
     * Enabling it also loses no information on push, since `/sync/push`
     * upserts both buckets identically, so the honest setting is off.
     *
     * Watermelon already sends complete records in both buckets; the option
     * has nothing to do with partial payloads, which is what it was mistaken
     * for when it was first added here.
     */
  });
}

export type { SyncedTable };
