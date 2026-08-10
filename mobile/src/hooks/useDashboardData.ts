/**
 * Loads everything the dashboard needs from the local store and reduces it to
 * summaries.
 *
 * Reads are batched by table rather than walked per session: fetching arrows
 * one round at a time turns a 40-session range into hundreds of round trips to
 * SQLite, which is exactly the stutter the on-device architecture is supposed
 * to avoid.
 */

import { Q } from '@nozbe/watermelondb';
import { useCallback, useEffect, useState } from 'react';

import {
  RangeKey,
  SessionArrows,
  SessionSummary,
  rangeStart,
  summarizeSession,
} from '../analytics/dashboard';
import { collections } from '../db';
import { resolveFaceGeometry } from '../db/faceGeometry';
import { findPreset } from '../db/presets';
import { centroid } from '../scoring/grouping';
import { Zone } from '../scoring/scoring';

/**
 * Every arrow in the range, plotted on the face it was most often shot at.
 *
 * The signature view of the sport, and pure data rather than decoration: the
 * shape of the cloud is the grouping, and its offset from the middle is the
 * sight error.
 */
export interface GroupMapData {
  zones: Zone[];
  isPreset: boolean;
  aspectRatio: number;
  targetName: string;
  points: Array<{ id: string; x: number; y: number; scoreValue: number }>;
  centroid: { x: number; y: number } | null;
  /** True when the range mixes faces, so the rings are only the dominant one. */
  mixedFaces: boolean;
}

export interface DashboardData {
  summaries: SessionSummary[];
  groupMap: GroupMapData | null;
  loading: boolean;
  reload: () => void;
}

export function useDashboardData(range: RangeKey): DashboardData {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [groupMap, setGroupMap] = useState<GroupMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      const start = rangeStart(range);
      const sessionQuery = start
        ? collections.sessions.query(
            Q.where('shot_at', Q.gte(start.getTime())),
            Q.sortBy('shot_at', Q.asc),
          )
        : collections.sessions.query(Q.sortBy('shot_at', Q.asc));

      const sessions = await sessionQuery.fetch();
      if (sessions.length === 0) {
        if (!cancelled) {
          setSummaries([]);
          setGroupMap(null);
          setLoading(false);
        }
        return;
      }

      const sessionIds = sessions.map((s) => s.id);
      const rounds = await collections.rounds
        .query(Q.where('session_id', Q.oneOf(sessionIds)))
        .fetch();

      const roundIds = rounds.map((r) => r.id);
      const arrows = roundIds.length
        ? await collections.arrows
            .query(Q.where('round_id', Q.oneOf(roundIds)))
            .fetch()
        : [];

      const gearProfiles = await collections.gearProfiles.query().fetch();
      const gearById = new Map(gearProfiles.map((g) => [g.id, g.name]));

      const arrowsByRound = new Map<string, typeof arrows>();
      for (const arrow of arrows) {
        const bucket = arrowsByRound.get(arrow.roundId) ?? [];
        bucket.push(arrow);
        arrowsByRound.set(arrow.roundId, bucket);
      }

      const roundsBySession = new Map<string, typeof rounds>();
      for (const round of rounds) {
        const bucket = roundsBySession.get(round.sessionId) ?? [];
        bucket.push(round);
        roundsBySession.set(round.sessionId, bucket);
      }

      // Face geometry and physical size come from the target record; the
      // bundled preset table is the fallback for anything not yet stored.
      const targets = await collections.targets.query().fetch();
      const targetById = new Map(targets.map((t) => [t.id, t]));

      const input: SessionArrows[] = sessions.map((session) => {
        const sessionRounds = roundsBySession.get(session.id) ?? [];

        const flatArrows = sessionRounds.flatMap((round) =>
          (arrowsByRound.get(round.id) ?? []).map((a) => ({
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
          })),
        );

        // Face geometry comes from the first round's target. A session that
        // mixes faces is possible but rare; the aim points only affect grouping,
        // and using the dominant face is better than pretending it is square.
        const targetId = sessionRounds[0]?.targetId;
        const target = targetId ? targetById.get(targetId) : undefined;
        const face = target ? resolveFaceGeometry(target) : null;

        return {
          sessionId: session.id,
          shotAt: session.shotAt,
          distanceM: session.distanceM,
          gearLabel:
            (session.gearProfileId
              ? gearById.get(session.gearProfileId)
              : null) ??
            session.equipmentTag ??
            null,
          location: session.location,
          isPendingSync: session.isPendingSync,
          arrows: flatArrows,
          aimPoints: face?.aimPoints ?? [{ x: 0.5, y: 0.5 }],
          aspectRatio: face?.aspectRatio ?? 1,
          faceWidthCm: face?.faceWidthCm ?? null,
          maxArrowScore: Math.max(
            0,
            ...flatArrows.map((a) => a.scoreValue),
            ...(targetId
              ? (findPreset(targetId)?.zones.map((z) => z.scoreValue) ?? [])
              : []),
          ),
        };
      });

      const result = input
        .filter((s) => s.arrows.length > 0)
        .map(summarizeSession);

      // The group map draws every arrow on whichever face was shot most in the
      // range — the rings have to come from a real target, not an invented one.
      const faceCounts = new Map<string, number>();
      for (const round of rounds) {
        const count = arrowsByRound.get(round.id)?.length ?? 0;
        if (count > 0) {
          faceCounts.set(
            round.targetId,
            (faceCounts.get(round.targetId) ?? 0) + count,
          );
        }
      }

      let map: GroupMapData | null = null;

      if (faceCounts.size > 0) {
        const [dominantId] = [...faceCounts.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0];

        const dominant = targetById.get(dominantId);

        if (dominant) {
          const zones = await dominant.toScoringZones();
          const dominantFace = resolveFaceGeometry(dominant);

          const points = arrows.map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
          }));

          map = {
            zones,
            isPreset: dominantFace.isPreset,
            aspectRatio: dominantFace.aspectRatio,
            targetName: dominant.name,
            points,
            centroid: centroid(points),
            mixedFaces: faceCounts.size > 1,
          };
        }
      }

      if (!cancelled) {
        setSummaries(result);
        setGroupMap(map);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range, tick]);

  return { summaries, groupMap, loading, reload };
}
