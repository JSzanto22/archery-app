import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  analyseArrowNumbers,
  numberForShot,
  type NumberedMark,
} from '../analytics/arrowNumbers';
import Scorecard, { type ScorecardEnd } from '../components/Scorecard';
import TargetFace from '../components/TargetFace';
import { Banner, Button, Screen, SectionHeader } from '../components/ui';
import { Round, Session, collections } from '../db';
import { deleteSession } from '../db/actions';
import { isMultiSpot, resolveFaceGeometry } from '../db/faceGeometry';
import { formatLongDate, formatPercent, plural } from '../lib/format';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
import { countInnerTens, hasInnerTen } from '../scoring/innerTen';
import { Zone } from '../scoring/scoring';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionDetail'>;

interface RoundView {
  round: Round;
  targetName: string;
  isPreset: boolean;
  aspectRatio: number;
  zones: Zone[];
  marks: Array<{ id: string; x: number; y: number; scoreValue: number }>;
  score: number;
  grouping: number | null;
  /** Xs in this end. */
  innerTens: number;
  /** False for faces with no X ring, so the column can be dropped. */
  hasInnerTenRing: boolean;
}

export default function SessionDetailScreen({ navigation, route }: Props) {
  const { sessionId } = route.params;
  const palette = usePalette();

  const [session, setSession] = useState<Session | null>(null);
  const [gearLabel, setGearLabel] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundView[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    if (!session || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(session);
      navigation.replace('Dashboard');
    } catch (e) {
      console.error('[session] delete failed', e);
      setError('This session could not be deleted.');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [deleting, navigation, session]);

  const load = useCallback(async () => {
    const loaded = await collections.sessions.find(sessionId);
    setSession(loaded);

    if (loaded.gearProfileId) {
      const gear = await collections.gearProfiles.find(loaded.gearProfileId);
      setGearLabel(gear.name);
    } else {
      setGearLabel(loaded.equipmentTag);
    }

    const loadedRounds = await loaded.orderedRounds.fetch();

    const views = await Promise.all(
      loadedRounds.map(async (round): Promise<RoundView> => {
        const target = await collections.targets.find(round.targetId);
        const zones = await target.toScoringZones();
        const arrows = await round.orderedArrows.fetch();
        const face = resolveFaceGeometry(target);
        const aspectRatio = face.aspectRatio;
        const points = arrows.map((a) => ({ x: a.x, y: a.y }));

        return {
          round,
          targetName: target.name,
          isPreset: face.isPreset,
          aspectRatio,
          zones,
          marks: arrows.map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
          })),
          score: arrows.reduce((sum, a) => sum + a.scoreValue, 0),
          innerTens: countInnerTens(zones, points),
          hasInnerTenRing: hasInnerTen(zones),
          grouping: isMultiSpot(face)
            ? groupSpreadMultiSpot(points, face.aimPoints, { aspectRatio })
            : groupSpread(points, { aspectRatio }),
        };
      }),
    );

    setRounds(views);
  }, [sessionId]);

  /**
   * Which shaft made each mark.
   *
   * Derived here rather than stored: the arrow number is a function of a
   * mark's position in the session's shot order and the archer's set size, and
   * a stored copy would be free to disagree after an arrow was deleted and
   * re-marked. Rounds come back in end order and marks in shot order, so
   * flattening them gives the sequence the archer actually shot.
   */
  const arrowReport = (() => {
    const setSize = session?.arrowSetSize ?? null;
    if (!setSize) return null;

    const numbered: NumberedMark[] = [];
    let shot = 0;

    for (const view of rounds) {
      for (const mark of view.marks) {
        shot += 1;
        numbered.push({
          arrowNumber: numberForShot(shot, setSize),
          x: mark.x,
          y: mark.y,
          scoreValue: mark.scoreValue,
        });
      }
    }

    return analyseArrowNumbers(numbered);
  })();

  /**
   * The rounds as scorecard rows.
   *
   * `arrowsPerEnd` is the widest end actually shot rather than the round's
   * nominal figure: a session abandoned half way through an end should still
   * produce a card with the right number of columns.
   */
  const scorecard = {
    ends: rounds
      .filter((view) => view.marks.length > 0)
      .map((view): ScorecardEnd => ({
        number: view.round.roundOrder,
        scores: view.marks.map((m) => m.scoreValue),
        innerTens: view.innerTens,
      })),
    arrowsPerEnd: rounds.reduce(
      (widest, view) => Math.max(widest, view.marks.length),
      0,
    ),
    // Dropped entirely when no face in the session has an X ring, rather than
    // shown as a column of blanks.
    showInnerTens: rounds.some((view) => view.hasInnerTenRing),
  };

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return (
      <Screen>
        <Text style={[type.body, { color: palette.textSecondary }]}>
          Loading…
        </Text>
      </Screen>
    );
  }

  const totalScore = rounds.reduce((sum, r) => sum + r.score, 0);
  const arrowCount = rounds.reduce((sum, r) => sum + r.marks.length, 0);
  const allPoints = rounds.flatMap((r) => r.marks);
  const overallGrouping = groupSpread(allPoints);

  const meta = [
    session.distanceM !== null ? `${session.distanceM} m` : null,
    gearLabel,
    session.location,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
      {error ? (
        <Banner tone="error" message={error} onDismiss={() => setError(null)} />
      ) : null}

      <Text style={[type.title, { color: palette.textPrimary }]}>
        {formatLongDate(session.shotAt)}
      </Text>
      <Text style={[styles.meta, { color: palette.textSecondary }]}>
        {meta || 'No details recorded'}
      </Text>

      {session.notes ? (
        <Text style={[styles.notes, { color: palette.textSecondary }]}>
          {session.notes}
        </Text>
      ) : null}

      {/* One hero number; the supporting figures stay quiet beside it. */}
      <View style={styles.heroBlock}>
        <Text style={[type.label, { color: palette.textSecondary }]}>
          Total score
        </Text>
        <Text style={[styles.heroValue, { color: palette.textPrimary }]}>
          {totalScore}
        </Text>
        <Text style={[styles.heroCaption, { color: palette.textMuted }]}>
          {arrowCount
            ? `${(totalScore / arrowCount).toFixed(2)} per arrow`
            : 'no arrows'}
          {overallGrouping !== null
            ? ` · ${formatPercent(overallGrouping)} grouping`
            : ''}
        </Text>
      </View>

      {/*
        The scorecard first, the plots below it.
        
        This is the summary an archer recognises and can check against the
        sheet on the wall; the per-end faces underneath are the detail behind
        each row.
      */}
      {scorecard.ends.length > 0 ? (
        <View>
          <SectionHeader title="Scorecard" />
          <Scorecard
            ends={scorecard.ends}
            arrowsPerEnd={scorecard.arrowsPerEnd}
            showInnerTens={scorecard.showInnerTens}
          />
        </View>
      ) : null}

      {arrowReport && arrowReport.stats.length > 0 ? (
        <View>
          <SectionHeader title="By arrow" />
          {arrowReport.hasEnoughData ? null : (
            <Text
              style={[type.label, styles.meta, { color: palette.textMuted }]}
            >
              {`Each shaft has been shot ${arrowReport.minShots} ${plural(arrowReport.minShots, 'time')} here. A few more sessions and this can say whether one of them is at fault.`}
            </Text>
          )}
          {arrowReport.stats.map((stat) => (
            <View key={stat.arrowNumber} style={styles.arrowRow}>
              <Text
                style={[
                  type.body,
                  styles.arrowNumber,
                  { color: palette.textPrimary },
                ]}
              >
                {stat.arrowNumber}
              </Text>
              <Text style={[type.body, { color: palette.textSecondary }]}>
                {`${stat.meanScore.toFixed(1)} avg`}
              </Text>
              <Text
                style={[
                  type.label,
                  styles.arrowNote,
                  {
                    color: stat.isOutlier
                      ? palette.critical
                      : palette.textMuted,
                  },
                ]}
              >
                {stat.isOutlier
                  ? 'lands away from the rest — worth checking'
                  : `${formatPercent(stat.offsetFromCentre)} from group centre`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {rounds.map((view) => (
        <View key={view.round.id}>
          <SectionHeader
            title={`End ${view.round.roundOrder} · ${view.score}`}
            trailing={
              <Button
                label="Edit marks"
                variant="text"
                onPress={() =>
                  navigation.navigate('Marking', {
                    sessionId,
                    roundId: view.round.id,
                  })
                }
              />
            }
          />
          <Text style={[styles.roundMeta, { color: palette.textMuted }]}>
            {view.targetName} · {plural(view.marks.length, 'arrow')}
            {view.grouping !== null
              ? ` · ${formatPercent(view.grouping)} group`
              : ''}
          </Text>

          <View style={styles.faceWrap}>
            <TargetFace
              zones={view.zones}
              marks={view.marks}
              photoUri={view.round.localPhotoUri}
              isPreset={view.isPreset}
              aspectRatio={view.aspectRatio}
            />
          </View>
        </View>
      ))}

      {rounds.length === 0 ? (
        <Text style={[type.body, styles.empty, { color: palette.textMuted }]}>
          This session has no ends yet.
        </Text>
      ) : null}

      {/*
        Delete lives at the bottom, behind a two-step confirm, and states the
        cost in arrows rather than asking "are you sure?" — an inline confirm
        rather than a modal, for the same reason the marking screen avoids
        Alert.
      */}
      <View style={styles.dangerZone}>
        {confirmingDelete ? (
          <Banner
            tone="error"
            message={`Delete this session and its ${plural(arrowCount, 'arrow')}? This cannot be undone.`}
            actionLabel={deleting ? 'Deleting…' : 'Delete'}
            onAction={() => void onDelete()}
            onDismiss={() => setConfirmingDelete(false)}
          />
        ) : (
          <Button
            label="Delete session"
            variant="text"
            onPress={() => setConfirmingDelete(true)}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { ...type.body, marginTop: spacing.xs },
  arrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  arrowNumber: {
    width: 26,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  arrowNote: { flex: 1 },
  notes: { ...type.body, fontStyle: 'italic', marginTop: spacing.sm },
  heroBlock: { marginTop: spacing.lg },
  heroValue: {
    fontSize: 44,
    fontFamily: 'SpaceGrotesk_700Bold',
    letterSpacing: -1,
    lineHeight: 52,
    fontVariant: ['tabular-nums'],
  },
  heroCaption: { ...type.label, fontWeight: '400', marginTop: 2 },
  roundMeta: { ...type.label, fontWeight: '400', marginBottom: spacing.sm },
  faceWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  empty: { textAlign: 'center', marginTop: spacing.xl },
  dangerZone: { marginTop: spacing.xl, alignItems: 'flex-start' },
});
