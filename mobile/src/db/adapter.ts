/**
 * Native storage adapter — SQLite.
 *
 * Metro picks this file on iOS and Android, and `adapter.web.ts` in a browser.
 * The split is a resolution trick rather than a runtime branch: importing the
 * SQLite adapter at all on web would pull in native modules that do not exist
 * there, and a `Platform.OS` check inside one file would not prevent that
 * import from being bundled.
 */

import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import schema from './schema';

export function createAdapter() {
  return new SQLiteAdapter({
    schema,
    // JSI is the fast synchronous path; without it every query crosses the RN
    // bridge. Requires a dev client or a release build — it is unavailable in
    // Expo Go, which is why this project uses a custom dev client.
    jsi: true,
    onSetUpError: (error) => {
      console.error('[db] failed to open local database', error);
    },
  });
}
