/**
 * World Archery preset faces, bundled with the app.
 *
 * These are the same rows as `backend/db/seeds/0001_preset_targets.sql`, with
 * the same fixed ids and the same ring arithmetic. They ship in the binary so a
 * new install can score a session before it has ever reached the network —
 * pulling the presets down first would make "open the app at the range with no
 * signal" fail, which is the exact case the offline design exists for.
 *
 * Because the ids match, the first sync reconciles rather than duplicating.
 */

import { ShapeParams, ShapeType } from '../scoring/geometry';

export interface PresetZone {
  /** Deterministic — see {@link presetZoneId}. */
  id: string;
  zoneIndex: number;
  scoreValue: number;
  shapeType: ShapeType;
  shapeParams: ShapeParams;
}

/**
 * The id a preset's zone must have, on this device and on the server alike.
 *
 * Both sides ship these presets: the app so a new install can score before it
 * has ever reached the network, the server so every account sees the same
 * standard faces. If the two mint different zone ids the first sync does not
 * reconcile them — it adds a second complete set of rings to every preset
 * face, which is exactly what happened before this existed.
 *
 * `backend/db/seeds/0001_preset_targets.sql` builds the identical string in
 * SQL. Change one and you must change the other.
 */
export function presetZoneId(targetId: string, zoneIndex: number): string {
  // The last eight characters of the target id, e.g. '00000101' for the
  // 122 cm face, become the zone id's first group.
  const suffix = targetId.slice(-8);
  return `${suffix}-0000-4000-8000-${String(zoneIndex).padStart(12, '0')}`;
}

export interface PresetTarget {
  id: string;
  name: string;
  baseShape: string;
  /** faceWidth / faceHeight of the physical face. */
  aspectRatio: number;
  /** Physical face width in centimetres, for converting grouping to real units. */
  faceWidthCm: number;
  /** Where the archer aims. More than one on a multi-spot face. */
  aimPoints: Array<{ x: number; y: number }>;
  zones: PresetZone[];
}

/** Concentric rings: ring n from the centre has outer radius n * 0.5 / count. */
function concentricRings(
  targetId: string,
  count: number,
  topScore = 10,
): PresetZone[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: presetZoneId(targetId, idx),
    zoneIndex: idx,
    scoreValue: topScore - idx,
    shapeType: 'circle' as const,
    shapeParams: { cx: 0.5, cy: 0.5, r: ((idx + 1) * 0.5) / count },
  }));
}

/**
 * The vertical 3-spot, whose 40 x 120 cm face makes physically round rings come
 * out as ellipses once both axes are normalized to 0-1.
 *
 * Zone ordering interleaves the spots — every 10 ring must be tested before any
 * 9 ring, or an arrow in one face's 10 could be caught by a neighbour's 9.
 */
function verticalThreeSpot(targetId: string): PresetZone[] {
  const zones: PresetZone[] = [];

  for (let ring = 0; ring < 5; ring++) {
    for (let spot = 0; spot < 3; spot++) {
      zones.push({
        id: presetZoneId(targetId, ring * 3 + spot),
        zoneIndex: ring * 3 + spot,
        scoreValue: 10 - ring,
        shapeType: 'ellipse',
        shapeParams: {
          cx: 0.5,
          cy: (spot * 2 + 1) / 6,
          rx: (ring + 1) * 0.1,
          ry: ((ring + 1) * 0.1) / 3,
          rot: 0,
        },
      });
    }
  }

  return zones;
}

const CENTRE = [{ x: 0.5, y: 0.5 }];

const WA_122 = '00000000-0000-4000-8000-000000000101';
const WA_80 = '00000000-0000-4000-8000-000000000102';
const WA_80_COMPOUND = '00000000-0000-4000-8000-000000000103';
const WA_40_3SPOT = '00000000-0000-4000-8000-000000000104';

export const PRESET_TARGETS: PresetTarget[] = [
  {
    id: WA_122,
    name: 'WA 122 cm (10 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 122,
    aimPoints: CENTRE,
    zones: concentricRings(WA_122, 10),
  },
  {
    id: WA_80,
    name: 'WA 80 cm (10 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 80,
    aimPoints: CENTRE,
    zones: concentricRings(WA_80, 10),
  },
  {
    id: WA_80_COMPOUND,
    name: 'WA 80 cm compound (6 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 80,
    aimPoints: CENTRE,
    zones: concentricRings(WA_80_COMPOUND, 6),
  },
  {
    id: WA_40_3SPOT,
    name: 'WA 40 cm vertical 3-spot',
    baseShape: 'rectangle',
    aspectRatio: 40 / 120,
    faceWidthCm: 40,
    aimPoints: [
      { x: 0.5, y: 1 / 6 },
      { x: 0.5, y: 3 / 6 },
      { x: 0.5, y: 5 / 6 },
    ],
    zones: verticalThreeSpot(WA_40_3SPOT),
  },
];

export function findPreset(id: string): PresetTarget | undefined {
  return PRESET_TARGETS.find((t) => t.id === id);
}
