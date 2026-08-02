import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import TargetFace from '../components/TargetFace';
import { Button, Screen, SectionHeader } from '../components/ui';
import { Round, Session, collections } from '../db';
import { findPreset } from '../db/presets';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
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
}

export default function SessionDetailScreen({ navigation, route }: Props) {
  const { sessionId } = route.params;
  const palette = usePalette();

  const [session, setSession] = useState<Session | null>(null);
  const [gearLabel, setGearLabel] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundView[]>([]);

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
        const preset = findPreset(target.id);
        const aspectRatio = target.effectiveAspectRatio;
        const points = arrows.map((a) => ({ x: a.x, y: a.y }));

        return {
          round,
          targetName: target.name,
          isPreset: target.type === 'preset',
          aspectRatio,
          zones,
          marks: arrows.map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            scoreValue: a.scoreValue,
          })),
          score: arrows.reduce((sum, a) => sum + a.scoreValue, 0),
          grouping:
            preset && preset.aimPoints.length > 1
              ? groupSpreadMultiSpot(points, preset.aimPoints, { aspectRatio })
              : groupSpread(points, { aspectRatio }),
        };
      }),
    );

    setRounds(views);
  }, [sessionId]);

  useEffect(() => {
    load();
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
      <Text style={[type.title, { color: palette.textPrimary }]}>
        {session.shotAt.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
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
            ? ` · ${(overallGrouping * 100).toFixed(1)}% grouping`
            : ''}
        </Text>
      </View>

      {rounds.map((view) => (
        <View key={view.round.id}>
          <SectionHeader
            title={`Board ${view.round.roundOrder} · ${view.score}`}
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
            {view.targetName} · {view.marks.length}{' '}
            {view.marks.length === 1 ? 'arrow' : 'arrows'}
            {view.grouping !== null
              ? ` · ${(view.grouping * 100).toFixed(1)}% group`
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
        <Text
          style={[type.body, styles.empty, { color: palette.textMuted }]}
        >
          This session has no boards yet.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { ...type.body, marginTop: spacing.xs },
  notes: { ...type.body, fontStyle: 'italic', marginTop: spacing.sm },
  heroBlock: { marginTop: spacing.lg },
  heroValue: {
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: 50,
    fontVariant: ['tabular-nums'],
  },
  heroCaption: { ...type.label, fontWeight: '400', marginTop: 2 },
  roundMeta: { ...type.label, fontWeight: '400', marginBottom: spacing.sm },
  faceWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  empty: { textAlign: 'center', marginTop: spacing.xl },
});
