/**
 * Per-shaft analysis.
 *
 * Archers number their arrows and log them individually for one reason: a
 * single bad shaft costs points every end and is invisible in a total. It
 * shows up as a wider group and gets blamed on technique. Plotting already
 * records where every arrow landed, so the only missing piece was knowing
 * which shaft made which mark.
 *
 * Two rules keep this from doing harm.
 *
 * **Numbering is opt-in.** It is derived by cycling shot order through the
 * archer's set size, which is only correct if they shoot their arrows in
 * order. That is the common habit but not a universal one, so the app numbers
 * nothing until the archer sets a set size. Misattributed arrows would blame
 * an innocent shaft, which is worse than saying nothing.
 *
 * **A claim needs a sample.** With six arrows and twelve ends a shaft is
 * observed twelve times. That is enough to notice a large effect and nowhere
 * near enough to rank six shafts against each other, so this reports an
 * outlier only when the gap is big relative to the spread of the whole set,
 * and stays quiet below `MIN_SHOTS_PER_ARROW`.
 */

import { centroid } from '../scoring/grouping';
import type { Point } from '../scoring/geometry';

/** Below this, a shaft's average position is mostly luck. */
export const MIN_SHOTS_PER_ARROW = 10;

/**
 * How far from the pack a shaft has to sit before it is worth naming.
 *
 * In standard deviations of the set's own offsets. Two is a deliberately high
 * bar: telling an archer to pull a good arrow costs them money and confidence.
 */
export const OUTLIER_SIGMA = 2;

export interface NumberedMark {
  arrowNumber: number | null;
  x: number;
  y: number;
  scoreValue: number;
}

export interface ArrowNumberStats {
  arrowNumber: number;
  shots: number;
  meanScore: number;
  /**
   * Distance from this shaft's average position to the group centre of every
   * arrow, in normalised face units. The signal for a shaft that lands
   * consistently off to one side.
   */
  offsetFromCentre: number;
  /** True when this shaft sits far enough out to be worth investigating. */
  isOutlier: boolean;
}

export interface ArrowNumberReport {
  /** Empty when the session carries no arrow numbers. */
  stats: ArrowNumberStats[];
  /** False when no shaft has been seen often enough to say anything. */
  hasEnoughData: boolean;
  /** Fewest shots any numbered shaft has, so the UI can say how far off it is. */
  minShots: number;
}

/**
 * Assign arrow numbers by cycling shot order through the set.
 *
 * Shot order is 1-based and continuous across the session, so with a set of
 * six, shots 1..6 are arrows 1..6 and shot 7 is arrow 1 again.
 */
export function numberForShot(
  shotOrder: number,
  setSize: number | null,
): number | null {
  if (!setSize || setSize < 1 || shotOrder < 1) return null;
  return ((shotOrder - 1) % setSize) + 1;
}

/**
 * How each numbered shaft is behaving.
 *
 * Offsets are measured from the centre of *all* arrows rather than the centre
 * of the face: the question is whether one shaft disagrees with the others,
 * not whether the sight is set correctly. A bow shooting left moves every
 * shaft equally and should not make all six look faulty.
 */
export function analyseArrowNumbers(marks: NumberedMark[]): ArrowNumberReport {
  const numbered = marks.filter(
    (mark): mark is NumberedMark & { arrowNumber: number } =>
      mark.arrowNumber !== null,
  );

  if (numbered.length === 0) {
    return { stats: [], hasEnoughData: false, minShots: 0 };
  }

  const overall = centroid(numbered.map((m) => ({ x: m.x, y: m.y })));
  if (!overall) return { stats: [], hasEnoughData: false, minShots: 0 };

  const byNumber = new Map<number, NumberedMark[]>();
  for (const mark of numbered) {
    const bucket = byNumber.get(mark.arrowNumber!) ?? [];
    bucket.push(mark);
    byNumber.set(mark.arrowNumber!, bucket);
  }

  const raw = [...byNumber.entries()]
    .map(([arrowNumber, shots]) => {
      const centre = centroid(shots.map((s) => ({ x: s.x, y: s.y })));
      const offset = centre ? distance(centre, overall) : 0;

      return {
        arrowNumber,
        shots: shots.length,
        meanScore:
          shots.reduce((sum, s) => sum + s.scoreValue, 0) / shots.length,
        offsetFromCentre: offset,
      };
    })
    .sort((a, b) => a.arrowNumber - b.arrowNumber);

  const minShots = raw.reduce(
    (fewest, entry) => Math.min(fewest, entry.shots),
    Number.POSITIVE_INFINITY,
  );

  const hasEnoughData = minShots >= MIN_SHOTS_PER_ARROW && raw.length >= 2;

  // Compared against the set's own spread rather than a fixed distance: a
  // tight archer's outlier is a millimetre, a beginner's is a hand's width.
  const offsets = raw.map((entry) => entry.offsetFromCentre);
  const meanOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const sd = standardDeviation(offsets, meanOffset);

  return {
    stats: raw.map((entry) => ({
      ...entry,
      isOutlier:
        hasEnoughData &&
        sd > 0 &&
        entry.offsetFromCentre - meanOffset > OUTLIER_SIGMA * sd,
    })),
    hasEnoughData,
    minShots: Number.isFinite(minShots) ? minShots : 0,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}
