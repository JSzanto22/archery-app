/**
 * Sight marks.
 *
 * The number on the sight bar that puts arrows in the middle at a given
 * distance. Every archer keeps these — on tape round the riser, in a notebook,
 * in a phone photo — because arriving at 60 m without your mark costs an end
 * finding it again.
 *
 * The useful part is not storing them but filling the gaps. An archer records
 * marks at the distances they shoot; the app should still answer for the
 * distance in between, and warn rather than guess when asked for one far
 * outside what it has seen.
 *
 * The relationship is close to linear over the distances target archery uses,
 * and gently curved over the whole range because an arrow's flight is a
 * trajectory rather than a straight line. Two marks give a line; three or more
 * fit a quadratic, which is what the dedicated sight-mark apps do and what
 * matches the physics well enough over 18-90 m.
 */

/** One recorded mark. */
export interface SightMark {
  distanceM: number;
  /** The sight bar reading. Units are the archer's own — mm, clicks, tape. */
  mark: number;
}

export type Confidence =
  /** Between two recorded marks. */
  | 'interpolated'
  /** Beyond the recorded range, so the curve is being extended on faith. */
  | 'extrapolated'
  /** Exactly a distance the archer recorded. */
  | 'recorded';

export interface SightEstimate {
  distanceM: number;
  mark: number;
  confidence: Confidence;
}

/** Beyond this far outside the recorded range, refuse rather than guess. */
export const MAX_EXTRAPOLATION_M = 20;

/**
 * Estimate the mark for a distance.
 *
 * Returns null when there is nothing to go on, or when the distance is so far
 * outside the recorded range that the answer would be fiction. An archer who
 * has only shot 18 m indoors should be told the app does not know their 70 m
 * mark, not handed a confident wrong number.
 */
export function estimateMark(
  marks: SightMark[],
  distanceM: number,
): SightEstimate | null {
  const sorted = [...marks]
    .filter((m) => Number.isFinite(m.distanceM) && Number.isFinite(m.mark))
    .sort((a, b) => a.distanceM - b.distanceM);

  if (sorted.length === 0) return null;

  const exact = sorted.find((m) => m.distanceM === distanceM);
  if (exact) {
    return { distanceM, mark: exact.mark, confidence: 'recorded' };
  }

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  // A single mark cannot describe a slope, so there is nothing to inter- or
  // extrapolate along.
  if (sorted.length === 1) return null;

  const outside = distanceM < first.distanceM || distanceM > last.distanceM;
  if (outside) {
    const gap =
      distanceM < first.distanceM
        ? first.distanceM - distanceM
        : distanceM - last.distanceM;
    if (gap > MAX_EXTRAPOLATION_M) return null;
  }

  const mark =
    sorted.length >= 3
      ? quadraticAt(sorted, distanceM)
      : linearAt(first, last, distanceM);

  if (mark === null || !Number.isFinite(mark)) return null;

  return {
    distanceM,
    mark,
    confidence: outside ? 'extrapolated' : 'interpolated',
  };
}

/** Straight line through two marks. */
function linearAt(
  a: SightMark,
  b: SightMark,
  distanceM: number,
): number | null {
  const span = b.distanceM - a.distanceM;
  if (span === 0) return null;

  const slope = (b.mark - a.mark) / span;
  return a.mark + slope * (distanceM - a.distanceM);
}

/**
 * Least-squares quadratic through every mark, evaluated at one distance.
 *
 * Solved directly rather than with a matrix library: three unknowns is small
 * enough that Cramer's rule is clearer than pulling in a dependency, and it
 * keeps the failure case — a singular system, which happens when every mark is
 * at the same distance — visible as a zero determinant rather than an
 * exception from somewhere else.
 */
function quadraticAt(marks: SightMark[], distanceM: number): number | null {
  let n = 0;
  let sx = 0;
  let sx2 = 0;
  let sx3 = 0;
  let sx4 = 0;
  let sy = 0;
  let sxy = 0;
  let sx2y = 0;

  for (const { distanceM: x, mark: y } of marks) {
    const x2 = x * x;
    n += 1;
    sx += x;
    sx2 += x2;
    sx3 += x2 * x;
    sx4 += x2 * x2;
    sy += y;
    sxy += x * y;
    sx2y += x2 * y;
  }

  // [ sx4 sx3 sx2 ] [a]   [sx2y]
  // [ sx3 sx2 sx  ] [b] = [sxy ]
  // [ sx2 sx  n   ] [c]   [sy  ]
  const det =
    sx4 * (sx2 * n - sx * sx) -
    sx3 * (sx3 * n - sx * sx2) +
    sx2 * (sx3 * sx - sx2 * sx2);

  if (det === 0) return null;

  const detA =
    sx2y * (sx2 * n - sx * sx) -
    sx3 * (sxy * n - sx * sy) +
    sx2 * (sxy * sx - sx2 * sy);

  const detB =
    sx4 * (sxy * n - sx * sy) -
    sx2y * (sx3 * n - sx * sx2) +
    sx2 * (sx3 * sy - sxy * sx2);

  const detC =
    sx4 * (sx2 * sy - sxy * sx) -
    sx3 * (sx3 * sy - sxy * sx2) +
    sx2y * (sx3 * sx - sx2 * sx2);

  const a = detA / det;
  const b = detB / det;
  const c = detC / det;

  return a * distanceM * distanceM + b * distanceM + c;
}

/**
 * Marks for a ladder of distances, for a printable tape or a quick reference.
 *
 * Distances the archer has not recorded and the app cannot responsibly guess
 * are omitted rather than filled with a placeholder.
 */
export function markTable(
  marks: SightMark[],
  distances: number[],
): SightEstimate[] {
  return distances
    .map((distance) => estimateMark(marks, distance))
    .filter((estimate): estimate is SightEstimate => estimate !== null);
}
