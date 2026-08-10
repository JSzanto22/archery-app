/**
 * Dashboard aggregates.
 *
 * Pure functions over plain data — no database, no React — so they can be
 * tested directly and reused by any screen. Everything here is derived on read;
 * nothing is stored, per the architecture principle.
 */

import {
  GroupBias,
  groupBias,
  groupSpread,
  groupSpreadMultiSpot,
  scoreConsistency,
  scoreDistribution,
} from '../scoring/grouping';
import { Point } from '../scoring/geometry';

export interface SessionArrows {
  sessionId: string;
  shotAt: Date;
  distanceM: number | null;
  gearLabel: string | null;
  location: string | null;
  isPendingSync: boolean;
  arrows: Array<{ x: number; y: number; scoreValue: number }>;
  /** Aim points of the face shot, so multi-spot grouping is measured correctly. */
  aimPoints: Point[];
  /** faceWidth / faceHeight of the face shot. */
  aspectRatio: number;
  /** Physical face width, for converting grouping to real units. */
  faceWidthCm: number | null;
  /** Best score a single arrow could earn here — 10 on a WA face, 12 on a 3D animal. */
  maxArrowScore: number;
}

export interface SessionSummary {
  sessionId: string;
  shotAt: Date;
  distanceM: number | null;
  gearLabel: string | null;
  location: string | null;
  isPendingSync: boolean;
  arrowCount: number;
  totalScore: number;
  averageScore: number | null;
  grouping: number | null;
  /** Grouping in centimetres. Null when the face size is unknown. */
  groupingCm: number | null;
  faceWidthCm: number | null;
  /** Where the group sat relative to the aim point. */
  bias: GroupBias | null;
  biasCm: number | null;
  /** Shot-to-shot standard deviation. */
  consistency: number | null;
  /** Arrows at the top score (10s on a WA face). */
  topScoreCount: number;
  maxArrowScore: number;
  distribution: Array<{ score: number; count: number }>;
}

export function summarizeSession(session: SessionArrows): SessionSummary {
  const total = session.arrows.reduce((sum, a) => sum + a.scoreValue, 0);
  const points: Point[] = session.arrows.map((a) => ({ x: a.x, y: a.y }));
  const scores = session.arrows.map((a) => a.scoreValue);

  const options = { aspectRatio: session.aspectRatio };
  const grouping =
    session.aimPoints.length > 1
      ? groupSpreadMultiSpot(points, session.aimPoints, options)
      : groupSpread(points, options);

  // Bias is only meaningful against a single aim point. On a multi-spot face
  // the arrows are aimed at three different places, so a centroid offset would
  // describe the target's layout rather than the archer's sight.
  const bias =
    session.aimPoints.length === 1
      ? groupBias(points, session.aimPoints[0], options)
      : null;

  const toCm = (normalized: number | null) =>
    normalized !== null && session.faceWidthCm
      ? normalized * session.faceWidthCm
      : null;

  return {
    sessionId: session.sessionId,
    shotAt: session.shotAt,
    distanceM: session.distanceM,
    gearLabel: session.gearLabel,
    location: session.location,
    isPendingSync: session.isPendingSync,
    arrowCount: session.arrows.length,
    totalScore: total,
    averageScore: session.arrows.length ? total / session.arrows.length : null,
    grouping,
    groupingCm: toCm(grouping),
    faceWidthCm: session.faceWidthCm,
    bias,
    biasCm: toCm(bias?.distance ?? null),
    consistency: scoreConsistency(scores),
    topScoreCount: scores.filter((s) => s === session.maxArrowScore).length,
    maxArrowScore: session.maxArrowScore,
    distribution: scoreDistribution(scores),
  };
}

export interface PersonalBests {
  bestAverage: SessionSummary | null;
  tightestGroup: SessionSummary | null;
  totalArrows: number;
  totalSessions: number;
  /** Arrows at the top score across the range. */
  totalTopScores: number;
  /** Mean arrow score across every session in the range. */
  overallAverage: number | null;
  /** Combined score distribution across the range. */
  distribution: Array<{ score: number; count: number }>;
  /** The direction the archer misses most often, if there is one. */
  dominantBias: string | null;
}

/**
 * Personal bests.
 *
 * Ranked on *average* arrow score rather than session total, because a total
 * rewards shooting more arrows. A 30-arrow session at 9.2 is better shooting
 * than a 90-arrow session at 8.1, and a leaderboard that says otherwise
 * teaches the wrong lesson.
 */
export function personalBests(summaries: SessionSummary[]): PersonalBests {
  let bestAverage: SessionSummary | null = null;
  let tightestGroup: SessionSummary | null = null;
  let totalArrows = 0;
  let totalScore = 0;
  let totalTopScores = 0;

  const combined = new Map<number, number>();
  const biasCounts = new Map<string, number>();

  for (const s of summaries) {
    totalArrows += s.arrowCount;
    totalScore += s.totalScore;
    totalTopScores += s.topScoreCount;

    for (const entry of s.distribution) {
      combined.set(entry.score, (combined.get(entry.score) ?? 0) + entry.count);
    }

    if (s.bias?.direction) {
      biasCounts.set(
        s.bias.direction,
        (biasCounts.get(s.bias.direction) ?? 0) + 1,
      );
    }

    if (
      s.averageScore !== null &&
      (bestAverage === null || s.averageScore > bestAverage.averageScore!)
    ) {
      bestAverage = s;
    }

    // Compared in normalized units on purpose: a tight 18 m group and a tight
    // 70 m group are both tight relative to their own face.
    if (
      s.grouping !== null &&
      (tightestGroup === null || s.grouping < tightestGroup.grouping!)
    ) {
      tightestGroup = s;
    }
  }

  // Only call a tendency dominant if it shows up in more than a third of
  // sessions — otherwise it is noise dressed up as coaching.
  let dominantBias: string | null = null;
  let bestCount = 0;
  for (const [direction, count] of biasCounts) {
    if (count > bestCount) {
      bestCount = count;
      dominantBias = direction;
    }
  }
  if (summaries.length === 0 || bestCount / summaries.length <= 1 / 3) {
    dominantBias = null;
  }

  return {
    bestAverage,
    tightestGroup,
    totalArrows,
    totalSessions: summaries.length,
    totalTopScores,
    overallAverage: totalArrows > 0 ? totalScore / totalArrows : null,
    distribution: [...combined.entries()]
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => b.score - a.score),
    dominantBias,
  };
}

export type RangeKey = '30d' | '90d' | '1y' | 'all';

export const RANGE_LABELS: Record<RangeKey, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  all: 'All',
};

export function rangeStart(range: RangeKey, now = new Date()): Date | null {
  const days: Record<Exclude<RangeKey, 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
  };

  if (range === 'all') return null;
  return new Date(now.getTime() - days[range] * 24 * 60 * 60 * 1000);
}

