/**
 * X ring detection.
 *
 * The boundary cases are the ones that matter: an X ring is half the radius of
 * the 10 ring, so an arrow at 0.026 of the face from centre is a 10 and an
 * arrow at 0.024 is an X, and getting that edge wrong changes who wins a tie.
 */

import { PRESET_TARGETS } from '../../db/presets';
import { countInnerTens, hasInnerTen, isInnerTen, topScore } from '../innerTen';
import type { Zone } from '../scoring';

/** A WA metric face: ten rings, the 10 ring at 0.05 of the face width. */
function metricFace(): Zone[] {
  return Array.from({ length: 10 }, (_, i) => ({
    zoneIndex: i,
    scoreValue: 10 - i,
    shapeType: 'circle' as const,
    shapeParams: { cx: 0.5, cy: 0.5, r: ((i + 1) * 0.5) / 10 },
  }));
}

describe('the X ring on a single-spot face', () => {
  const zones = metricFace();

  it('is half the 10 ring', () => {
    // The 10 ring reaches 0.05 from centre, so the X reaches 0.025.
    expect(isInnerTen(zones, 0.5, 0.5 - 0.024)).toBe(true);
    expect(isInnerTen(zones, 0.5, 0.5 - 0.026)).toBe(false);
  });

  it('counts a dead centre arrow', () => {
    expect(isInnerTen(zones, 0.5, 0.5)).toBe(true);
  });

  it('does not count an arrow in the outer 10', () => {
    // Still worth ten points, still not an X. This is the distinction the
    // whole feature exists for.
    expect(isInnerTen(zones, 0.5, 0.5 - 0.04)).toBe(false);
  });

  it('does not count a 9', () => {
    expect(isInnerTen(zones, 0.5, 0.5 - 0.08)).toBe(false);
  });

  it('reports the top score of the face', () => {
    expect(topScore(zones)).toBe(10);
  });
});

describe('the X ring on a three-spot', () => {
  // The real preset: a 40 x 120 cm face, so the rings are ellipses once both
  // axes are normalised. A circular test would pass vertically and fail
  // horizontally, or the reverse.
  const zones =
    PRESET_TARGETS.find((t) => t.id === '00000000-0000-4000-8000-000000000104')
      ?.zones ?? [];

  it('exists', () => {
    expect(zones.length).toBeGreaterThan(0);
    expect(hasInnerTen(zones)).toBe(true);
  });

  it('is found on every spot, not just the middle one', () => {
    // Three 10 rings, at a sixth, a half and five sixths of the height.
    for (const cy of [1 / 6, 3 / 6, 5 / 6]) {
      expect(isInnerTen(zones, 0.5, cy)).toBe(true);
    }
  });

  it('respects the squashed vertical axis', () => {
    // The 10 ring is rx 0.1 by ry 0.0333, so the X is 0.05 by 0.0167. An
    // arrow 0.04 out horizontally is inside; the same distance vertically is
    // well outside.
    expect(isInnerTen(zones, 0.5 + 0.04, 3 / 6)).toBe(true);
    expect(isInnerTen(zones, 0.5, 3 / 6 + 0.04)).toBe(false);
  });

  it('does not count the gap between spots', () => {
    expect(isInnerTen(zones, 0.5, 2 / 6)).toBe(false);
  });
});

describe('faces with no X ring', () => {
  const polygonFace: Zone[] = [
    {
      zoneIndex: 0,
      scoreValue: 12,
      shapeType: 'polygon',
      shapeParams: {
        points: [
          [0.4, 0.4],
          [0.6, 0.4],
          [0.5, 0.6],
        ],
      },
    },
  ];

  it('are reported as having none', () => {
    // A custom silhouette has no X. Inventing one would be making up a rule
    // the archer never agreed to.
    expect(hasInnerTen(polygonFace)).toBe(false);
  });

  it('never report an X', () => {
    expect(isInnerTen(polygonFace, 0.5, 0.45)).toBe(false);
    expect(countInnerTens(polygonFace, [{ x: 0.5, y: 0.45 }])).toBe(0);
  });
});

describe('counting', () => {
  const zones = metricFace();

  it('counts only the Xs in a set of marks', () => {
    const marks = [
      { x: 0.5, y: 0.5 }, // X
      { x: 0.5, y: 0.51 }, // X
      { x: 0.5, y: 0.54 }, // outer 10
      { x: 0.5, y: 0.58 }, // 9
      { x: 0.1, y: 0.1 }, // miss
    ];

    expect(countInnerTens(zones, marks)).toBe(2);
  });

  it('counts nothing in an empty end', () => {
    expect(countInnerTens(zones, [])).toBe(0);
  });
});
