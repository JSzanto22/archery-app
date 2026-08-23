/**
 * Round definitions.
 *
 * A round with the wrong arrow count or face size produces a wrong handicap
 * without producing an error, so these check the definitions against what the
 * rounds are known to be — the maximum scores in particular, which are the
 * numbers every archer shooting that round has memorised.
 */

import {
  ROUNDS,
  arrowCount,
  describe as describeRound,
  distanceInMetres,
  findRound,
  maxScore,
  toPasses,
} from '../catalogue';
import { handicapForScore, tableScore } from '../../scoring/handicap';

describe('the catalogue', () => {
  it('has no duplicate ids', () => {
    const ids = ROUNDS.map((round) => round.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ['wa720-70', 72, 720],
    ['wa720-60', 72, 720],
    ['wa720-50', 72, 720],
    ['wa900', 90, 900],
    ['portsmouth', 60, 600],
    ['wa18', 60, 600],
    ['bray1', 30, 300],
    ['stafford', 72, 720],
    // Imperial golds are worth 9, not 10 — which is why these are not
    // multiples of the arrow count times ten.
    ['national', 72, 648],
    ['warwick', 48, 432],
    ['western', 96, 864],
  ])('%s is %p arrows for a maximum of %p', (id, arrows, best) => {
    const round = findRound(id);
    expect(round).not.toBeNull();
    expect(arrowCount(round!)).toBe(arrows);
    expect(maxScore(round!)).toBe(best);
  });

  it('divides evenly into ends', () => {
    for (const round of ROUNDS) {
      expect(arrowCount(round) % round.arrowsPerEnd).toBe(0);
    }
  });

  it('converts yards to metres', () => {
    const portsmouth = findRound('portsmouth')!;
    // 20 yards is 18.29 m, not 18 — the difference is small but it is the
    // difference between Portsmouth and WA 18, and it moves the handicap.
    expect(distanceInMetres(portsmouth.passes[0]!)).toBeCloseTo(18.288, 3);
  });

  it('describes itself the way an archer would say it', () => {
    expect(describeRound(findRound('national')!)).toBe(
      '48 at 60yd, 24 at 50yd',
    );
  });
});

describe('rounds against the handicap engine', () => {
  it('never requires more than a perfect score', () => {
    // A table score above the maximum would mean the best handicap is
    // unreachable, and every archer would be off the bottom of the scale.
    for (const round of ROUNDS) {
      expect(tableScore(0, toPasses(round))).toBeLessThanOrEqual(
        maxScore(round),
      );
    }
  });

  it('gives every round a usable handicap range', () => {
    for (const round of ROUNDS) {
      const passes = toPasses(round);
      const best = handicapForScore(maxScore(round), passes);
      const modest = handicapForScore(
        Math.round(maxScore(round) * 0.5),
        passes,
      );

      expect(best).not.toBeNull();
      expect(modest).not.toBeNull();
      expect(best!).toBeLessThan(modest!);
    }
  });

  it('rates the same score harder at a longer distance', () => {
    // 600 on a WA 720 is a far better shoot at 70 m than at 50 m, and the
    // handicap has to reflect that or the whole point of the number is lost.
    const at70 = handicapForScore(600, toPasses(findRound('wa720-70')!))!;
    const at60 = handicapForScore(600, toPasses(findRound('wa720-60')!))!;

    expect(at70).toBeLessThan(at60);
  });
});
