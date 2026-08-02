/**
 * Local database — the app's source of truth.
 *
 * Everything the UI reads comes from here. The network is an optional
 * background detail, not a precondition for using the app.
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { setGenerator } from '@nozbe/watermelondb/utils/common/randomId';
import * as Crypto from 'expo-crypto';

import schema from './schema';
import Arrow from './models/Arrow';
import GearProfile from './models/GearProfile';
import Round from './models/Round';
import Session from './models/Session';
import Target from './models/Target';
import TargetZone from './models/TargetZone';

/**
 * Replace WatermelonDB's default id generator with real UUIDs.
 *
 * This matters more than it looks. Watermelon's built-in generator produces
 * short random strings, but the server's primary keys are UUIDs and the whole
 * offline story rests on the device minting ids the server will accept
 * unchanged. Without this line, every record created offline would be rejected
 * on push.
 */
setGenerator(() => Crypto.randomUUID());

const adapter = new SQLiteAdapter({
  schema,
  // JSI is the fast synchronous path; without it every query crosses the RN
  // bridge. Requires a dev client or a release build — it is unavailable in
  // Expo Go, which is why this project uses a custom dev client.
  jsi: true,
  onSetUpError: (error) => {
    // A failure here means the database could not be opened at all. There is no
    // useful recovery in-process; surface it rather than running against a
    // half-initialised store.
    console.error('[db] failed to open local database', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [GearProfile, Target, TargetZone, Session, Round, Arrow],
});

export const collections = {
  gearProfiles: database.get<GearProfile>('gear_profiles'),
  targets: database.get<Target>('targets'),
  targetZones: database.get<TargetZone>('target_zones'),
  sessions: database.get<Session>('sessions'),
  rounds: database.get<Round>('rounds'),
  arrows: database.get<Arrow>('arrows'),
};

export { Arrow, GearProfile, Round, Session, Target, TargetZone };
