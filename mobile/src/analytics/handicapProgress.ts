/**
 * Handicap over time.
 *
 * Two rules run through this file, and both are about not saying more than the
 * data supports.
 *
 * A handicap is only computed for a **complete** round. Archery GB's tables
 * predict the score for a whole round, so half a Portsmouth compared against a
 * full Portsmouth's table is not a worse handicap — it is a meaningless one.
 * A partial shoot returns null and the UI says so.
 *
 * A **trend** needs more than two points. Dr James Park's analysis of score
 * variance is the reason: at 20 ends an archer still needs a 21-point swing
 * before a change is distinguishable from noise, so a line drawn through three
 * sessions is decoration. `ARROWS_FOR_TREND` is the floor below which this
 * reports "not enough yet" instead of a direction.
 */

import {
  findRound,
  arrowCount as roundArrowCount,
  toPasses,
} from '../rounds/catalogue';
import { handicapForScore } from '../scoring/handicap';

/**
 * Arrows before a direction of travel is worth stating.
 *
 * Three full 72-arrow rounds. Well short of the several hundred Park suggests
 * for detecting a small equipment change, and enough that the number is not
 * jumping around on every visit.
 */
export const ARROWS_FOR_TREND = 216;

export interface ShootResult {
  sessionId: string;
  shotAt: Date;
  roundFormatId: string | null;
  arrowCount: number;
  totalScore: number;
}

export interface HandicapResult {
  sessionId: string;
  shotAt: Date;
  roundName: string;
  handicap: number;
  score: number;
}

/**
 * The handicap for one shoot, or null when the shoot cannot carry one.
 *
 * Null has three distinct causes and they are deliberately not distinguished
 * here: no round chosen, a round the app does not know, or an incomplete one.
 * All three mean the same thing to a caller — there is no honest number.
 */
export function handicapForShoot(shoot: ShootResult): HandicapResult | null {
  if (!shoot.roundFormatId) return null;

  const round = findRound(shoot.roundFormatId);
  if (!round) return null;

  // Every arrow of the round, or nothing. A short shoot scores lower for
  // reasons that have nothing to do with how the archer is shooting.
  if (shoot.arrowCount !== roundArrowCount(round)) return null;

  const handicap = handicapForScore(shoot.totalScore, toPasses(round));
  if (handicap === null) return null;

  return {
    sessionId: shoot.sessionId,
    shotAt: shoot.shotAt,
    roundName: round.name,
    handicap,
    score: shoot.totalScore,
  };
}

export interface HandicapSummary {
  /** Most recent handicap, or null when nothing qualifies yet. */
  current: number | null;
  /** The shoot it came from. */
  latest: HandicapResult | null;
  /** Best (lowest) handicap ever recorded. */
  best: HandicapResult | null;
  /**
   * Change against the previous qualifying shoot. Negative is an improvement,
   * because a lower handicap is better.
   */
  change: number | null;
  /** Every qualifying shoot, oldest first. */
  history: HandicapResult[];
  /**
   * Whether enough arrows have been shot to talk about a direction at all.
   * False means the UI should show the number without a trend.
   */
  hasTrend: boolean;
  /** Arrows still needed before a trend is worth stating. */
  arrowsUntilTrend: number;
}

export function summariseHandicap(shoots: ShootResult[]): HandicapSummary {
  const history = shoots
    .map(handicapForShoot)
    .filter((result): result is HandicapResult => result !== null)
    .sort((a, b) => a.shotAt.getTime() - b.shotAt.getTime());

  const totalArrows = shoots.reduce((sum, shoot) => sum + shoot.arrowCount, 0);
  const arrowsUntilTrend = Math.max(0, ARROWS_FOR_TREND - totalArrows);

  const latest = history[history.length - 1] ?? null;
  const previous = history[history.length - 2] ?? null;

  const best = history.reduce<HandicapResult | null>(
    (lowest, result) =>
      lowest === null || result.handicap < lowest.handicap ? result : lowest,
    null,
  );

  return {
    current: latest?.handicap ?? null,
    latest,
    best,
    change: latest && previous ? latest.handicap - previous.handicap : null,
    history,
    hasTrend: arrowsUntilTrend === 0 && history.length >= 2,
    arrowsUntilTrend,
  };
}

/**
 * The best score ever shot at each round.
 *
 * A personal best only means something within one format, which is the whole
 * argument for rounds: 546 is a good Portsmouth and a poor WA 720, and until
 * now the app compared them directly.
 */
export function personalBestsByRound(
  shoots: ShootResult[],
): Array<{ roundId: string; roundName: string; score: number; shotAt: Date }> {
  const best = new Map<
    string,
    { roundId: string; roundName: string; score: number; shotAt: Date }
  >();

  for (const shoot of shoots) {
    if (!shoot.roundFormatId) continue;

    const round = findRound(shoot.roundFormatId);
    if (!round || shoot.arrowCount !== roundArrowCount(round)) continue;

    const existing = best.get(round.id);
    if (!existing || shoot.totalScore > existing.score) {
      best.set(round.id, {
        roundId: round.id,
        roundName: round.name,
        score: shoot.totalScore,
        shotAt: shoot.shotAt,
      });
    }
  }

  return [...best.values()].sort(
    (a, b) => b.shotAt.getTime() - a.shotAt.getTime(),
  );
}
