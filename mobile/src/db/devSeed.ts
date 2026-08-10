/**
 * Demo data for development builds.
 *
 * The app starts empty, and an empty dashboard shows none of what it is for —
 * no group map, no distribution, no trends. This fills it with a plausible
 * archer so the UI can be judged, screenshotted and iterated on without
 * standing at a range for three months.
 *
 * Mirrors the Postgres seed in backend/db/seeds/0002_demo_data.sql: shots are
 * drawn from a 2D normal around the aim point, the group tightens over time,
 * a low-left bias shrinks with it, and roughly one arrow in sixteen is a
 * flyer. Uniform random positions would make the group map and the grouping
 * figures meaningless.
 *
 * Never shipped to production: the only caller is a `__DEV__`-gated button.
 */

import { Q } from '@nozbe/watermelondb';

import { scoreArrow } from '../scoring/scoring';
import { collections, database } from './index';
import Arrow from './models/Arrow';
import Round from './models/Round';
import Session from './models/Session';
import Target from './models/Target';

const WA_122 = '00000000-0000-4000-8000-000000000101';
const WA_40_3SPOT = '00000000-0000-4000-8000-000000000104';

/** Box-Muller: one uniform pair gives two independent normals. */
function normalPair(): [number, number] {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

function clamp01(v: number): number {
  return Math.min(0.9995, Math.max(0.0005, v));
}

interface Scenario {
  targetId: string;
  distanceM: number;
  location: string;
  ends: number;
  arrowsPerEnd: number;
  /** Physical group sigma in cm, before the skill factor. */
  sigmaCm: number;
  faceWidthCm: number;
  aspectRatio: number;
  aimPoints: Array<{ x: number; y: number }>;
}

const SCENARIOS: Scenario[] = [
  {
    targetId: WA_122,
    distanceM: 70,
    location: 'County Field, main line',
    ends: 6,
    arrowsPerEnd: 6,
    sigmaCm: 11,
    faceWidthCm: 122,
    aspectRatio: 1,
    aimPoints: [{ x: 0.5, y: 0.5 }],
  },
  {
    targetId: WA_40_3SPOT,
    distanceM: 18,
    location: 'Riverside Indoor Range',
    ends: 10,
    arrowsPerEnd: 3,
    sigmaCm: 2.8,
    faceWidthCm: 40,
    aspectRatio: 40 / 120,
    aimPoints: [
      { x: 0.5, y: 1 / 6 },
      { x: 0.5, y: 3 / 6 },
      { x: 0.5, y: 5 / 6 },
    ],
  },
];

export interface DevSeedResult {
  sessions: number;
  arrows: number;
}

export async function seedDemoData(sessionCount = 14): Promise<DevSeedResult> {
  const targets = await collections.targets
    .query(Q.where('id', Q.oneOf([WA_122, WA_40_3SPOT])))
    .fetch();

  const targetById = new Map(targets.map((t) => [t.id, t]));
  const zonesById = new Map<
    string,
    Awaited<ReturnType<Target['toScoringZones']>>
  >();

  for (const target of targets) {
    zonesById.set(target.id, await target.toScoringZones());
  }

  let arrowTotal = 0;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  await database.write(async () => {
    for (let i = 0; i < sessionCount; i++) {
      const scenario = SCENARIOS[i % SCENARIOS.length];
      const target = targetById.get(scenario.targetId);
      const zones = zonesById.get(scenario.targetId);
      if (!target || !zones) continue;

      // Oldest first, roughly every five days, so the trend runs left to right.
      const shotAt = new Date(now - (sessionCount - i) * 5 * DAY);

      // Skill improves across the seeded period: sigma shrinks by ~30%.
      const skill = 1.15 - 0.3 * (i / Math.max(1, sessionCount - 1));
      const form = 0.9 + Math.random() * 0.25;

      const sigmaX = (scenario.sigmaCm / scenario.faceWidthCm) * skill * form;
      const sigmaY = sigmaX * scenario.aspectRatio;

      // A persistent low-left bias, shrinking with the group.
      const biasX = sigmaX * (-0.45 + Math.random() * 0.3);
      const biasY = sigmaY * (0.2 + Math.random() * 0.4);

      const session = await collections.sessions.create((s: Session) => {
        s.shotAt = shotAt;
        s.distanceM = scenario.distanceM;
        s.gearProfileId = null;
        s.equipmentTag = null;
        s.location = scenario.location;
        s.notes = null;
        s.createdAt = shotAt;
        s.updatedAt = shotAt;
      });

      for (let e = 1; e <= scenario.ends; e++) {
        const round = await collections.rounds.create((r: Round) => {
          r.sessionId = session.id;
          r.targetId = scenario.targetId;
          r.roundOrder = e;
          r.photoKey = null;
          r.localPhotoUri = null;
          r.createdAt = shotAt;
          r.updatedAt = shotAt;
        });

        for (let a = 1; a <= scenario.arrowsPerEnd; a++) {
          // On a multi-spot face one arrow goes in each spot.
          const aim = scenario.aimPoints[(a - 1) % scenario.aimPoints.length];

          const [z1, z2] = normalPair();
          const flyer = Math.random() < 0.06 ? 2.6 : 1;

          const x = clamp01(aim.x + biasX + z1 * sigmaX * flyer);
          const y = clamp01(aim.y + biasY + z2 * sigmaY * flyer);

          // Scored exactly as a real mark would be — never guessed.
          const score = scoreArrow(zones, x, y);

          await collections.arrows.create((arrow: Arrow) => {
            arrow.roundId = round.id;
            arrow.x = x;
            arrow.y = y;
            arrow.scoreValue = score;
            arrow.shotOrder = a;
            arrow.createdAt = shotAt;
            arrow.updatedAt = shotAt;
          });

          arrowTotal += 1;
        }
      }
    }
  });

  return { sessions: sessionCount, arrows: arrowTotal };
}

/** Remove every session, round and arrow. Leaves the preset targets alone. */
export async function clearAllSessions(): Promise<void> {
  const sessions = await collections.sessions.query().fetch();
  const rounds = await collections.rounds.query().fetch();
  const arrows = await collections.arrows.query().fetch();

  await database.write(async () => {
    for (const arrow of arrows) await arrow.destroyPermanently();
    for (const round of rounds) await round.destroyPermanently();
    for (const session of sessions) await session.destroyPermanently();
  });
}
