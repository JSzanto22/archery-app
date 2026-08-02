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
import { findPreset } from '../db/presets';

export interface DashboardData {
  summaries: SessionSummary[];
  loading: boolean;
  reload: () => void;
}

export function useDashboardData(range: RangeKey): DashboardData {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
        const preset = targetId ? findPreset(targetId) : undefined;
        const target = targetId ? targetById.get(targetId) : undefined;

        // A stored face width wins: the archer may have measured their own
        // printed face, and their measurement beats the standard.
        const faceWidthCm = target?.faceWidthCm ?? preset?.faceWidthCm ?? null;

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
          aimPoints: preset?.aimPoints ?? [{ x: 0.5, y: 0.5 }],
          aspectRatio: target?.aspectRatio ?? preset?.aspectRatio ?? 1,
          faceWidthCm,
          maxArrowScore: Math.max(
            0,
            ...flatArrows.map((a) => a.scoreValue),
            ...(preset ? preset.zones.map((z) => z.scoreValue) : []),
          ),
        };
      });

      const result = input
        .filter((s) => s.arrows.length > 0)
        .map(summarizeSession);

      if (!cancelled) {
        setSummaries(result);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range, tick]);

  return { summaries, loading, reload };
}
