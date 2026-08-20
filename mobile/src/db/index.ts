/**
 * Local database — the app's source of truth.
 *
 * Everything the UI reads comes from here. The network is an optional
 * background detail, not a precondition for using the app.
 */

import { Database } from '@nozbe/watermelondb';
import { setGenerator } from '@nozbe/watermelondb/utils/common/randomId';
import * as Crypto from 'expo-crypto';

import { createAdapter } from './adapter';
import Arrow from './models/Arrow';
import GearProfile from './models/GearProfile';
import Round from './models/Round';
import Session from './models/Session';
import SightMarkRecord from './models/SightMarkRecord';
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

// SQLite on device, LokiJS in the browser preview. Metro resolves which.
export const database = new Database({
  adapter: createAdapter(),
  modelClasses: [
    GearProfile,
    Target,
    TargetZone,
    Session,
    Round,
    Arrow,
    SightMarkRecord,
  ],
});

export const collections = {
  gearProfiles: database.get<GearProfile>('gear_profiles'),
  sightMarks: database.get<SightMarkRecord>('sight_marks'),
  targets: database.get<Target>('targets'),
  targetZones: database.get<TargetZone>('target_zones'),
  sessions: database.get<Session>('sessions'),
  rounds: database.get<Round>('rounds'),
  arrows: database.get<Arrow>('arrows'),
};

export {
  Arrow,
  GearProfile,
  Round,
  Session,
  SightMarkRecord,
  Target,
  TargetZone,
};
