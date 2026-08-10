/**
 * Integration tests against the real Postgres from docker-compose.
 *
 * Deliberately not mocked. The things most likely to be wrong here are the
 * things a mock would paper over: whether the constraints in the migration
 * actually fire, whether NUMERIC round-trips, whether ownership filters
 * exclude what they should, and whether the sync payload matches what the
 * device expects. A stubbed database would pass all of those while broken.
 *
 * Start the database first:  docker compose up -d
 */

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { sessions, targets, users } from '../db/schema.js';

const TEST_USER = '22222222-2222-4222-8222-000000000000';
const OTHER_USER = '33333333-3333-4333-8333-000000000000';
const WA_122 = '00000000-0000-4000-8000-000000000101';

let app: FastifyInstance;

/** Deterministic ids so a failed run leaves rows that are easy to find. */
const ids = {
  session: '44444444-4444-4444-8444-000000000001',
  round: '44444444-4444-4444-8444-000000000002',
  arrow1: '44444444-4444-4444-8444-000000000003',
  arrow2: '44444444-4444-4444-8444-000000000004',
  otherSession: '44444444-4444-4444-8444-000000000005',
  customTarget: '44444444-4444-4444-8444-000000000006',
  zone: '44444444-4444-4444-8444-000000000007',
  gear: '44444444-4444-4444-8444-000000000008',
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await cleanup();

  // A second user's session, to prove ownership filters actually exclude it.
  await db
    .insert(users)
    .values({ id: OTHER_USER, email: 'other@example.invalid' })
    .onConflictDoNothing();

  await db
    .insert(sessions)
    .values({
      id: ids.otherSession,
      ownerId: OTHER_USER,
      shotAt: new Date('2026-01-01T10:00:00Z'),
      syncStatus: 'synced',
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await closeDatabase();
});

async function cleanup() {
  await db.delete(sessions).where(eq(sessions.ownerId, TEST_USER));
  await db.delete(sessions).where(eq(sessions.ownerId, OTHER_USER));
  await db.delete(targets).where(eq(targets.ownerId, TEST_USER));
  await db.delete(users).where(eq(users.id, TEST_USER));
  await db.delete(users).where(eq(users.id, OTHER_USER));
}

describe('health', () => {
  it('answers without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

describe('GET /me', () => {
  it('creates the profile row on first call', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(TEST_USER);
  });

  it('is idempotent', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(TEST_USER);
  });

  it('updates consent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      payload: { researchConsent: true, displayName: 'Test Archer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().researchConsent).toBe(true);
    expect(res.json().displayName).toBe('Test Archer');
  });
});

describe('GET /targets', () => {
  it('returns the shared presets with their zones in scoring order', async () => {
    const res = await app.inject({ method: 'GET', url: '/targets' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Array<{
      id: string;
      name: string;
      zones: Array<{ zoneIndex: number; scoreValue: number }>;
    }>;

    const wa122 = body.find((t) => t.id === WA_122);
    expect(wa122).toBeDefined();
    expect(wa122!.zones).toHaveLength(10);

    // Innermost zone first, highest score first — the order scoring depends on.
    expect(wa122!.zones[0]!.zoneIndex).toBe(0);
    expect(wa122!.zones[0]!.scoreValue).toBe(10);
    expect(wa122!.zones[9]!.scoreValue).toBe(1);
  });

  it('gives preset zones the deterministic ids the app expects', async () => {
    // The app ships the same faces so it can score offline. When the two sides
    // minted different zone ids, the first sync added a second complete set of
    // rings to every preset face instead of reconciling. The scheme is
    // <target-suffix8>-0000-4000-8000-<zone index, 12 digits>, mirrored in
    // mobile/src/db/presets.ts.
    const res = await app.inject({ method: 'GET', url: `/targets/${WA_122}` });
    const zones = res.json().zones as Array<{ id: string; zoneIndex: number }>;

    for (const zone of zones) {
      const expected = `00000101-0000-4000-8000-${String(zone.zoneIndex).padStart(12, '0')}`;
      expect(zone.id).toBe(expected);
    }
  });

  it('has exactly one zone per ring, with no duplicates', async () => {
    for (const [id, expected] of [
      [WA_122, 10],
      ['00000000-0000-4000-8000-000000000103', 6],
      ['00000000-0000-4000-8000-000000000104', 15],
    ] as const) {
      const res = await app.inject({ method: 'GET', url: `/targets/${id}` });
      const zones = res.json().zones as Array<{ zoneIndex: number }>;

      expect(zones).toHaveLength(expected);
      expect(new Set(zones.map((z) => z.zoneIndex)).size).toBe(expected);
    }
  });

  it('carries the physical dimensions of each preset face', async () => {
    // Without these the device cannot report grouping in centimetres, and the
    // 3-spot's vertical correction is wrong by a factor of three.
    const res = await app.inject({ method: 'GET', url: '/targets' });
    const body = res.json() as Array<{
      id: string;
      aspectRatio: string | null;
      faceWidthCm: string | null;
    }>;

    const wa122 = body.find((t) => t.id === WA_122)!;
    expect(Number(wa122.faceWidthCm)).toBe(122);
    expect(Number(wa122.aspectRatio)).toBe(1);

    const threeSpot = body.find(
      (t) => t.id === '00000000-0000-4000-8000-000000000104',
    )!;
    expect(Number(threeSpot.faceWidthCm)).toBe(40);
    // 40 cm wide over 120 cm tall.
    expect(Number(threeSpot.aspectRatio)).toBeCloseTo(1 / 3, 3);
  });

  it('includes the 3-spot as ellipses, not circles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/targets/00000000-0000-4000-8000-000000000104',
    });
    expect(res.statusCode).toBe(200);

    const zones = res.json().zones as Array<{
      shapeType: string;
      shapeParams: { rx: number; ry: number };
    }>;

    expect(zones).toHaveLength(15);
    expect(zones[0]!.shapeType).toBe('ellipse');
    // The 40 x 120 cm face squashes y to a third of x.
    expect(zones[0]!.shapeParams.ry).toBeCloseTo(
      zones[0]!.shapeParams.rx / 3,
      5,
    );
  });
});

describe('POST /sessions', () => {
  it('accepts a whole session in one call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        id: ids.session,
        shotAt: '2026-07-30T14:00:00.000Z',
        distanceM: 70,
        location: 'Test range',
        notes: 'Integration test',
        rounds: [
          {
            id: ids.round,
            targetId: WA_122,
            roundOrder: 1,
            arrows: [
              { id: ids.arrow1, x: 0.5, y: 0.5, scoreValue: 10, shotOrder: 1 },
              { id: ids.arrow2, x: 0.42, y: 0.56, scoreValue: 8, shotOrder: 2 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(ids.session);
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0].arrows).toHaveLength(2);
  });

  it('rejects an arrow outside the normalized range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        id: '55555555-5555-4555-8555-000000000001',
        shotAt: '2026-07-30T14:00:00.000Z',
        rounds: [
          {
            id: '55555555-5555-4555-8555-000000000002',
            targetId: WA_122,
            roundOrder: 1,
            arrows: [
              {
                id: '55555555-5555-4555-8555-000000000003',
                x: 1.7,
                y: 0.5,
                scoreValue: 10,
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('round-trips coordinates and distance without losing precision', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${ids.session}`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    // NUMERIC comes back from pg as a string by default; the type parser in
    // db/client.ts is what makes these numbers.
    expect(body.distanceM).toBe(70);
    expect(body.rounds[0].arrows[0].x).toBe(0.5);
    expect(body.rounds[0].arrows[1].x).toBeCloseTo(0.42, 6);
    expect(body.rounds[0].arrows[1].y).toBeCloseTo(0.56, 6);
  });
});

describe('ownership', () => {
  it("does not list another user's sessions", async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Array<{ id: string }>;
    expect(body.some((s) => s.id === ids.session)).toBe(true);
    expect(body.some((s) => s.id === ids.otherSession)).toBe(false);
  });

  it("returns 404, not 403, for another user's session", async () => {
    // 403 would confirm the id exists. 404 tells the caller nothing.
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${ids.otherSession}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("will not delete another user's session", async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${ids.otherSession}`,
    });
    expect(res.statusCode).toBe(404);

    const still = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, ids.otherSession));
    expect(still).toHaveLength(1);
  });
});

describe('custom targets', () => {
  it('creates one with zones and marks it custom, not preset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/targets',
      payload: {
        id: ids.customTarget,
        name: 'Test deer',
        baseShape: 'silhouette',
        faceWidthCm: 60,
        aspectRatio: 1.5,
        zones: [
          {
            id: ids.zone,
            zoneIndex: 0,
            scoreValue: 12,
            shapeType: 'circle',
            shapeParams: { cx: 0.45, cy: 0.44, r: 0.035 },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe('custom');
    expect(res.json().ownerId).toBe(TEST_USER);
  });

  it('stores the face dimensions it was given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/targets/${ids.customTarget}`,
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().faceWidthCm)).toBe(60);
    expect(Number(res.json().aspectRatio)).toBe(1.5);
  });

  it('rejects a face width of zero', async () => {
    // Zero would divide by zero converting grouping to centimetres.
    const res = await app.inject({
      method: 'POST',
      url: '/targets',
      payload: {
        id: '88888888-8888-4888-8888-000000000001',
        name: 'Bad face',
        faceWidthCm: 0,
        zones: [
          {
            id: '88888888-8888-4888-8888-000000000002',
            zoneIndex: 0,
            scoreValue: 10,
            shapeType: 'circle',
            shapeParams: { cx: 0.5, cy: 0.5, r: 0.1 },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to let a user edit a shared preset', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/targets/${WA_122}`,
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('refuses to delete a target that has recorded rounds', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/targets/${WA_122}`,
    });
    // A preset is not owned, so this is a 404 before the FK is ever reached.
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /rounds/:id/arrows', () => {
  it('replaces the whole set', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/rounds/${ids.round}/arrows`,
      payload: {
        arrows: [
          {
            id: '66666666-6666-4666-8666-000000000001',
            x: 0.51,
            y: 0.49,
            scoreValue: 10,
            shotOrder: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().arrows).toHaveLength(1);

    const session = await app.inject({
      method: 'GET',
      url: `/sessions/${ids.session}`,
    });
    expect(session.json().rounds[0].arrows).toHaveLength(1);
  });
});

describe('GET /sync/pull', () => {
  it("returns every table in the client's column names", async () => {
    const res = await app.inject({ method: 'GET', url: '/sync/pull' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.timestamp).toBeTruthy();

    for (const table of [
      'gear_profiles',
      'targets',
      'target_zones',
      'sessions',
      'rounds',
      'arrows',
    ]) {
      expect(body.changes[table]).toBeDefined();
      expect(Array.isArray(body.changes[table].created)).toBe(true);
    }

    const session = body.changes.sessions.created.find(
      (s: { id: string }) => s.id === ids.session,
    );
    expect(session).toBeDefined();
    // snake_case, and no owner_id or sync_status — the device has neither column.
    expect(session.shot_at).toBeTruthy();
    expect(session.owner_id).toBeUndefined();
    expect(session.sync_status).toBeUndefined();

    // shape_params must be a string: SQLite has no JSON type.
    const zone = body.changes.target_zones.created[0] as {
      shape_params: string;
    };
    expect(typeof zone.shape_params).toBe('string');
    expect(() => JSON.parse(zone.shape_params) as unknown).not.toThrow();
  });

  it('round-trips face geometry instead of nulling it', async () => {
    // The regression this guards: the serializer used to hardcode
    // aspect_ratio: null and omit face_width_cm, so the first pull silently
    // erased both on every device that applied it.
    const res = await app.inject({ method: 'GET', url: '/sync/pull' });
    const targetsOut = res.json().changes.targets.created as Array<{
      id: string;
      aspect_ratio: string | null;
      face_width_cm: string | null;
    }>;

    const wa122 = targetsOut.find((t) => t.id === WA_122)!;
    expect(wa122.aspect_ratio).not.toBeNull();
    expect(Number(wa122.face_width_cm)).toBe(122);

    const threeSpot = targetsOut.find(
      (t) => t.id === '00000000-0000-4000-8000-000000000104',
    )!;
    expect(Number(threeSpot.aspect_ratio)).toBeCloseTo(1 / 3, 3);
    expect(Number(threeSpot.face_width_cm)).toBe(40);
  });

  it('excludes rows unchanged since the watermark', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/sync/pull?since=${encodeURIComponent(future)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changes.sessions.created).toHaveLength(0);
    expect(body.changes.sessions.updated).toHaveLength(0);
  });
});

describe('POST /sync/push', () => {
  const pushedSession = '77777777-7777-4777-8777-000000000001';

  it('applies a batch created offline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: {
        lastPulledAt: null,
        changes: {
          gear_profiles: {
            created: [
              {
                id: ids.gear,
                name: 'Pushed recurve',
                bow_type: 'recurve',
                notes: null,
                created_at: '2026-07-01T09:00:00.000Z',
                updated_at: '2026-07-01T09:00:00.000Z',
              },
            ],
            updated: [],
            deleted: [],
          },
          sessions: {
            created: [
              {
                id: pushedSession,
                shot_at: '2026-07-28T09:00:00.000Z',
                distance_m: 30,
                gear_profile_id: ids.gear,
                equipment_tag: null,
                location: 'Pushed from device',
                notes: null,
                created_at: '2026-07-28T09:00:00.000Z',
                updated_at: '2026-07-28T09:00:00.000Z',
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const check = await app.inject({
      method: 'GET',
      url: `/sessions/${pushedSession}`,
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().location).toBe('Pushed from device');
    // The server marks what it has received as synced.
    expect(check.json().syncStatus).toBe('synced');
  });

  it('keeps the newer write when an older one arrives late', async () => {
    // Simulates a second device pushing a stale copy after the first won.
    const newer = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: {
        changes: {
          sessions: {
            created: [],
            updated: [
              {
                id: pushedSession,
                shot_at: '2026-07-28T09:00:00.000Z',
                distance_m: 30,
                gear_profile_id: null,
                equipment_tag: null,
                location: 'Newer wins',
                notes: null,
                created_at: '2026-07-28T09:00:00.000Z',
                updated_at: '2026-07-29T12:00:00.000Z',
              },
            ],
            deleted: [],
          },
        },
      },
    });
    expect(newer.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: {
        changes: {
          sessions: {
            created: [],
            updated: [
              {
                id: pushedSession,
                shot_at: '2026-07-28T09:00:00.000Z',
                distance_m: 30,
                gear_profile_id: null,
                equipment_tag: null,
                location: 'Stale loses',
                notes: null,
                created_at: '2026-07-28T09:00:00.000Z',
                updated_at: '2026-07-29T08:00:00.000Z',
              },
            ],
            deleted: [],
          },
        },
      },
    });
    expect(stale.statusCode).toBe(200);

    const check = await app.inject({
      method: 'GET',
      url: `/sessions/${pushedSession}`,
    });
    expect(check.json().location).toBe('Newer wins');
  });

  it("accepts an arrow that reuses a deleted arrow's shot number", async () => {
    // The archer deletes the second arrow of an end and shoots another. The
    // replacement really is the second arrow, so the client reuses shot_order
    // 2 — but the deleted row still holds (round_id, shot_order) until its
    // tombstone is applied. Upserting before deleting hit the unique index and
    // rolled the entire sync back.
    const sessionId = '99999999-9999-4999-8999-000000000001';
    const roundId = '99999999-9999-4999-8999-000000000002';
    const firstArrow = '99999999-9999-4999-8999-000000000003';
    const replacement = '99999999-9999-4999-8999-000000000004';
    const at = '2026-07-30T10:00:00.000Z';

    const seeded = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        id: sessionId,
        shotAt: at,
        rounds: [
          {
            id: roundId,
            targetId: WA_122,
            roundOrder: 1,
            arrows: [
              { id: firstArrow, x: 0.5, y: 0.5, scoreValue: 10, shotOrder: 2 },
            ],
          },
        ],
      },
    });
    expect(seeded.statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: {
        changes: {
          arrows: {
            created: [
              {
                id: replacement,
                round_id: roundId,
                x: 0.48,
                y: 0.52,
                score_value: 9,
                // The same position the deleted arrow occupies.
                shot_order: 2,
                created_at: at,
                updated_at: at,
              },
            ],
            updated: [],
            deleted: [firstArrow],
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const check = await app.inject({
      method: 'GET',
      url: `/sessions/${sessionId}`,
    });
    const remaining = check.json().rounds[0].arrows as Array<{
      id: string;
      shotOrder: number;
    }>;

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(replacement);
    expect(remaining[0]!.shotOrder).toBe(2);
  });

  it("ignores a push aimed at another user's session", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: {
        changes: {
          sessions: {
            created: [],
            updated: [
              {
                id: ids.otherSession,
                shot_at: '2026-01-01T10:00:00.000Z',
                distance_m: null,
                gear_profile_id: null,
                equipment_tag: null,
                location: 'Hijacked',
                notes: null,
                created_at: '2026-01-01T10:00:00.000Z',
                updated_at: '2030-01-01T10:00:00.000Z',
              },
            ],
            deleted: [],
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const row = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, ids.otherSession));

    // Still the other user's, still untouched, despite a far-future timestamp.
    expect(row[0]!.ownerId).toBe(OTHER_USER);
    expect(row[0]!.location).toBeNull();
  });
});
