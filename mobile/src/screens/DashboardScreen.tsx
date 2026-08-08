import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  RANGE_LABELS,
  RangeKey,
  SessionSummary,
  personalBests,
} from '../analytics/dashboard';
import ScoreDistribution from '../components/ScoreDistribution';
import TargetFace from '../components/TargetFace';
import TrendChart, { TrendPoint } from '../components/TrendChart';
import {
  Button,
  Chip,
  ListRow,
  SectionHeader,
  SegmentedControl,
  StatTile,
} from '../components/ui';
import { seedDemoData } from '../db/devSeed';
import { useDashboardData } from '../hooks/useDashboardData';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';
import { formatDistance, useUnits } from '../units';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

const RANGES: RangeKey[] = ['30d', '90d', '1y', 'all'];

export default function DashboardScreen({ navigation }: Props) {
  const palette = usePalette();
  const { units, toggle: toggleUnits } = useUnits();

  const [range, setRange] = useState<RangeKey>('90d');
  const [showFilters, setShowFilters] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null);

  const { summaries, groupMap, loading, reload } = useDashboardData(range);
  const [seeding, setSeeding] = useState(false);

  // Coming back from marking must show the new arrows.
  useFocusEffect(useCallback(() => reload(), [reload]));

  const onSeedDemo = useCallback(async () => {
    setSeeding(true);
    try {
      await seedDemoData();
      reload();
    } finally {
      setSeeding(false);
    }
  }, [reload]);

  const filtered = useMemo(
    () =>
      distanceFilter === null
        ? summaries
        : summaries.filter((s) => s.distanceM === distanceFilter),
    [distanceFilter, summaries],
  );

  const distances = useMemo(() => {
    const set = new Set<number>();
    summaries.forEach((s) => {
      if (s.distanceM !== null) set.add(s.distanceM);
    });
    return [...set].sort((a, b) => a - b);
  }, [summaries]);

  const bests = useMemo(() => personalBests(filtered), [filtered]);

  /** Highest score any arrow in range could have earned. */
  const topRingScore = useMemo(
    () => filtered.reduce((best, s) => Math.max(best, s.maxArrowScore), 10),
    [filtered],
  );

  const scorePoints: TrendPoint[] = useMemo(
    () =>
      filtered
        .filter((s) => s.averageScore !== null)
        .map((s) => ({
          t: s.shotAt.getTime(),
          v: s.averageScore!,
          label: formatDate(s.shotAt),
        })),
    [filtered],
  );

  /**
   * The grouping trend plots real distance when every session in the range has
   * a known face size, and falls back to percentage otherwise. Mixing the two
   * on one axis would put centimetres and percentages on the same scale.
   */
  const groupingInCm = useMemo(
    () =>
      filtered.length > 0 &&
      filtered.every((s) => s.grouping === null || s.groupingCm !== null),
    [filtered],
  );

  const groupingPoints: TrendPoint[] = useMemo(
    () =>
      filtered
        .filter((s) => s.grouping !== null)
        .map((s) => ({
          t: s.shotAt.getTime(),
          v: groupingInCm ? s.groupingCm! : s.grouping!,
          label: formatDate(s.shotAt),
        })),
    [filtered, groupingInCm],
  );

  const groupingUnitLabel = groupingInCm
    ? units === 'metric'
      ? 'cm'
      : 'inches'
    : '% of face';

  const groupingFormatter = useCallback(
    (v: number) => (groupingInCm ? formatDistance(v, units) : formatPercent(v)),
    [groupingInCm, units],
  );

  const listData = useMemo(
    () => [...filtered].sort((a, b) => b.shotAt.getTime() - a.shotAt.getTime()),
    [filtered],
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.page }]}
      edges={['top', 'left', 'right']}
    >
      <FlatList
        data={listData}
        keyExtractor={(item) => item.sessionId}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} />
        }
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={[type.title, { color: palette.textPrimary }]}>
                Your shooting
              </Text>
              <Button
                label="New session"
                variant="filled"
                onPress={() => navigation.navigate('NewSession')}
              />
            </View>

            <SegmentedControl
              options={RANGES.map((key) => ({
                value: key,
                label: RANGE_LABELS[key],
              }))}
              value={range}
              onChange={setRange}
            />

            {/* Advanced filters stay collapsed until asked for. */}
            <View style={styles.filterToggleRow}>
              <Button
                label={
                  showFilters
                    ? 'Hide filters'
                    : distanceFilter !== null
                      ? `Filters · ${distanceFilter} m`
                      : 'Filters'
                }
                variant="text"
                onPress={() => setShowFilters((v) => !v)}
              />
            </View>

            {showFilters ? (
              <View style={styles.chipRow}>
                <Chip
                  label="All distances"
                  selected={distanceFilter === null}
                  onPress={() => setDistanceFilter(null)}
                />
                {distances.map((d) => (
                  <Chip
                    key={d}
                    label={`${d} m`}
                    selected={distanceFilter === d}
                    onPress={() => setDistanceFilter(d)}
                  />
                ))}
              </View>
            ) : null}

            {/* Every arrow in the range, on the face it was shot at. The
                cloud's shape is the grouping; its offset is the sight error. */}
            {groupMap && groupMap.points.length > 0 ? (
              <View
                style={[
                  styles.mapCard,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={styles.mapHeader}>
                  <Text style={[type.label, { color: palette.textSecondary }]}>
                    {plural(groupMap.points.length, 'arrow')} on the boss
                  </Text>
                  <Text style={[type.label, { color: palette.textMuted }]}>
                    {groupMap.mixedFaces
                      ? `rings: ${groupMap.targetName}`
                      : groupMap.targetName}
                  </Text>
                </View>
                <View style={styles.mapFace}>
                  <TargetFace
                    zones={groupMap.zones}
                    marks={groupMap.points}
                    isPreset={groupMap.isPreset}
                    aspectRatio={groupMap.aspectRatio}
                    centroid={groupMap.centroid}
                    dense
                  />
                </View>
                {bests.dominantBias ? (
                  <Text
                    style={[styles.mapCaption, { color: palette.textMuted }]}
                  >
                    Crosshair marks the group centre — sitting{' '}
                    {bests.dominantBias} of the middle.
                  </Text>
                ) : (
                  <Text
                    style={[styles.mapCaption, { color: palette.textMuted }]}
                  >
                    Crosshair marks the group centre.
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.tileRow}>
              <StatTile
                label="Average arrow"
                value={
                  bests.overallAverage !== null
                    ? bests.overallAverage.toFixed(2)
                    : '—'
                }
                caption={
                  bests.bestAverage?.averageScore
                    ? `best ${bests.bestAverage.averageScore.toFixed(2)}`
                    : 'per arrow'
                }
              />
              <StatTile
                label="Tightest group"
                value={
                  // Real distance leads; the percentage is the caption. A
                  // percentage alone is not comparable between face sizes.
                  bests.tightestGroup?.groupingCm != null
                    ? formatDistance(bests.tightestGroup.groupingCm, units)
                    : bests.tightestGroup?.grouping != null
                      ? formatPercent(bests.tightestGroup.grouping)
                      : '—'
                }
                caption={
                  bests.tightestGroup?.grouping != null
                    ? `${formatPercent(bests.tightestGroup.grouping)} of face`
                    : 'spread from centre'
                }
              />
            </View>

            <View style={styles.tileRow}>
              <StatTile
                label={`${bests.distribution[0]?.score ?? 10}s hit`}
                value={String(bests.totalTopScores)}
                caption={
                  bests.totalArrows > 0
                    ? `${Math.round(
                        (bests.totalTopScores / bests.totalArrows) * 100,
                      )}% of arrows`
                    : 'top ring'
                }
              />
              <StatTile
                label="Group sits"
                value={bests.dominantBias ?? 'centred'}
                caption={
                  bests.dominantBias
                    ? 'most sessions — check sight'
                    : 'no consistent bias'
                }
              />
            </View>

            {/* The counting stats don't earn tiles — one quiet line. */}
            <View style={styles.countRow}>
              <Text style={[styles.countLine, { color: palette.textMuted }]}>
                {plural(bests.totalSessions, 'session')} ·{' '}
                {plural(bests.totalArrows, 'arrow')} ·{' '}
                {RANGE_LABELS[range].toLowerCase()}
              </Text>
              <Button
                label={units === 'metric' ? 'cm' : 'inches'}
                variant="text"
                onPress={toggleUnits}
              />
            </View>

            {bests.distribution.length > 0 ? (
              <>
                <SectionHeader title="Arrows per ring" />
                <ScoreDistribution
                  distribution={bests.distribution}
                  maxScore={bests.distribution[0]?.score ?? 10}
                  isPreset={groupMap?.isPreset ?? true}
                />
              </>
            ) : null}

            {/* Two measures, two charts. Never a shared axis. */}
            <TrendChart
              title="Average score per arrow"
              points={scorePoints}
              color={palette.series1}
              format={(v) => v.toFixed(2)}
              // Top ring of the face actually shot — 10 on a WA face, 12 on a
              // 3D animal. Never assume 10.
              domain={{ min: 0, max: topRingScore }}
            />

            <TrendChart
              title={`Group spread${
                groupingUnitLabel ? ` (${groupingUnitLabel})` : ''
              }`}
              points={groupingPoints}
              color={palette.series2}
              format={groupingFormatter}
              lowerIsBetter
              // A spread cannot be negative.
              domain={{ min: 0 }}
            />

            <SectionHeader title="Sessions" />
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              {/* Dev only: an empty dashboard shows none of what the app does,
                  which makes the UI impossible to judge or screenshot. */}
              {__DEV__ ? (
                <View style={styles.devSeed}>
                  <Button
                    label={seeding ? 'Loading…' : 'Load demo data'}
                    variant="tonal"
                    disabled={seeding}
                    onPress={onSeedDemo}
                  />
                </View>
              ) : null}
              {/* A quiet quote of the target face — the app's motif. */}
              <View style={[styles.emptyRingOuter, { borderColor: palette.accent }]}>
                <View
                  style={[styles.emptyRingInner, { borderColor: palette.gridline }]}
                >
                  <View
                    style={[styles.emptyBull, { backgroundColor: palette.accent }]}
                  />
                </View>
              </View>
              <Text style={[type.body, styles.emptyTitle, { color: palette.textSecondary }]}>
                No arrows loosed yet.
              </Text>
              <Text
                style={[
                  type.label,
                  styles.emptyBody,
                  { color: palette.textMuted },
                ]}
              >
                Record a session and it lands here with its score and grouping.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <SessionRow
            summary={item}
            onPress={() =>
              navigation.navigate('SessionDetail', {
                sessionId: item.sessionId,
              })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

function SessionRow({
  summary,
  onPress,
}: {
  summary: SessionSummary;
  onPress: () => void;
}) {
  const palette = usePalette();

  const meta = [
    summary.distanceM !== null ? `${summary.distanceM} m` : null,
    summary.gearLabel,
    summary.location,
    summary.isPendingSync ? 'Not synced' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      title={formatDate(summary.shotAt)}
      subtitle={meta || 'No details'}
      value={String(summary.totalScore)}
      roundel
      valueCaption={
        plural(summary.arrowCount, 'arrow') +
        (summary.averageScore !== null
          ? ` · ${summary.averageScore.toFixed(1)} avg`
          : '')
      }
      dotColor={summary.isPendingSync ? palette.accentText : undefined}
      onPress={onPress}
    />
  );
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** A normalized fraction of face width reads better as a percentage. */
function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  filterToggleRow: { alignItems: 'flex-start', marginVertical: spacing.xs },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  mapCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  // The face is the hero here, but it should not push everything else off
  // the first screen — capped so the stats stay in view beneath it.
  mapFace: { alignSelf: 'center', width: '78%', maxWidth: 320 },
  mapCaption: { ...type.label, fontWeight: '400', marginTop: spacing.sm },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  countLine: { ...type.label, fontWeight: '400', flex: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  devSeed: { marginBottom: spacing.lg },
  emptyRingOuter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyRingInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBull: { width: 14, height: 14, borderRadius: 7 },
  emptyTitle: { fontWeight: '600' },
  emptyBody: {
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
