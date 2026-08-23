/**
 * Handicap progress.
 *
 * Most of these test a refusal rather than a calculation. The point of the
 * module is to say nothing when the data cannot support a number, and a
 * refusal that quietly stops working looks exactly like a working feature.
 */

import {
  ARROWS_FOR_TREND,
  type ShootResult,
  handicapForShoot,
  personalBestsByRound,
  summariseHandicap,
} from '../handicapProgress';

function shoot(overrides: Partial<ShootResult> = {}): ShootResult {
  return {
    sessionId: 's1',
    shotAt: new Date('2026-05-01T10:00:00Z'),
    roundFormatId: 'portsmouth',
    arrowCount: 60,
    totalScore: 550,
    ...overrides,
  };
}

describe('a handicap for one shoot', () => {
  it('is computed for a complete round', () => {
    const result = handicapForShoot(shoot());
    expect(result).not.toBeNull();
    expect(result!.roundName).toBe('Portsmouth');
    expect(result!.handicap).toBe(42);
  });

  it('is withheld from freeform practice', () => {
    expect(handicapForShoot(shoot({ roundFormatId: null }))).toBeNull();
  });

  it('is withheld from a round the app does not know', () => {
    expect(
      handicapForShoot(shoot({ roundFormatId: 'not-a-round' })),
    ).toBeNull();
  });

  it('is withheld from an incomplete round', () => {
    // The important refusal. Thirty arrows of a Portsmouth scoring 275 is not
    // a worse archer than sixty scoring 550 — it is half a shoot, and scoring
    // it against the full round's table would invent a collapse in form.
    expect(
      handicapForShoot(shoot({ arrowCount: 30, totalScore: 275 })),
    ).toBeNull();
  });

  it('is withheld from a round with too many arrows', () => {
    expect(
      handicapForShoot(shoot({ arrowCount: 90, totalScore: 800 })),
    ).toBeNull();
  });
});

describe('the summary', () => {
  const complete = (id: string, day: string, score: number): ShootResult =>
    shoot({ sessionId: id, shotAt: new Date(day), totalScore: score });

  it('reports nothing at all with no qualifying shoots', () => {
    const summary = summariseHandicap([shoot({ roundFormatId: null })]);
    expect(summary.current).toBeNull();
    expect(summary.best).toBeNull();
    expect(summary.change).toBeNull();
    expect(summary.hasTrend).toBe(false);
  });

  it('takes the current handicap from the most recent shoot', () => {
    const summary = summariseHandicap([
      complete('a', '2026-05-01', 500),
      complete('b', '2026-06-01', 550),
    ]);

    expect(summary.latest!.sessionId).toBe('b');
    expect(summary.current).toBe(42);
  });

  it('treats a lower handicap as the better one', () => {
    const summary = summariseHandicap([
      complete('a', '2026-05-01', 550),
      complete('b', '2026-06-01', 500),
    ]);

    // Best is the 550 shoot even though it is older.
    expect(summary.best!.sessionId).toBe('a');
    // Change is positive: the handicap went up, which is worse.
    expect(summary.change!).toBeGreaterThan(0);
  });

  it('reports an improvement as a negative change', () => {
    const summary = summariseHandicap([
      complete('a', '2026-05-01', 500),
      complete('b', '2026-06-01', 550),
    ]);

    expect(summary.change!).toBeLessThan(0);
  });

  it('refuses a trend until enough arrows have been shot', () => {
    // Two Portsmouths is 120 arrows. Park's variance numbers say a line
    // through that is decoration, so the summary declines to draw one.
    const summary = summariseHandicap([
      complete('a', '2026-05-01', 500),
      complete('b', '2026-06-01', 550),
    ]);

    expect(summary.hasTrend).toBe(false);
    expect(summary.arrowsUntilTrend).toBe(ARROWS_FOR_TREND - 120);
  });

  it('allows a trend once the arrows are there', () => {
    const shoots = Array.from({ length: 4 }, (_, i) =>
      complete(`s${i}`, `2026-0${i + 3}-01`, 500 + i * 10),
    );

    expect(shoots.length * 60).toBeGreaterThanOrEqual(ARROWS_FOR_TREND);
    expect(summariseHandicap(shoots).hasTrend).toBe(true);
  });

  it('counts practice arrows toward the trend threshold', () => {
    // They are still arrows down range, even though they carry no handicap.
    const summary = summariseHandicap([
      complete('a', '2026-05-01', 500),
      shoot({ sessionId: 'p', roundFormatId: null, arrowCount: 100 }),
    ]);

    expect(summary.arrowsUntilTrend).toBe(ARROWS_FOR_TREND - 160);
  });
});

describe('personal bests', () => {
  it('are kept per round, not across rounds', () => {
    // The whole argument for rounds: 546 is a fine Portsmouth and a poor
    // WA 720, and comparing them directly is what the app used to do.
    const bests = personalBestsByRound([
      shoot({ sessionId: 'a', roundFormatId: 'portsmouth', totalScore: 546 }),
      shoot({
        sessionId: 'b',
        roundFormatId: 'wa720-70',
        arrowCount: 72,
        totalScore: 600,
      }),
    ]);

    expect(bests).toHaveLength(2);
    expect(bests.map((b) => b.roundId).sort()).toEqual([
      'portsmouth',
      'wa720-70',
    ]);
  });

  it('keeps only the highest score for a round', () => {
    const bests = personalBestsByRound([
      shoot({ sessionId: 'a', totalScore: 500 }),
      shoot({ sessionId: 'b', totalScore: 560 }),
      shoot({ sessionId: 'c', totalScore: 520 }),
    ]);

    expect(bests).toHaveLength(1);
    expect(bests[0]!.score).toBe(560);
  });

  it('ignores incomplete shoots', () => {
    expect(
      personalBestsByRound([shoot({ arrowCount: 30, totalScore: 300 })]),
    ).toHaveLength(0);
  });
});
