import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TargetFace from '../components/TargetFace';
import { Round, Session, collections } from '../db';
import { findPreset } from '../db/presets';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
import { Zone } from '../scoring/scoring';
import { RootStackParamList } from '../navigation';
import { Palette, radius, spacing, usePalette } from '../theme';

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
  const styles = makeStyles(palette);

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
      <SafeAreaView style={styles.screen}>
        <Text style={styles.loading}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const totalScore = rounds.reduce((sum, r) => sum + r.score, 0);
  const arrowCount = rounds.reduce((sum, r) => sum + r.marks.length, 0);
  const allPoints = rounds.flatMap((r) => r.marks);
  const overallGrouping = groupSpread(allPoints);

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.date}>
          {session.shotAt.toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
        <Text style={styles.meta}>
          {[
            session.distanceM !== null ? `${session.distanceM} m` : null,
            gearLabel,
            session.location,
          ]
            .filter(Boolean)
            .join(' · ') || 'No details recorded'}
        </Text>

        {session.notes ? <Text style={styles.notes}>{session.notes}</Text> : null}

        <View style={styles.totalsRow}>
          <Total label="Total" value={String(totalScore)} palette={palette} />
          <Total
            label="Per arrow"
            value={arrowCount ? (totalScore / arrowCount).toFixed(2) : '—'}
            palette={palette}
          />
          <Total
            label="Grouping"
            value={
              overallGrouping === null
                ? '—'
                : `${(overallGrouping * 100).toFixed(1)}%`
            }
            palette={palette}
          />
        </View>

        {rounds.map((view) => (
          <View key={view.round.id} style={styles.roundCard}>
            <View style={styles.roundHeader}>
              <Text style={styles.roundTitle}>
                Board {view.round.roundOrder}
              </Text>
              <Text style={styles.roundScore}>{view.score}</Text>
            </View>
            <Text style={styles.roundMeta}>
              {view.targetName} · {view.marks.length} arrows
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

            <Pressable
              style={styles.editButton}
              onPress={() =>
                navigation.navigate('Marking', {
                  sessionId,
                  roundId: view.round.id,
                })
              }
            >
              <Text style={styles.editButtonText}>Edit marks</Text>
            </Pressable>
          </View>
        ))}

        {rounds.length === 0 ? (
          <Text style={styles.empty}>
            This session has no boards yet.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Total({
  label,
  value,
  palette,
}: {
  label: string;
  value: string;
  palette: Palette;
}) {
  const styles = makeStyles(palette);
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.page },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    loading: { padding: spacing.lg, color: palette.textSecondary },
    date: { fontSize: 20, fontWeight: '700', color: palette.textPrimary },
    meta: { fontSize: 13, color: palette.textSecondary, marginTop: spacing.xs },
    notes: {
      fontSize: 13,
      color: palette.textSecondary,
      fontStyle: 'italic',
      marginTop: spacing.sm,
    },
    totalsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    total: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.md,
    },
    totalLabel: { fontSize: 11, color: palette.textSecondary },
    totalValue: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    roundCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    roundHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    roundTitle: { fontSize: 15, fontWeight: '600', color: palette.textPrimary },
    roundScore: {
      fontSize: 18,
      fontWeight: '700',
      color: palette.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    roundMeta: { fontSize: 12, color: palette.textMuted, marginBottom: spacing.sm },
    faceWrap: { overflow: 'hidden', borderRadius: radius.md },
    editButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
    editButtonText: { color: palette.series1, fontWeight: '600', fontSize: 13 },
    empty: { color: palette.textMuted, textAlign: 'center' },
  });
}
