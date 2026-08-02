/**
 * Dashboard aggregates.
 *
 * Pure functions over plain data — no database, no React — so they can be
 * tested directly and reused by any screen. Everything here is derived on read;
 * nothing is stored, per the architecture principle.
 */

import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
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
}

export function summarizeSession(session: SessionArrows): SessionSummary {
  const total = session.arrows.reduce((sum, a) => sum + a.scoreValue, 0);
  const points: Point[] = session.arrows.map((a) => ({ x: a.x, y: a.y }));

  const options = { aspectRatio: session.aspectRatio };
  const grouping =
    session.aimPoints.length > 1
      ? groupSpreadMultiSpot(points, session.aimPoints, options)
      : groupSpread(points, options);

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
  };
}

export interface PersonalBests {
  bestAverage: SessionSummary | null;
  tightestGroup: SessionSummary | null;
  totalArrows: number;
  totalSessions: number;
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

  for (const s of summaries) {
    totalArrows += s.arrowCount;

    if (
      s.averageScore !== null &&
      (bestAverage === null || s.averageScore > bestAverage.averageScore!)
    ) {
      bestAverage = s;
    }

    if (
      s.grouping !== null &&
      (tightestGroup === null || s.grouping < tightestGroup.grouping!)
    ) {
      tightestGroup = s;
    }
  }

  return {
    bestAverage,
    tightestGroup,
    totalArrows,
    totalSessions: summaries.length,
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

export interface DashboardFilters {
  distanceM?: number | null;
  gearProfileId?: string | null;
}

export function applyFilters(
  summaries: SessionSummary[],
  filters: DashboardFilters,
): SessionSummary[] {
  return summaries.filter((s) => {
    if (
      filters.distanceM !== undefined &&
      filters.distanceM !== null &&
      s.distanceM !== filters.distanceM
    ) {
      return false;
    }
    return true;
  });
}
