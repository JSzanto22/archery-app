/**
 * These tests exist to keep device scoring identical to the SQL in
 * `backend/db/seeds/0002_demo_data.sql`. The zone fixtures below are built with
 * the same arithmetic as `backend/db/seeds/0001_preset_targets.sql`, so if a
 * ring formula changes on one side, this fails on the other.
 */

import { pointInShape } from '../geometry';
import { MISS, maxZoneScore, scoreArrow, Zone } from '../scoring';
import {
  accuracyOffset,
  centroid,
  groupSpread,
  groupSpreadMultiSpot,
  heatMapGrid,
} from '../grouping';

/** WA 10-ring face: ring n from centre has outer radius n * 0.5 / 10. */
const tenRing: Zone[] = Array.from({ length: 10 }, (_, idx) => ({
  zoneIndex: idx,
  scoreValue: 10 - idx,
  shapeType: 'circle' as const,
  shapeParams: { cx: 0.5, cy: 0.5, r: ((idx + 1) * 0.5) / 10 },
}));

/** WA 80 cm compound face: 6 rings, 10 down to 5. */
const sixRing: Zone[] = Array.from({ length: 6 }, (_, idx) => ({
  zoneIndex: idx,
  scoreValue: 10 - idx,
  shapeType: 'circle' as const,
  shapeParams: { cx: 0.5, cy: 0.5, r: ((idx + 1) * 0.5) / 6 },
}));

/** WA 40 cm vertical 3-spot: ellipses, ry = rx / 3, spots interleaved by ring. */
const threeSpot: Zone[] = [];
for (let ring = 0; ring < 5; ring++) {
  for (let spot = 0; spot < 3; spot++) {
    threeSpot.push({
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

/** The seeded custom 3D deer, abbreviated to the zones that matter here. */
const deer: Zone[] = [
  {
    zoneIndex: 0,
    scoreValue: 12,
    shapeType: 'circle',
    shapeParams: { cx: 0.45, cy: 0.44, r: 0.035 },
  },
  {
    zoneIndex: 1,
    scoreValue: 10,
    shapeType: 'circle',
    shapeParams: { cx: 0.45, cy: 0.44, r: 0.09 },
  },
  {
    zoneIndex: 2,
    scoreValue: 8,
    shapeType: 'polygon',
    shapeParams: {
      points: [
        [0.3, 0.3],
        [0.46, 0.25],
        [0.62, 0.28],
        [0.66, 0.42],
        [0.62, 0.58],
        [0.44, 0.6],
        [0.32, 0.52],
        [0.28, 0.4],
      ],
    },
  },
];

describe('scoreArrow on concentric ring faces', () => {
  it('scores the centre 10', () => {
    expect(scoreArrow(tenRing, 0.5, 0.5)).toBe(10);
  });

  it('scores each ring at its midpoint', () => {
    // Midpoint of the ring scoring s sits at radius (11 - s - 0.5) * 0.05.
    for (let score = 10; score >= 1; score--) {
      const radius = (11 - score - 0.5) * 0.05;
      expect(scoreArrow(tenRing, 0.5 + radius, 0.5)).toBe(score);
    }
  });

  it('treats the ring boundary as belonging to the higher score', () => {
    // The 10 ring's outer edge is r = 0.05. A mark exactly on the line is a 10:
    // "line cutters" score the higher value in every archery ruleset.
    expect(scoreArrow(tenRing, 0.55, 0.5)).toBe(10);
    expect(scoreArrow(tenRing, 0.55001, 0.5)).toBe(9);
  });

  it('returns a miss outside the face', () => {
    // The face is a circle of radius 0.5, so the corners of the 0-1 square are
    // off the target even though their coordinates are in range.
    expect(scoreArrow(tenRing, 0.999, 0.999)).toBe(MISS);
    expect(scoreArrow(tenRing, 0.05, 0.95)).toBe(MISS);

    // Straight below the centre is still on the face: 0.499 < 0.5.
    expect(scoreArrow(tenRing, 0.5, 0.999)).toBe(1);
  });

  it('does not assume the lowest score is 1', () => {
    // The compound face bottoms out at 5, and its outermost ring reaches the
    // same face edge the 10-ring face's 1 ring does.
    expect(scoreArrow(sixRing, 0.5, 0.999)).toBe(5);
    expect(scoreArrow(sixRing, 0.5, 0.5 + 0.5)).toBe(5);
    expect(scoreArrow(sixRing, 0.9, 0.9)).toBe(MISS);

    // Ring midpoints, 10 down to 5.
    for (let score = 10; score >= 5; score--) {
      const radius = ((11 - score - 0.5) * 0.5) / 6;
      expect(scoreArrow(sixRing, 0.5 + radius, 0.5)).toBe(score);
    }
  });

  it('scores independently of zone array order', () => {
    const shuffled = [...tenRing].reverse();
    expect(scoreArrow(shuffled, 0.5, 0.5)).toBe(10);
    expect(scoreArrow(shuffled, 0.5 + 0.22, 0.5)).toBe(
      scoreArrow(tenRing, 0.5 + 0.22, 0.5),
    );
  });
});

describe('scoreArrow on the vertical 3-spot', () => {
  it('scores a 10 in each of the three faces', () => {
    expect(scoreArrow(threeSpot, 0.5, 1 / 6)).toBe(10);
    expect(scoreArrow(threeSpot, 0.5, 3 / 6)).toBe(10);
    expect(scoreArrow(threeSpot, 0.5, 5 / 6)).toBe(10);
  });

  it('respects the squashed aspect: y is three times as tight as x', () => {
    // rx of the 10 ring is 0.1, ry is 0.0333.
    expect(scoreArrow(threeSpot, 0.5 + 0.09, 0.5)).toBe(10);
    expect(scoreArrow(threeSpot, 0.5, 0.5 + 0.09)).not.toBe(10);
    expect(scoreArrow(threeSpot, 0.5, 0.5 + 0.03)).toBe(10);
  });

  it('scores the gap between faces as a miss', () => {
    // Between the top and middle faces, outside every ellipse.
    expect(scoreArrow(threeSpot, 0.05, 1 / 3)).toBe(MISS);
  });
});

describe('scoreArrow on a custom polygon target', () => {
  it('finds the inner ring, the vital, and the body in order', () => {
    expect(scoreArrow(deer, 0.45, 0.44)).toBe(12);
    expect(scoreArrow(deer, 0.45, 0.51)).toBe(10);
    expect(scoreArrow(deer, 0.6, 0.3)).toBe(8);
  });

  it('misses outside the silhouette', () => {
    expect(scoreArrow(deer, 0.05, 0.05)).toBe(MISS);
  });

  it('reports the real maximum, not an assumed 10', () => {
    expect(maxZoneScore(deer)).toBe(12);
    expect(maxZoneScore(tenRing)).toBe(10);
    expect(maxZoneScore(sixRing)).toBe(10);
  });
});

describe('polygon edge cases', () => {
  const square = {
    points: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ] as Array<[number, number]>,
  };

  it('contains an interior point and excludes an exterior one', () => {
    expect(pointInShape('polygon', square, 0.5, 0.5)).toBe(true);
    expect(pointInShape('polygon', square, 0.1, 0.5)).toBe(false);
    expect(pointInShape('polygon', square, 0.9, 0.5)).toBe(false);
  });

  it('does not double-count a vertex lying on the ray', () => {
    // A point level with a vertex is the classic ray-casting failure: a naive
    // implementation counts that vertex twice and reports outside as inside.
    expect(pointInShape('polygon', square, 0.05, 0.2)).toBe(false);
    expect(pointInShape('polygon', square, 0.05, 0.8)).toBe(false);
  });

  it('handles a concave shape', () => {
    const chevron = {
      points: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.5, 0.4],
        [0.1, 0.9],
      ] as Array<[number, number]>,
    };
    expect(pointInShape('polygon', chevron, 0.5, 0.2)).toBe(true);
    // Inside the bounding box but in the notch, so genuinely outside.
    expect(pointInShape('polygon', chevron, 0.5, 0.8)).toBe(false);
  });
});

describe('rotation', () => {
  it('rotates a rectangle about its own centre', () => {
    const rect = { x: 0.4, y: 0.1, w: 0.2, h: 0.8 };
    // Tall and thin, axis-aligned: (0.5, 0.85) is inside, (0.85, 0.5) is not.
    expect(pointInShape('rectangle', rect, 0.5, 0.85)).toBe(true);
    expect(pointInShape('rectangle', rect, 0.85, 0.5)).toBe(false);

    // Rotated 90 degrees, the two swap.
    const rotated = { ...rect, rot: 90 };
    expect(pointInShape('rectangle', rotated, 0.5, 0.85)).toBe(false);
    expect(pointInShape('rectangle', rotated, 0.85, 0.5)).toBe(true);
  });

  it('rotates an ellipse about its centre', () => {
    const wide = { cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.1 };
    expect(pointInShape('ellipse', wide, 0.85, 0.5)).toBe(true);
    expect(pointInShape('ellipse', wide, 0.5, 0.85)).toBe(false);

    const upright = { ...wide, rot: 90 };
    expect(pointInShape('ellipse', upright, 0.85, 0.5)).toBe(false);
    expect(pointInShape('ellipse', upright, 0.5, 0.85)).toBe(true);
  });
});

describe('grouping', () => {
  const tightGroup = [
    { x: 0.50, y: 0.50 },
    { x: 0.52, y: 0.50 },
    { x: 0.51, y: 0.52 },
    { x: 0.49, y: 0.51 },
  ];

  const looseGroup = [
    { x: 0.30, y: 0.30 },
    { x: 0.70, y: 0.30 },
    { x: 0.70, y: 0.70 },
    { x: 0.30, y: 0.70 },
  ];

  it('reports a smaller spread for a tighter group', () => {
    expect(groupSpread(tightGroup)!).toBeLessThan(groupSpread(looseGroup)!);
  });

  it('needs at least two marks', () => {
    expect(groupSpread([])).toBeNull();
    expect(groupSpread([{ x: 0.5, y: 0.5 }])).toBeNull();
  });

  it('separates consistency from accuracy', () => {
    // The same tight group, moved off the middle. Spread is unchanged; only the
    // offset moves. This is the distinction the dashboard is built on.
    const shifted = tightGroup.map((p) => ({ x: p.x - 0.25, y: p.y + 0.2 }));

    expect(groupSpread(shifted)).toBeCloseTo(groupSpread(tightGroup)!, 10);
    expect(accuracyOffset(shifted)!).toBeGreaterThan(accuracyOffset(tightGroup)!);
  });

  it('corrects distance for a non-square face', () => {
    const vertical = [
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.6 },
    ];
    // On a face three times taller than wide, the same normalized y-offset is
    // worth a third as much in real terms.
    const square = groupSpread(vertical, { aspectRatio: 1 })!;
    const squashed = groupSpread(vertical, { aspectRatio: 1 / 3 })!;
    expect(squashed).toBeCloseTo(square / 3, 10);
  });

  it('does not mistake 3-spot layout for a loose group', () => {
    const aimPoints = [
      { x: 0.5, y: 1 / 6 },
      { x: 0.5, y: 3 / 6 },
      { x: 0.5, y: 5 / 6 },
    ];
    // One tight arrow per spot: excellent shooting.
    const marks = [
      { x: 0.50, y: 1 / 6 + 0.005 },
      { x: 0.51, y: 3 / 6 - 0.004 },
      { x: 0.49, y: 5 / 6 + 0.003 },
    ];

    const naive = groupSpread(marks)!;
    const perSpot = groupSpreadMultiSpot(marks, aimPoints)!;

    // The naive figure is dominated by the spacing of the faces themselves.
    expect(naive).toBeGreaterThan(0.2);
    expect(perSpot).toBeLessThan(0.02);
  });

  it('finds the centroid', () => {
    const c = centroid(looseGroup)!;
    expect(c.x).toBeCloseTo(0.5, 12);
    expect(c.y).toBeCloseTo(0.5, 12);
    expect(centroid([])).toBeNull();
  });
});

describe('heatMapGrid', () => {
  it('normalizes the busiest cell to 1', () => {
    const grid = heatMapGrid(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.1, y: 0.1 },
      ],
      4,
    );
    expect(Math.max(...grid)).toBe(1);
    expect(grid).toHaveLength(16);
  });

  it('keeps a mark on the far edge inside the grid', () => {
    // x = 1 would index one cell past the end without the clamp.
    const grid = heatMapGrid([{ x: 1, y: 1 }], 4);
    expect(grid[15]).toBe(1);
  });

  it('returns an empty grid for no marks', () => {
    expect(heatMapGrid([], 3).every((c) => c === 0)).toBe(true);
  });
});
