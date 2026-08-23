/**
 * The Archery GB handicap scheme (2023 revision).
 *
 * A handicap is one number describing how tightly an archer's arrows leave the
 * bow. Because the scheme works by *predicting* a score from that spread, the
 * number is comparable across every round, distance, face size and bowstyle —
 * which is exactly what an average arrow score is not. It is also the number
 * club archers already know their own value of.
 *
 * That last point is why this file is a port rather than an approximation. An
 * archer who knows they shoot off 42 and sees 47 here will not report a bug;
 * they will stop believing anything else the app tells them. The constants and
 * the model below come from Archery GB's published scheme as implemented in
 * `archeryutils`, the package used to generate the official tables, and the
 * tests check this implementation against that package's own fixtures.
 *
 * The model, in full:
 *
 *   σ_θ = 5×10⁻⁴ · 1.035^(H + 6) · e^(0.00365·D)      angular spread, radians
 *   σ_r = σ_θ · D                                      group spread at the face
 *
 *   S̄  = maxScore − Σ drop_i · e^(−((r_arrow + r_i) / σ_r)²)
 *
 * where the sum runs over scoring rings from the centre out, `drop_i` is the
 * points lost on crossing ring i, and `r_arrow` is the arrow's radius — the
 * line-cutter allowance, which is why indoor arrows (fatter shafts, chosen for
 * exactly this reason) score measurably better for the same handicap.
 *
 * The exponential is the tail of a Rayleigh distribution: the probability an
 * arrow lands outside radius r.
 */

/** 3.5% more angular spread per handicap point. */
const STEP = 0.035;

/** Handicap offset, so that the scale lands where Archery GB wants it. */
const DATUM = 6;

/** Angular spread at the scratch handicap, in radians. */
const ANGLE_0 = 5.0e-4;

/** Growth in spread with distance, beyond simple projection. */
const DISTANCE_COEFFICIENT = 0.00365;

/**
 * Default arrow diameters, in metres.
 *
 * Indoors archers shoot deliberately fat shafts to cut lines, and the scheme
 * accounts for it: the same handicap predicts a higher indoor score.
 */
export const ARROW_DIAMETER_OUTDOOR_M = 5.5e-3;
export const ARROW_DIAMETER_INDOOR_M = 9.3e-3;

/** A scoring ring: everything inside `radiusM` is worth at least `score`. */
export interface Ring {
  /** Radius from the centre of the face, in metres. */
  radiusM: number;
  score: number;
}

/** One distance within a round: so many arrows at one face, at one distance. */
export interface Pass {
  arrows: number;
  distanceM: number;
  /** Rings from the centre out. */
  rings: Ring[];
  /** Fat shafts are allowed indoors and the scheme expects them. */
  indoor: boolean;
}

/** Angular standard deviation of the launch direction, in radians. */
export function sigmaT(handicap: number, distanceM: number): number {
  return (
    ANGLE_0 *
    Math.pow(1 + STEP, handicap + DATUM) *
    Math.exp(DISTANCE_COEFFICIENT * distanceM)
  );
}

/** Radial standard deviation of the arrow group at the face, in metres. */
export function sigmaR(handicap: number, distanceM: number): number {
  return sigmaT(handicap, distanceM) * distanceM;
}

/**
 * Points lost on crossing each ring, from the centre out.
 *
 * The outermost ring drops to zero — beyond it is a miss.
 */
function scoreDrops(rings: Ring[]): number[] {
  return rings.map((ring, index) => {
    const next = rings[index + 1];
    return ring.score - (next ? next.score : 0);
  });
}

/**
 * Expected score for a single arrow at a given handicap.
 *
 * Returns a fractional value: it is an expectation over many arrows, not a
 * score anyone shoots.
 */
export function expectedArrowScore(
  handicap: number,
  pass: Pass,
  arrowDiameterM?: number,
): number {
  const rings = [...pass.rings].sort((a, b) => a.radiusM - b.radiusM);
  const first = rings[0];
  if (!first) return 0;

  const diameter =
    arrowDiameterM ??
    (pass.indoor ? ARROW_DIAMETER_INDOOR_M : ARROW_DIAMETER_OUTDOOR_M);
  const arrowRadius = diameter / 2;

  const spread = sigmaR(handicap, pass.distanceM);
  const drops = scoreDrops(rings);

  let lost = 0;
  for (const [index, ring] of rings.entries()) {
    const reach = (arrowRadius + ring.radiusM) / spread;
    lost += (drops[index] ?? 0) * Math.exp(-(reach * reach));
  }

  return first.score - lost;
}

/** Expected score for a whole round, before rounding. */
export function expectedRoundScore(handicap: number, passes: Pass[]): number {
  return passes.reduce(
    (total, pass) => total + pass.arrows * expectedArrowScore(handicap, pass),
    0,
  );
}

/**
 * The score Archery GB's table gives for a handicap.
 *
 * Rounded *up*. The tables are built so that achieving the tabled score is
 * achieving that handicap, and rounding down would hand out a handicap the
 * archer has not shot.
 */
export function tableScore(handicap: number, passes: Pass[]): number {
  return Math.ceil(expectedRoundScore(handicap, passes));
}

/**
 * The best handicap whose tabled score this result reaches.
 *
 * Lower is better, and the table decreases as the handicap rises — so this is
 * the smallest handicap whose required score the archer met. Returns null for
 * a score below the bottom of the scale, which is the honest answer for a
 * first end rather than a handicap of 150.
 */
export function handicapForScore(
  score: number,
  passes: Pass[],
  { min = 0, max = 150 }: { min?: number; max?: number } = {},
): number | null {
  if (score <= 0) return null;

  for (let handicap = min; handicap <= max; handicap++) {
    if (tableScore(handicap, passes) <= score) return handicap;
  }

  return null;
}

/**
 * A full handicap table for a round: score required for each handicap.
 *
 * The same data Archery GB publishes as a PDF, which is what makes it worth
 * showing an archer — they can check it against the sheet on the club wall.
 */
export function handicapTable(
  passes: Pass[],
  { min = 0, max = 150 }: { min?: number; max?: number } = {},
): Array<{ handicap: number; score: number }> {
  const rows: Array<{ handicap: number; score: number }> = [];
  for (let handicap = min; handicap <= max; handicap++) {
    rows.push({ handicap, score: tableScore(handicap, passes) });
  }
  return rows;
}
