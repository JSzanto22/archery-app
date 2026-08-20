/**
 * Sight mark estimation.
 *
 * A wrong mark costs an end finding the right one, so the module's most
 * important behaviour is knowing when not to answer.
 */

import {
  MAX_EXTRAPOLATION_M,
  type SightMark,
  estimateMark,
  markTable,
} from '../sightMarks';

/** A realistic recurve set: the mark rises steadily with distance. */
const RECORDED: SightMark[] = [
  { distanceM: 20, mark: 3.2 },
  { distanceM: 30, mark: 4.6 },
  { distanceM: 50, mark: 7.4 },
  { distanceM: 70, mark: 10.6 },
];

describe('a distance the archer recorded', () => {
  it('is returned exactly, not fitted', () => {
    // Fitting a curve through the archer's own data and handing back a
    // slightly different number would be absurd, and they would notice.
    const estimate = estimateMark(RECORDED, 50);
    expect(estimate).toEqual({
      distanceM: 50,
      mark: 7.4,
      confidence: 'recorded',
    });
  });
});

describe('a distance in between', () => {
  it('is interpolated', () => {
    const estimate = estimateMark(RECORDED, 40);
    expect(estimate).not.toBeNull();
    expect(estimate!.confidence).toBe('interpolated');
    // Between the 30 m and 50 m marks, and nearer the middle than either.
    expect(estimate!.mark).toBeGreaterThan(4.6);
    expect(estimate!.mark).toBeLessThan(7.4);
  });

  it('follows a straight line when only two marks are known', () => {
    const twoMarks: SightMark[] = [
      { distanceM: 20, mark: 4 },
      { distanceM: 40, mark: 8 },
    ];

    expect(estimateMark(twoMarks, 30)!.mark).toBeCloseTo(6, 10);
  });

  it('curves when three or more are known', () => {
    // A quadratic through points that genuinely curve must not return the
    // straight-line answer, or the fit is doing nothing.
    const curved: SightMark[] = [
      { distanceM: 20, mark: 4 },
      { distanceM: 40, mark: 8 },
      { distanceM: 60, mark: 14 },
    ];

    const straightLineGuess = 11; // midpoint of 8 and 14
    expect(estimateMark(curved, 50)!.mark).not.toBeCloseTo(
      straightLineGuess,
      2,
    );
  });
});

describe('a distance outside what is known', () => {
  it('is extrapolated within reach, and labelled as such', () => {
    const estimate = estimateMark(RECORDED, 80);
    expect(estimate).not.toBeNull();
    expect(estimate!.confidence).toBe('extrapolated');
    expect(estimate!.mark).toBeGreaterThan(10.6);
  });

  it('is refused when it is far outside', () => {
    // An archer who has only shot indoors should be told the app does not
    // know their 70 m mark, not handed a confident wrong number.
    expect(estimateMark(RECORDED, 70 + MAX_EXTRAPOLATION_M + 1)).toBeNull();
    expect(estimateMark(RECORDED, 20 - MAX_EXTRAPOLATION_M - 1)).toBeNull();
  });
});

describe('too little to go on', () => {
  it('refuses with no marks at all', () => {
    expect(estimateMark([], 50)).toBeNull();
  });

  it('refuses with a single mark', () => {
    // One point describes no slope, so there is nothing to follow.
    expect(estimateMark([{ distanceM: 18, mark: 3 }], 30)).toBeNull();
  });

  it('still returns a single mark at its own distance', () => {
    const estimate = estimateMark([{ distanceM: 18, mark: 3 }], 18);
    expect(estimate!.confidence).toBe('recorded');
    expect(estimate!.mark).toBe(3);
  });

  it('refuses when every mark is at the same distance', () => {
    // A singular fit. Two readings for one distance say nothing about any
    // other distance.
    const same: SightMark[] = [
      { distanceM: 30, mark: 4 },
      { distanceM: 30, mark: 5 },
    ];

    expect(estimateMark(same, 40)).toBeNull();
  });

  it('ignores marks that are not numbers', () => {
    const messy = [
      { distanceM: Number.NaN, mark: 4 },
      { distanceM: 20, mark: 4 },
      { distanceM: 40, mark: 8 },
    ];

    expect(estimateMark(messy, 30)!.mark).toBeCloseTo(6, 10);
  });
});

describe('a table of marks', () => {
  it('omits the distances it cannot answer for', () => {
    const table = markTable(RECORDED, [10, 30, 50, 200]);

    // 200 m is far past the longest recorded mark, so it is dropped. 10 m
    // survives: it is only ten metres below the shortest recorded distance,
    // inside the extrapolation limit, and comes back labelled as a guess.
    expect(table.map((row) => row.distanceM)).toEqual([10, 30, 50]);
    expect(table[0]!.confidence).toBe('extrapolated');
  });

  it('labels each row', () => {
    const table = markTable(RECORDED, [30, 40]);
    expect(table.map((row) => row.confidence)).toEqual([
      'recorded',
      'interpolated',
    ]);
  });
});
