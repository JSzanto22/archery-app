/**
 * Arrow scoring.
 *
 * Per the architecture principle, this runs on the device. The backend stores
 * `arrows.score_value` but never computes it.
 */

import { pointInShape, ShapeParams, ShapeType } from './geometry';

/** A scoring zone, shaped as it comes out of `target_zones`. */
export interface Zone {
  zoneIndex: number;
  scoreValue: number;
  shapeType: ShapeType;
  shapeParams: ShapeParams;
}

/** An arrow that landed outside every scoring zone. */
export const MISS = 0;

/**
 * Score a single mark.
 *
 * Zones are tested in `zoneIndex` order and the first one containing the point
 * wins, so the innermost/highest-scoring zone must carry the lowest index. The
 * database enforces that the ordering is unique per target; it cannot enforce
 * that it is *correct*, so zones are sorted here rather than trusted to arrive
 * ordered.
 */
export function scoreArrow(zones: Zone[], x: number, y: number): number {
  const ordered = [...zones].sort((a, b) => a.zoneIndex - b.zoneIndex);

  for (const zone of ordered) {
    if (pointInShape(zone.shapeType, zone.shapeParams, x, y)) {
      return zone.scoreValue;
    }
  }

  return MISS;
}

export interface ScorableArrow {
  x: number;
  y: number;
  scoreValue: number;
}

/** Total of a set of marks. Misses contribute 0, which is already their value. */
export function totalScore(arrows: ScorableArrow[]): number {
  return arrows.reduce((sum, a) => sum + a.scoreValue, 0);
}

/** Mean score per arrow, or null when there is nothing to average. */
export function averageScore(arrows: ScorableArrow[]): number | null {
  if (arrows.length === 0) return null;
  return totalScore(arrows) / arrows.length;
}

/** How many marks missed the target entirely. */
export function missCount(arrows: ScorableArrow[]): number {
  return arrows.filter((a) => a.scoreValue === MISS).length;
}

/**
 * The best score a single arrow can earn on this target.
 *
 * Not always 10 — a 3D animal face scores 12, and a compound face bottoms out
 * at 5. Used to render "42/60" style round totals without hardcoding archery
 * assumptions that custom targets break.
 */
export function maxZoneScore(zones: Zone[]): number {
  return zones.reduce((best, z) => Math.max(best, z.scoreValue), 0);
}
