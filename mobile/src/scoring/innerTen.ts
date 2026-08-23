/**
 * The X ring.
 *
 * On every World Archery face the inner 10 — the X — is exactly half the
 * diameter of the 10 ring. It is not a separate score: an X is worth ten
 * points like any other 10. It matters because ties are decided on it. A 300
 * with 55X beats a 300 with 50X, so an app that cannot count them cannot
 * record a competitive result.
 *
 * Derived from position rather than stored as a flag on the arrow. The app
 * already knows where every arrow landed and what face it was shot at, so a
 * column would be a second copy of something computable — and one that could
 * disagree with the plot after a face was corrected. Deriving it also means no
 * schema change, no migration and nothing to sync.
 *
 * The halving is applied to the scoring zone itself rather than assumed to be
 * a circle, so it is correct on the 3-spot, whose rings are ellipses because
 * a 40 x 120 cm face squashes physically round rings once both axes are
 * normalised.
 */

import {
  type CircleParams,
  type EllipseParams,
  type ShapeParams,
  type ShapeType,
  pointInShape,
} from './geometry';
import type { Zone } from './scoring';

/** How much smaller the X ring is than the ring it sits inside. */
const X_RING_SCALE = 0.5;

/**
 * The same shape, half the size, about the same centre.
 *
 * Returns null for shapes with no meaningful centre-and-radius reading — a
 * freeform polygon or a rectangle is a custom face, and inventing an X ring
 * for one would be making up a rule the archer never agreed to.
 */
function halve(
  shapeType: ShapeType,
  params: ShapeParams,
): { shapeType: ShapeType; params: ShapeParams } | null {
  if (shapeType === 'circle') {
    const circle = params as CircleParams;
    return {
      shapeType,
      params: { ...circle, r: circle.r * X_RING_SCALE },
    };
  }

  if (shapeType === 'ellipse') {
    const ellipse = params as EllipseParams;
    return {
      shapeType,
      params: {
        ...ellipse,
        rx: ellipse.rx * X_RING_SCALE,
        ry: ellipse.ry * X_RING_SCALE,
      },
    };
  }

  return null;
}

/** The highest score any zone on this face awards. */
export function topScore(zones: Zone[]): number {
  return zones.reduce((best, zone) => Math.max(best, zone.scoreValue), 0);
}

/**
 * Whether this face has an X ring at all.
 *
 * A custom face built from polygons does not, and the scorecard should then
 * omit the column rather than show a column of zeroes.
 */
export function hasInnerTen(zones: Zone[]): boolean {
  const best = topScore(zones);
  return zones.some(
    (zone) =>
      zone.scoreValue === best && halve(zone.shapeType, zone.shapeParams),
  );
}

/**
 * Whether a mark landed in the X ring.
 *
 * Every top-scoring zone is checked, not just one: a 3-spot has three 10
 * rings, and an arrow in any of their inner halves is an X.
 */
export function isInnerTen(zones: Zone[], x: number, y: number): boolean {
  const best = topScore(zones);
  if (best <= 0) return false;

  for (const zone of zones) {
    if (zone.scoreValue !== best) continue;

    const inner = halve(zone.shapeType, zone.shapeParams);
    if (!inner) continue;

    if (pointInShape(inner.shapeType, inner.params, x, y)) return true;
  }

  return false;
}

/** How many of these marks are Xs. */
export function countInnerTens(
  zones: Zone[],
  marks: Array<{ x: number; y: number }>,
): number {
  if (!hasInnerTen(zones)) return 0;
  return marks.filter((mark) => isInnerTen(zones, mark.x, mark.y)).length;
}
