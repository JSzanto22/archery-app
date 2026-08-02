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
  zoneIndex: number;
  scoreValue: number;
  shapeType: ShapeType;
  shapeParams: ShapeParams;
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
function concentricRings(count: number, topScore = 10): PresetZone[] {
  return Array.from({ length: count }, (_, idx) => ({
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
function verticalThreeSpot(): PresetZone[] {
  const zones: PresetZone[] = [];

  for (let ring = 0; ring < 5; ring++) {
    for (let spot = 0; spot < 3; spot++) {
      zones.push({
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

export const PRESET_TARGETS: PresetTarget[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'WA 122 cm (10 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 122,
    aimPoints: CENTRE,
    zones: concentricRings(10),
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'WA 80 cm (10 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 80,
    aimPoints: CENTRE,
    zones: concentricRings(10),
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'WA 80 cm compound (6 ring)',
    baseShape: 'circle',
    aspectRatio: 1,
    faceWidthCm: 80,
    aimPoints: CENTRE,
    zones: concentricRings(6),
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    name: 'WA 40 cm vertical 3-spot',
    baseShape: 'rectangle',
    aspectRatio: 40 / 120,
    faceWidthCm: 40,
    aimPoints: [
      { x: 0.5, y: 1 / 6 },
      { x: 0.5, y: 3 / 6 },
      { x: 0.5, y: 5 / 6 },
    ],
    zones: verticalThreeSpot(),
  },
];

export function findPreset(id: string): PresetTarget | undefined {
  return PRESET_TARGETS.find((t) => t.id === id);
}
