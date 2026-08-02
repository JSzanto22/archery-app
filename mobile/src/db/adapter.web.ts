/**
 * Web storage adapter — LokiJS over IndexedDB.
 *
 * The web build exists so the UI can be reviewed in a browser without Android
 * tooling. It is a preview surface, not a target platform: there is no camera
 * capture worth having, and IndexedDB is not SQLite, so anything that depends
 * on real storage behaviour still has to be checked on a device.
 */

import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import migrations from './migrations';
import schema from './schema';

export function createAdapter() {
  return new LokiJSAdapter({
    schema,
    migrations,
    // A worker would isolate the database from the UI thread, but it also makes
    // debugging a preview build considerably harder for no benefit here.
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    onQuotaExceededError: (error) => {
      console.error('[db] browser storage quota exceeded', error);
    },
    onSetUpError: (error) => {
      console.error('[db] failed to open local database', error);
    },
  });
}
