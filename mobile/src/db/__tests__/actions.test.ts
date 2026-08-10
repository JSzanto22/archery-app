/**
 * Tests for every write the app makes.
 *
 * This is the code where a bug costs someone their season rather than a
 * redraw, and until now none of it was covered. Two features in this codebase
 * turned out to be quietly broken precisely because they were never exercised
 * — sync had no caller, photos never uploaded — so the writes get pinned down
 * here rather than trusted.
 *
 * Runs against a real WatermelonDB over an in-memory LokiJS store, not a mock:
 * the behaviour worth testing (score resolution at write time, tombstones,
 * shot ordering) lives in the database layer, and a stub would assert nothing.
 */

// Must be hoisted above the imports of the modules under test. The factory
// cannot close over outer variables, so the database is built inside it and
// retrieved afterwards.
jest.mock('../index', () => {
  const { createTestDatabase: create } = require('../testing/testDatabase');
  const testDb = create();
  return { database: testDb.database, collections: testDb.collections };
});

import {
  addArrow,
  addRound,
  attachLocalPhoto,
  createSession,
  deleteArrow,
  deleteSession,
  moveArrow,
  restoreArrow,
  setTargetFaceWidth,
  toRestorable,
} from '../actions';
import { collections, database } from '../index';
import Arrow from '../models/Arrow';
import Round from '../models/Round';
import Target from '../models/Target';
import TargetZone from '../models/TargetZone';

const WA_122 = '00000000-0000-4000-8000-000000000101';

/** A ten-ring face, so scores are the real thing rather than a fixture. */
async function seedTarget(): Promise<Target> {
  return database.write(async () => {
    const target = await collections.targets.create((t: Target) => {
      t._raw.id = WA_122;
      t.name = 'WA 122 cm (10 ring)';
      t.type = 'preset';
      t.baseShape = 'circle';
      t.aspectRatio = 1;
      t.faceWidthCm = 122;
      t.createdAt = new Date();
      t.updatedAt = new Date();
    });

    for (let i = 0; i < 10; i++) {
      await collections.targetZones.create((z: TargetZone) => {
        z.targetId = target.id;
        z.zoneIndex = i;
        z.scoreValue = 10 - i;
        z.shapeType = 'circle';
        z.shapeParamsJson = JSON.stringify({
          cx: 0.5,
          cy: 0.5,
          r: ((i + 1) * 0.5) / 10,
        });
        z.createdAt = new Date();
        z.updatedAt = new Date();
      });
    }

    return target;
  });
}

async function newSession(targetId: string) {
  return createSession({
    shotAt: new Date('2026-07-01T10:00:00Z'),
    distanceM: 70,
    gearProfileId: null,
    equipmentTag: null,
    location: 'Test range',
    notes: null,
    targetId,
  });
}

let target: Target;

beforeEach(async () => {
  // One database serves the whole file, so each test starts by clearing it.
  // Children first: an orphaned arrow would survive its round.
  await database.write(async () => {
    for (const key of [
      'arrows',
      'rounds',
      'sessions',
      'targetZones',
      'targets',
    ] as const) {
      const rows = await collections[key].query().fetch();
      for (const row of rows) await row.destroyPermanently();
    }
  });

  target = await seedTarget();
});

describe('createSession', () => {
  it('creates a session with its first end', async () => {
    const { session, round } = await newSession(target.id);

    expect(session.distanceM).toBe(70);
    expect(session.location).toBe('Test range');
    // A session with no end is a dead end in the UI — nowhere to mark.
    expect(round.sessionId).toBe(session.id);
    expect(round.roundOrder).toBe(1);
  });

  it('gives records real UUIDs', async () => {
    const { session } = await newSession(target.id);
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('addArrow', () => {
  it('resolves the score at the moment of marking', async () => {
    const { round } = await newSession(target.id);

    const centre = await addArrow(round, target, 0.5, 0.5);
    const outer = await addArrow(round, target, 0.5, 0.97);

    expect(centre.scoreValue).toBe(10);
    expect(outer.scoreValue).toBe(1);
  });

  it('scores a mark off the face as a miss', async () => {
    const { round } = await newSession(target.id);
    const miss = await addArrow(round, target, 0.99, 0.99);

    expect(miss.scoreValue).toBe(0);
    expect(miss.isMiss).toBe(true);
  });

  it('numbers arrows in the order they were shot', async () => {
    const { round } = await newSession(target.id);

    const first = await addArrow(round, target, 0.5, 0.5);
    const second = await addArrow(round, target, 0.52, 0.5);
    const third = await addArrow(round, target, 0.48, 0.5);

    expect([first.shotOrder, second.shotOrder, third.shotOrder]).toEqual([
      1, 2, 3,
    ]);
  });

  it('reuses the freed position after a deletion', async () => {
    // Deleting the second arrow and shooting another makes the new one the
    // second arrow, so reusing the position is right for the archer. It does
    // mean the replacement collides with the deleted row's (round, shot_order)
    // until the tombstone is applied, which is why /sync/push applies each
    // table's deletions before its upserts.
    const { round } = await newSession(target.id);

    await addArrow(round, target, 0.5, 0.5);
    const second = await addArrow(round, target, 0.52, 0.5);
    await deleteArrow(second);
    const third = await addArrow(round, target, 0.48, 0.5);

    expect(third.shotOrder).toBe(2);
    expect(await round.orderedArrows.fetchCount()).toBe(2);
  });

  it('does not let one end see another end s arrows', async () => {
    const { session, round: first } = await newSession(target.id);
    const second = await addRound(session, target.id);

    await addArrow(first, target, 0.5, 0.5);
    const arrow = await addArrow(second, target, 0.5, 0.5);

    expect(arrow.shotOrder).toBe(1);
    expect(await first.orderedArrows.fetchCount()).toBe(1);
    expect(await second.orderedArrows.fetchCount()).toBe(1);
  });
});

describe('moveArrow', () => {
  it('re-resolves the score at the new position', async () => {
    const { round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);
    expect(arrow.scoreValue).toBe(10);

    await moveArrow(arrow, target, 0.5, 0.8);

    expect(arrow.x).toBeCloseTo(0.5, 6);
    expect(arrow.y).toBeCloseTo(0.8, 6);
    // 0.30 from centre is exactly the 5 ring's outer edge, and a line cutter
    // takes the higher value.
    expect(arrow.scoreValue).toBe(5);
  });

  it('can move a scoring arrow into a miss', async () => {
    const { round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);

    await moveArrow(arrow, target, 0.02, 0.02);
    expect(arrow.scoreValue).toBe(0);
  });
});

describe('deleteArrow and restoreArrow', () => {
  it('removes the arrow from its end', async () => {
    const { round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);

    await deleteArrow(arrow);

    expect(await round.orderedArrows.fetchCount()).toBe(0);
  });

  it('leaves a tombstone so the deletion can reach other devices', async () => {
    // destroyPermanently would remove it locally and leave it alive on every
    // other device forever.
    const { round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);

    await deleteArrow(arrow);

    const deleted = await database.adapter.getDeletedRecords('arrows');
    expect(deleted).toContain(arrow.id);
  });

  it('restores the original score and shot order verbatim', async () => {
    // Undo must return exactly what was there, not a fresh interpretation of
    // it — the stored score is deliberately not recomputed.
    const { round } = await newSession(target.id);
    await addArrow(round, target, 0.5, 0.5);
    const second = await addArrow(round, target, 0.5, 0.8);

    const restorable = toRestorable(second);
    await deleteArrow(second);
    const restored = await restoreArrow(round, restorable);

    expect(restored.scoreValue).toBe(5);
    expect(restored.shotOrder).toBe(2);
    expect(restored.x).toBeCloseTo(0.5, 6);
    expect(restored.y).toBeCloseTo(0.8, 6);
  });

  it('restores as a new record rather than resurrecting the deleted one', async () => {
    const { round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);
    const restorable = toRestorable(arrow);

    await deleteArrow(arrow);
    const restored = await restoreArrow(round, restorable);

    // The tombstone still has to reach the server; reusing the id would ask
    // it to both delete and keep the same row.
    expect(restored.id).not.toBe(arrow.id);
    expect(await round.orderedArrows.fetchCount()).toBe(1);
  });
});

describe('addRound', () => {
  it('continues the end numbering', async () => {
    const { session } = await newSession(target.id);

    const second = await addRound(session, target.id);
    const third = await addRound(session, target.id);

    expect(second.roundOrder).toBe(2);
    expect(third.roundOrder).toBe(3);
  });
});

describe('deleteSession', () => {
  it('takes its ends and arrows with it', async () => {
    // Postgres cascades this server-side, but the local store has no foreign
    // keys and Watermelon does not cascade — the children must be walked by
    // hand or they are orphaned locally and resurrected on the next pull.
    const { session, round } = await newSession(target.id);
    await addArrow(round, target, 0.5, 0.5);
    await addArrow(round, target, 0.52, 0.5);
    const second = await addRound(session, target.id);
    await addArrow(second, target, 0.5, 0.5);

    await deleteSession(session);

    expect(await collections.sessions.query().fetchCount()).toBe(0);
    expect(await collections.rounds.query().fetchCount()).toBe(0);
    expect(await collections.arrows.query().fetchCount()).toBe(0);
  });

  it('leaves tombstones for every removed record', async () => {
    const { session, round } = await newSession(target.id);
    const arrow = await addArrow(round, target, 0.5, 0.5);

    await deleteSession(session);

    expect(await database.adapter.getDeletedRecords('sessions')).toContain(
      session.id,
    );
    expect(await database.adapter.getDeletedRecords('rounds')).toContain(
      round.id,
    );
    expect(await database.adapter.getDeletedRecords('arrows')).toContain(
      arrow.id,
    );
  });

  it('does not touch another session', async () => {
    const first = await newSession(target.id);
    const second = await newSession(target.id);
    await addArrow(second.round, target, 0.5, 0.5);

    await deleteSession(first.session);

    expect(await collections.sessions.query().fetchCount()).toBe(1);
    expect(await collections.arrows.query().fetchCount()).toBe(1);
  });
});

describe('attachLocalPhoto', () => {
  it('records the local uri without inventing a storage key', async () => {
    // photo_key is written only after a successful upload; setting it here
    // would point at an object that does not exist.
    const { round } = await newSession(target.id);

    await attachLocalPhoto(round, 'file:///tmp/end.jpg');

    expect(round.localPhotoUri).toBe('file:///tmp/end.jpg');
    expect(round.photoKey).toBeNull();
    expect(round.hasPhoto).toBe(true);
  });
});

describe('setTargetFaceWidth', () => {
  it('stores a corrected face size', async () => {
    await setTargetFaceWidth(target, 60);
    expect(target.faceWidthCm).toBe(60);
  });

  it('accepts null for a face of unknown size', async () => {
    await setTargetFaceWidth(target, null);
    expect(target.faceWidthCm).toBeNull();
  });
});
