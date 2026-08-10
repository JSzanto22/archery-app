/**
 * An in-memory database for tests.
 *
 * `db/index.ts` builds the real adapter at import time — SQLite on a device,
 * LokiJS over IndexedDB in a browser — and neither exists under Jest. This
 * builds the same schema and models over LokiJS with persistence switched off,
 * so writes behave exactly as they do in the app and vanish when the test ends.
 *
 * Used via `jest.mock('../index', …)` so production code is untouched.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { setGenerator } from '@nozbe/watermelondb/utils/common/randomId';

import migrations from '../migrations';
import schema from '../schema';
import Arrow from '../models/Arrow';
import GearProfile from '../models/GearProfile';
import Round from '../models/Round';
import Session from '../models/Session';
import Target from '../models/Target';
import TargetZone from '../models/TargetZone';

/**
 * Deterministic ids.
 *
 * The app uses expo-crypto's randomUUID, which has no implementation under
 * Node. Tests do not need real entropy — they need to be able to tell two
 * records apart — but the shape must stay a UUID, because id format is part
 * of the sync contract.
 *
 * The counter is never reset. Deleting a record leaves a tombstone whose id
 * stays reserved, so restarting the sequence between tests reissues an id the
 * store still knows about: Loki rejects the duplicate, the driver marks itself
 * broken, and every later test hangs rather than failing.
 */
let counter = 0;

setGenerator(() => {
  counter += 1;
  const n = counter.toString(16).padStart(12, '0');
  return `feedface-0000-4000-8000-${n}`;
});

export interface TestDatabase {
  database: Database;
  collections: {
    gearProfiles: ReturnType<Database['get']>;
    targets: ReturnType<Database['get']>;
    targetZones: ReturnType<Database['get']>;
    sessions: ReturnType<Database['get']>;
    rounds: ReturnType<Database['get']>;
    arrows: ReturnType<Database['get']>;
  };
}

export function createTestDatabase(): TestDatabase {
  const adapter = new LokiJSAdapter({
    schema,
    migrations,
    // No worker and no IndexedDB: Loki falls back to an in-memory store, which
    // is what makes this usable under Node at all.
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    dbName: `test-${Math.random().toString(36).slice(2)}`,
  });

  const database = new Database({
    adapter,
    modelClasses: [GearProfile, Target, TargetZone, Session, Round, Arrow],
  });

  return {
    database,
    collections: {
      gearProfiles: database.get('gear_profiles'),
      targets: database.get('targets'),
      targetZones: database.get('target_zones'),
      sessions: database.get('sessions'),
      rounds: database.get('rounds'),
      arrows: database.get('arrows'),
    },
  };
}
