/**
 * Writes. Every mutation the vertical slice needs, in one place.
 *
 * Kept out of the screens on purpose: a write that must be wrapped in
 * `database.write`, keep `updated_at` truthful for sync, and resolve a score
 * against the right target is not something to re-derive in each component.
 */

import { Q } from '@nozbe/watermelondb';

import { scoreArrow } from '../scoring/scoring';
import { collections, database } from './index';
import Arrow from './models/Arrow';
import Round from './models/Round';
import Session from './models/Session';
import Target from './models/Target';

export interface NewSessionInput {
  shotAt: Date;
  distanceM: number | null;
  gearProfileId: string | null;
  equipmentTag: string | null;
  location: string | null;
  notes: string | null;
  targetId: string;
}

/**
 * Create a session together with its first round.
 *
 * A session with no rounds is a dead end in the UI — the archer would land on
 * an empty screen with nowhere to mark. Creating both keeps every path into
 * marking valid.
 */
export async function createSession(
  input: NewSessionInput,
): Promise<{ session: Session; round: Round }> {
  return database.write(async () => {
    const now = new Date();

    const session = await collections.sessions.create((s: Session) => {
      s.shotAt = input.shotAt;
      s.distanceM = input.distanceM;
      s.gearProfileId = input.gearProfileId;
      s.equipmentTag = input.equipmentTag;
      s.location = input.location;
      s.notes = input.notes;
      s.createdAt = now;
      s.updatedAt = now;
    });

    const round = await collections.rounds.create((r: Round) => {
      r.sessionId = session.id;
      r.targetId = input.targetId;
      r.roundOrder = 1;
      r.photoKey = null;
      r.localPhotoUri = null;
      r.createdAt = now;
      r.updatedAt = now;
    });

    return { session, round };
  });
}

/** Append a round to an existing session, continuing the board numbering. */
export async function addRound(
  session: Session,
  targetId: string,
): Promise<Round> {
  const existing = await collections.rounds
    .query(Q.where('session_id', session.id))
    .fetch();

  const nextOrder =
    existing.reduce((max, r) => Math.max(max, r.roundOrder), 0) + 1;

  return database.write(async () => {
    const now = new Date();
    return collections.rounds.create((r: Round) => {
      r.sessionId = session.id;
      r.targetId = targetId;
      r.roundOrder = nextOrder;
      r.photoKey = null;
      r.localPhotoUri = null;
      r.createdAt = now;
      r.updatedAt = now;
    });
  });
}

/**
 * Record a mark.
 *
 * The score is resolved here, against the target as it exists right now, and
 * stored. That is the one denormalization in the schema and it is deliberate:
 * editing a custom target later must not silently rewrite the scores of rounds
 * already shot at it.
 */
export async function addArrow(
  round: Round,
  target: Target,
  x: number,
  y: number,
): Promise<Arrow> {
  const zones = await target.toScoringZones();
  const score = scoreArrow(zones, x, y);

  const existing = await collections.arrows
    .query(Q.where('round_id', round.id))
    .fetch();

  const nextOrder =
    existing.reduce((max, a) => Math.max(max, a.shotOrder ?? 0), 0) + 1;

  return database.write(async () => {
    const now = new Date();
    return collections.arrows.create((a: Arrow) => {
      a.roundId = round.id;
      a.x = x;
      a.y = y;
      a.scoreValue = score;
      a.shotOrder = nextOrder;
      a.createdAt = now;
      a.updatedAt = now;
    });
  });
}

/**
 * Remove a mark — the undo path when a tap lands in the wrong place.
 *
 * `markAsDeleted`, not `destroyPermanently`. Watermelon keeps a local tombstone
 * so the next push can tell the server the row is gone; destroying it outright
 * would delete it here and leave it alive on every other device forever.
 */
export async function deleteArrow(arrow: Arrow): Promise<void> {
  await database.write(async () => {
    await arrow.markAsDeleted();
  });
}

/** Move an existing mark, re-resolving its score at the new position. */
export async function moveArrow(
  arrow: Arrow,
  target: Target,
  x: number,
  y: number,
): Promise<void> {
  const zones = await target.toScoringZones();
  const score = scoreArrow(zones, x, y);

  await database.write(async () => {
    await arrow.update((a: Arrow) => {
      a.x = x;
      a.y = y;
      a.scoreValue = score;
      a.updatedAt = new Date();
    });
  });
}

/** Attach a locally captured photo. Upload to S3 happens later, on sync. */
export async function attachLocalPhoto(
  round: Round,
  uri: string,
): Promise<void> {
  await database.write(async () => {
    await round.update((r: Round) => {
      r.localPhotoUri = uri;
      r.updatedAt = new Date();
    });
  });
}

export async function deleteSession(session: Session): Promise<void> {
  const rounds = await collections.rounds
    .query(Q.where('session_id', session.id))
    .fetch();

  // Postgres cascades this server-side, but the local store has no foreign keys
  // and Watermelon does not cascade — the children must be walked by hand or
  // they are orphaned locally and resurrected on the next pull.
  await database.write(async () => {
    for (const round of rounds) {
      const arrows = await collections.arrows
        .query(Q.where('round_id', round.id))
        .fetch();
      for (const arrow of arrows) {
        await arrow.markAsDeleted();
      }
      await round.markAsDeleted();
    }
    await session.markAsDeleted();
  });
}
