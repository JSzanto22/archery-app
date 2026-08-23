/**
 * Checked against the package that generates the official tables.
 *
 * Every expected value below is a fixture from `archeryutils`, which Archery GB
 * uses to produce the published handicap tables. They are not values this
 * implementation produced and were then frozen — that would only prove the code
 * has not changed, not that it is right.
 *
 * The margins are tight on purpose. A handicap is an integer an archer already
 * knows about themselves; drift of a tenth of a point in the expected score is
 * enough to move a borderline score onto the wrong row of the table.
 *
 * Source: https://github.com/jatkinson1000/archeryutils
 */

import {
  ARROW_DIAMETER_OUTDOOR_M,
  type Pass,
  type Ring,
  expectedArrowScore,
  expectedRoundScore,
  handicapForScore,
  handicapTable,
  sigmaR,
  sigmaT,
  tableScore,
} from '../handicap';

/**
 * Metric recurve rings: ten rings, the outermost at the edge of the face.
 * Ring n has diameter n·D/10, so radius n·D/20.
 */
function tenZone(faceDiameterM: number): Ring[] {
  return Array.from({ length: 10 }, (_, i) => ({
    radiusM: ((i + 1) * faceDiameterM) / 20,
    score: 10 - i,
  }));
}

/**
 * Imperial rings: five colours scoring 9, 7, 5, 3, 1, each a fifth of the
 * radius.
 */
function fiveZone(faceDiameterM: number): Ring[] {
  return [9, 7, 5, 3, 1].map((score, i) => ({
    radiusM: ((i + 1) * faceDiameterM) / 10,
    score,
  }));
}

describe('angular spread', () => {
  it.each([
    [25.46, 100.0, 0.002125743],
    [-12.0, 100.0, 0.000585929],
    [200.0, 10.0, 0.620202925],
    // Precision 8, not 9: the reference values are themselves quoted to nine
    // decimal places, so asserting to 5e-10 would be asserting tighter than
    // the data it is checked against.
  ])('sigma_t at handicap %p over %p m', (handicap, distance, expected) => {
    expect(sigmaT(handicap, distance)).toBeCloseTo(expected, 8);
  });

  it.each([
    [25.46, 100.0, 0.212574367],
    [-12.0, 56.54, 0.028268938],
    [200.0, 10.0, 6.202029252],
  ])('sigma_r at handicap %p over %p m', (handicap, distance, expected) => {
    expect(sigmaR(handicap, distance)).toBeCloseTo(expected, 8);
  });

  it('grows 3.5% per handicap point', () => {
    // The defining property of the scale, independent of the constants.
    const ratio = sigmaT(41, 50) / sigmaT(40, 50);
    expect(ratio).toBeCloseTo(1.035, 10);
  });
});

describe('expected arrow score', () => {
  const eightyCmAt50m = (rings: Ring[]): Pass => ({
    arrows: 1,
    distanceM: 50,
    rings,
    indoor: false,
  });

  it('matches the reference for a 10-zone face', () => {
    const score = expectedArrowScore(38, eightyCmAt50m(tenZone(0.8)));
    expect(score).toBeCloseTo(7.547210123, 7);
  });

  it('matches the reference for a 5-zone imperial face', () => {
    const score = expectedArrowScore(38, eightyCmAt50m(fiveZone(0.8)));
    expect(score).toBeCloseTo(7.044047485, 7);
  });

  it('rewards the fatter indoor shaft', () => {
    // Not a quirk of the model — indoor archers choose fat shafts precisely to
    // cut lines, and the scheme prices that in.
    const outdoor = expectedArrowScore(38, {
      ...eightyCmAt50m(tenZone(0.8)),
      indoor: false,
    });
    const indoor = expectedArrowScore(38, {
      ...eightyCmAt50m(tenZone(0.8)),
      indoor: true,
    });

    expect(indoor).toBeGreaterThan(outdoor);
  });

  it('honours an explicit arrow diameter', () => {
    const wide = expectedArrowScore(38, eightyCmAt50m(tenZone(0.8)), 9.3e-3);
    const narrow = expectedArrowScore(
      38,
      eightyCmAt50m(tenZone(0.8)),
      ARROW_DIAMETER_OUTDOOR_M,
    );

    expect(wide).toBeGreaterThan(narrow);
  });

  it('approaches a perfect arrow as the handicap improves', () => {
    expect(expectedArrowScore(-40, eightyCmAt50m(tenZone(0.8)))).toBeCloseTo(
      10,
      6,
    );
  });

  it('approaches a miss as the handicap worsens', () => {
    expect(expectedArrowScore(150, eightyCmAt50m(tenZone(0.8)))).toBeLessThan(
      0.2,
    );
  });
});

describe('round scores', () => {
  /** A WA 720 at 70 m: 72 arrows, 122 cm face. */
  const wa720: Pass[] = [
    { arrows: 72, distanceM: 70, rings: tenZone(1.22), indoor: false },
  ];

  /** Portsmouth: 60 arrows at 18 m on a 60 cm face, indoors. */
  const portsmouth: Pass[] = [
    { arrows: 60, distanceM: 18, rings: tenZone(0.6), indoor: true },
  ];

  it('sums passes at different distances and faces', () => {
    // The multi-distance case is where a per-pass mistake would hide.
    const mixed: Pass[] = [
      { arrows: 36, distanceM: 70, rings: tenZone(1.22), indoor: false },
      { arrows: 36, distanceM: 50, rings: tenZone(0.8), indoor: false },
    ];

    const combined = expectedRoundScore(40, mixed);
    const separately =
      expectedRoundScore(40, [mixed[0]!]) + expectedRoundScore(40, [mixed[1]!]);

    expect(combined).toBeCloseTo(separately, 10);
  });

  it('rounds a table score up, never down', () => {
    const raw = expectedRoundScore(40, wa720);
    expect(tableScore(40, wa720)).toBe(Math.ceil(raw));
  });

  it('falls as the handicap rises', () => {
    const scores = [20, 40, 60, 80].map((h) => tableScore(h, wa720));
    const descending = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(descending);
  });

  it('never exceeds a perfect round', () => {
    expect(tableScore(0, wa720)).toBeLessThanOrEqual(720);
    expect(tableScore(0, portsmouth)).toBeLessThanOrEqual(600);
  });
});

describe('handicap from a score', () => {
  const portsmouth: Pass[] = [
    { arrows: 60, distanceM: 18, rings: tenZone(0.6), indoor: true },
  ];

  it('is the best handicap whose required score was reached', () => {
    const handicap = handicapForScore(500, portsmouth);
    expect(handicap).not.toBeNull();

    // The defining property: the archer met this row's score, and missed the
    // one above it.
    expect(tableScore(handicap!, portsmouth)).toBeLessThanOrEqual(500);
    expect(tableScore(handicap! - 1, portsmouth)).toBeGreaterThan(500);
  });

  it('improves as the score rises', () => {
    const low = handicapForScore(400, portsmouth)!;
    const high = handicapForScore(560, portsmouth)!;
    expect(high).toBeLessThan(low);
  });

  it('refuses to invent a handicap for a score off the bottom of the scale', () => {
    // A first end is not a handicap of 150. Saying nothing is the honest
    // answer, and the app can say "not enough yet".
    expect(handicapForScore(0, portsmouth)).toBeNull();
  });

  it('agrees with its own table', () => {
    const table = handicapTable(portsmouth, { min: 20, max: 60 });

    for (const row of table) {
      expect(handicapForScore(row.score, portsmouth)).toBe(row.handicap);
    }
  });
});
