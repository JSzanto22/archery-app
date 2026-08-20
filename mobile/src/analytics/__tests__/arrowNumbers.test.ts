/**
 * Per-shaft analysis.
 *
 * The dangerous failure here is a false accusation: telling an archer to pull
 * a perfectly good arrow. Most of these check that the module stays quiet.
 */

import {
  MIN_SHOTS_PER_ARROW,
  type NumberedMark,
  analyseArrowNumbers,
  numberForShot,
} from '../arrowNumbers';

describe('assigning numbers', () => {
  it('cycles shot order through the set', () => {
    const set = 6;
    expect([1, 2, 6, 7, 12, 13].map((s) => numberForShot(s, set))).toEqual([
      1, 2, 6, 1, 6, 1,
    ]);
  });

  it('assigns nothing without a set size', () => {
    // Opt-in. Guessing would attribute arrows to shafts that never shot them.
    expect(numberForShot(3, null)).toBeNull();
  });

  it('rejects a nonsense set size', () => {
    expect(numberForShot(3, 0)).toBeNull();
    expect(numberForShot(3, -2)).toBeNull();
  });
});

/** Marks for one shaft, clustered near a point. */
function shaft(
  arrowNumber: number,
  centre: { x: number; y: number },
  shots: number,
  jitter = 0.002,
): NumberedMark[] {
  return Array.from({ length: shots }, (_, i) => ({
    arrowNumber,
    // Deterministic spread, so the test does not flake.
    x: centre.x + (i % 2 === 0 ? jitter : -jitter),
    y: centre.y + (i % 3 === 0 ? jitter : -jitter),
    scoreValue: 9,
  }));
}

describe('analysing a set', () => {
  it('says nothing when no arrow carries a number', () => {
    const marks: NumberedMark[] = [
      { arrowNumber: null, x: 0.5, y: 0.5, scoreValue: 10 },
    ];

    const report = analyseArrowNumbers(marks);
    expect(report.stats).toHaveLength(0);
    expect(report.hasEnoughData).toBe(false);
  });

  it('withholds a verdict below the minimum sample', () => {
    const marks = [
      ...shaft(1, { x: 0.5, y: 0.5 }, 4),
      // Wildly off, but only seen four times.
      ...shaft(2, { x: 0.7, y: 0.7 }, 4),
    ];

    const report = analyseArrowNumbers(marks);
    expect(report.hasEnoughData).toBe(false);
    expect(report.stats.every((s) => !s.isOutlier)).toBe(true);
    expect(report.minShots).toBe(4);
  });

  it('reports per-shaft stats once the sample is there', () => {
    const marks = [
      ...shaft(1, { x: 0.5, y: 0.5 }, MIN_SHOTS_PER_ARROW),
      ...shaft(2, { x: 0.5, y: 0.5 }, MIN_SHOTS_PER_ARROW),
    ];

    const report = analyseArrowNumbers(marks);
    expect(report.hasEnoughData).toBe(true);
    expect(report.stats.map((s) => s.arrowNumber)).toEqual([1, 2]);
    expect(report.stats[0]!.shots).toBe(MIN_SHOTS_PER_ARROW);
  });

  it('finds the shaft that lands away from the pack', () => {
    const marks = [
      ...shaft(1, { x: 0.5, y: 0.5 }, 12),
      ...shaft(2, { x: 0.5, y: 0.5 }, 12),
      ...shaft(3, { x: 0.5, y: 0.5 }, 12),
      ...shaft(4, { x: 0.5, y: 0.5 }, 12),
      ...shaft(5, { x: 0.5, y: 0.5 }, 12),
      // One shaft consistently high and right.
      ...shaft(6, { x: 0.62, y: 0.62 }, 12),
    ];

    const report = analyseArrowNumbers(marks);
    const flagged = report.stats.filter((s) => s.isOutlier);

    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.arrowNumber).toBe(6);
  });

  it('accuses nobody when every shaft agrees', () => {
    const marks = Array.from({ length: 6 }, (_, i) =>
      shaft(i + 1, { x: 0.5, y: 0.5 }, 12),
    ).flat();

    const report = analyseArrowNumbers(marks);
    expect(report.stats.some((s) => s.isOutlier)).toBe(false);
  });

  it('does not blame every shaft for a bow shooting left', () => {
    // The whole set moved together. That is a sight problem, and measuring
    // from the group centre rather than the face centre is what keeps this
    // from reporting six faulty arrows.
    const marks = Array.from({ length: 6 }, (_, i) =>
      shaft(i + 1, { x: 0.3, y: 0.5 }, 12),
    ).flat();

    const report = analyseArrowNumbers(marks);
    expect(report.stats.some((s) => s.isOutlier)).toBe(false);
  });

  it('averages each shaft its own score', () => {
    const marks: NumberedMark[] = [
      { arrowNumber: 1, x: 0.5, y: 0.5, scoreValue: 10 },
      { arrowNumber: 1, x: 0.5, y: 0.5, scoreValue: 8 },
      { arrowNumber: 2, x: 0.5, y: 0.5, scoreValue: 6 },
    ];

    const report = analyseArrowNumbers(marks);
    expect(report.stats[0]!.meanScore).toBe(9);
    expect(report.stats[1]!.meanScore).toBe(6);
  });
});
