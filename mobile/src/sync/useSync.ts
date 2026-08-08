/**
 * Sync as the UI sees it: a status, a trigger, and a reason when it fails.
 *
 * `runSync` existed for a long time with no caller, which meant the app was
 * local-only while telling every session it was "Not synced". This is the
 * piece that makes the claim true.
 *
 * Sync is deliberately manual-plus-opportunistic rather than continuous:
 * an archer at a range has patchy signal and a finite battery, and a sync
 * that retries in a tight loop against a dead connection is worse than one
 * that waits to be asked.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { config } from '../config';
import { runSync } from '../db/sync';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Null until a sync has succeeded in this install. */
  lastSyncedAt: Date | null;
  error: string | null;
  sync: () => Promise<void>;
}

export interface UseSyncOptions {
  /** Supplies a bearer token. Returning null means "not signed in". */
  getAccessToken: () => Promise<string | null>;
  /** Skip syncing entirely — no account yet, or the user opted out. */
  enabled?: boolean;
  /** Called after a sync that changed something, so views can reload. */
  onChanged?: () => void;
}

export function useSync({
  getAccessToken,
  enabled = true,
  onChanged,
}: UseSyncOptions): SyncStatus {
  const [state, setState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guards against a foreground event and a button press overlapping. Unlike
  // the marking screen's writes, a concurrent sync has nothing useful to do —
  // the second one would pull the same changes — so dropping it is correct.
  const inFlight = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const sync = useCallback(async () => {
    if (!enabled || inFlight.current) return;

    const token = await getAccessToken();
    if (token === null) return;

    inFlight.current = true;
    setState('syncing');
    setError(null);

    try {
      await runSync({
        apiBaseUrl: config.apiBaseUrl,
        getAccessToken: async () => token,
      });
      setLastSyncedAt(new Date());
      setState('idle');
      onChangedRef.current?.();
    } catch (e) {
      // Offline is the normal case at a range, not an exception. Say so
      // plainly rather than surfacing a fetch stack trace.
      const message =
        e instanceof Error && /network|fetch|timeout/i.test(e.message)
          ? 'No connection. Your sessions are saved on this phone and will sync later.'
          : 'Sync failed. Your sessions are safe on this phone.';
      console.error('[sync]', e);
      setError(message);
      setState('error');
    } finally {
      inFlight.current = false;
    }
  }, [enabled, getAccessToken]);

  // Sync when the app comes back to the foreground: the moment most likely to
  // follow the archer walking back into signal.
  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sync();
    });

    return () => subscription.remove();
  }, [enabled, sync]);

  return { state, lastSyncedAt, error, sync };
}
