/**
 * Grouping analytics.
 *
 * Grouping answers "how consistent was I", independently of where the group
 * sat. Score answers "how well did I aim". They are different questions and the
 * dashboard plots them separately — never on a shared axis.
 *
 * Nothing here is persisted. Every figure is derived from `arrows.x/y` on read.
 *
 * ## Two caveats that will bite if ignored
 *
 * 1. **Units are normalized face widths, not centimetres.** A 0.09 group on a
 *    122 cm face is ~11 cm; the same 0.09 on an 80 cm face is ~7 cm. Comparing
 *    grouping across face sizes without converting compares nothing. Use
 *    {@link toCentimetres} when the target's physical size is known.
 *
 * 2. **On a non-square face, x and y are scaled differently.** The WA vertical
 *    3-spot is 40 cm wide and 120 cm tall, so a normalized y-distance is worth
 *    three times a normalized x-distance in real terms. Euclidean distance in
 *    normalized space is therefore *not* physical distance on such faces. Pass
 *    an aspect ratio to correct it.
 */

import { Point } from './geometry';

export interface GroupingOptions {
  /**
   * faceWidth / faceHeight of the physical target. 1 for any round face; 1/3
   * for the WA vertical 3-spot. Normalized y-offsets are multiplied by this so
   * distances come out proportional to real ones.
   */
  aspectRatio?: number;
}

function scaledDistance(a: Point, b: Point, aspectRatio: number): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * aspectRatio;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Mean position of a set of marks. Null when there are none. */
export function centroid(points: Point[]): Point | null {
  if (points.length === 0) return null;

  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }

  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Mean distance from the group's own centre — the headline grouping figure.
 *
 * Measured about the centroid rather than the target centre on purpose: a
 * tight group in the 7 ring is good shooting with a bad sight mark, and the two
 * problems have different fixes. {@link accuracyOffset} reports the other half.
 */
export function groupSpread(
  points: Point[],
  options: GroupingOptions = {},
): number | null {
  if (points.length < 2) return null;

  const aspect = options.aspectRatio ?? 1;
  const c = centroid(points)!;

  const total = points.reduce((sum, p) => sum + scaledDistance(p, c, aspect), 0);
  return total / points.length;
}

/**
 * Distance from the group's centre to the aim point — systematic bias, the part
 * a sight adjustment fixes.
 */
export function accuracyOffset(
  points: Point[],
  aimPoint: Point = { x: 0.5, y: 0.5 },
  options: GroupingOptions = {},
): number | null {
  const c = centroid(points);
  if (!c) return null;
  return scaledDistance(c, aimPoint, options.aspectRatio ?? 1);
}

/**
 * Grouping on a multi-spot face.
 *
 * On a 3-spot the archer deliberately puts one arrow in each face, so measuring
 * spread about a single centroid describes the *layout of the target*, not the
 * archer — it returns roughly a third of the face height no matter how well
 * they shot. Each mark is assigned to its nearest aim point and spread is
 * measured within those clusters, then pooled.
 */
export function groupSpreadMultiSpot(
  points: Point[],
  aimPoints: Point[],
  options: GroupingOptions = {},
): number | null {
  if (aimPoints.length <= 1) return groupSpread(points, options);

  const aspect = options.aspectRatio ?? 1;

  // Translate every mark into the frame of the aim point it belongs to, then
  // measure the pooled cloud as one group.
  //
  // Clustering and measuring each spot separately looks equivalent but is not:
  // the standard indoor round puts exactly ONE arrow in each face, so every
  // cluster would hold a single point, every per-cluster spread would be
  // undefined, and the archer would get no grouping figure at all on the one
  // round they shoot most.
  const translated = points.map((p) => {
    let nearest = aimPoints[0];
    let best = Infinity;

    for (const aim of aimPoints) {
      const d = scaledDistance(p, aim, aspect);
      if (d < best) {
        best = d;
        nearest = aim;
      }
    }

    return { x: p.x - nearest.x, y: p.y - nearest.y };
  });

  return groupSpread(translated, options);
}

/** Convert a normalized distance to centimetres on a face of known width. */
export function toCentimetres(
  normalizedDistance: number,
  faceWidthCm: number,
): number {
  return normalizedDistance * faceWidthCm;
}

export interface GroupBias {
  /** Signed offset from the aim point, normalized. Positive x = right. */
  dx: number;
  /** Positive y = low (screen coordinates run downward). */
  dy: number;
  /** Magnitude of the offset. */
  distance: number;
  /** Plain-language direction, e.g. "low left". Null when centred. */
  direction: string | null;
}

/**
 * Where the group sits relative to the aim point.
 *
 * The single most actionable number in the app: a tight group in the 7 ring is
 * good shooting with a bad sight mark, and the fix is a sight adjustment
 * rather than more practice. Spread says how consistent; this says which way
 * to move.
 */
export function groupBias(
  points: Point[],
  aimPoint: Point = { x: 0.5, y: 0.5 },
  options: GroupingOptions = {},
): GroupBias | null {
  const c = centroid(points);
  if (!c) return null;

  const aspect = options.aspectRatio ?? 1;
  const dx = c.x - aimPoint.x;
  const dy = (c.y - aimPoint.y) * aspect;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return { dx, dy, distance, direction: describeDirection(dx, dy) };
}

/**
 * Name a direction, ignoring axes the group is already centred on.
 *
 * The 2% dead zone stops the label flickering between "left" and "right" over
 * a offset too small to correct for.
 */
function describeDirection(dx: number, dy: number): string | null {
  const DEAD_ZONE = 0.02;

  const vertical = Math.abs(dy) < DEAD_ZONE ? '' : dy > 0 ? 'low' : 'high';
  const horizontal = Math.abs(dx) < DEAD_ZONE ? '' : dx > 0 ? 'right' : 'left';

  const label = [vertical, horizontal].filter(Boolean).join(' ');
  return label === '' ? null : label;
}

/** Count of arrows at each score, highest first. Drives the distribution bar. */
export function scoreDistribution(
  scores: number[],
): Array<{ score: number; count: number }> {
  const counts = new Map<number, number>();
  for (const score of scores) {
    counts.set(score, (counts.get(score) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Standard deviation of arrow scores — shot-to-shot consistency.
 *
 * Distinct from spread: two archers can average 8 with the same group size,
 * but the one alternating 10s and 6s has a different problem from the one
 * shooting 8s all day.
 */
export function scoreConsistency(scores: number[]): number | null {
  if (scores.length < 2) return null;

  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance =
    scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;

  return Math.sqrt(variance);
}

/**
 * Density grid for the heat map, counting marks per cell.
 *
 * Returned row-major, `resolution * resolution` entries, each 0-1 where 1 is
 * the busiest cell. Aggregating here rather than handing thousands of raw
 * points to the renderer is what keeps the dashboard responsive over a long
 * date range.
 */
export function heatMapGrid(points: Point[], resolution = 24): number[] {
  const cells = new Array<number>(resolution * resolution).fill(0);
  if (points.length === 0) return cells;

  for (const p of points) {
    const col = Math.min(resolution - 1, Math.floor(p.x * resolution));
    const row = Math.min(resolution - 1, Math.floor(p.y * resolution));
    cells[row * resolution + col] += 1;
  }

  const peak = Math.max(...cells);
  return peak === 0 ? cells : cells.map((c) => c / peak);
}
