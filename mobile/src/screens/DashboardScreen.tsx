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
import { useAuth } from '../auth/AuthProvider';
import { seedDemoData } from '../db/devSeed';
import {
  personalBestsByRound,
  summariseHandicap,
} from '../analytics/handicapProgress';
import { useDashboardData } from '../hooks/useDashboardData';
import { formatDate, formatPercent, formatTime, plural } from '../lib/format';
import { useSync } from '../sync/useSync';
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

  const { getAccessToken, isSignedIn } = useAuth();
  const sync = useSync({
    getAccessToken,
    enabled: isSignedIn,
    onChanged: reload,
  });

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

  /*
   * Handicap leads the dashboard because it is the only figure here that is
   * comparable between a 70 m shoot and an 18 m one. Average arrow score,
   * which used to lead, is not: it made the headline chart compare quantities
   * that are not alike.
   *
   * Computed over every summary rather than the distance-filtered set — a
   * handicap is already distance-independent, so filtering it by distance
   * would throw away exactly the property that makes it worth showing.
   */
  const handicap = useMemo(
    () =>
      summariseHandicap(
        summaries.map((s) => ({
          sessionId: s.sessionId,
          shotAt: s.shotAt,
          roundFormatId: s.roundFormatId,
          arrowCount: s.arrowCount,
          totalScore: s.totalScore,
        })),
      ),
    [summaries],
  );

  const roundBests = useMemo(
    () =>
      personalBestsByRound(
        summaries.map((s) => ({
          sessionId: s.sessionId,
          shotAt: s.shotAt,
          roundFormatId: s.roundFormatId,
          arrowCount: s.arrowCount,
          totalScore: s.totalScore,
        })),
      ),
    [summaries],
  );

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
              <View style={styles.titleActions}>
                <Button
                  label="Account"
                  onPress={() => navigation.navigate('Account')}
                />
                <Button
                  label="New session"
                  variant="filled"
                  onPress={() => navigation.navigate('NewSession')}
                />
              </View>
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
                label="Handicap"
                value={
                  handicap.current !== null ? String(handicap.current) : '—'
                }
                caption={
                  handicap.current === null
                    ? 'shoot a full round'
                    : handicap.change === null
                      ? (handicap.latest?.roundName ?? 'first round')
                      : // Lower is better, so a negative change is progress and
                        // has to read that way — "down from 47", never "-5".
                        handicap.change < 0
                        ? `down from ${handicap.current - handicap.change}`
                        : handicap.change > 0
                          ? `up from ${handicap.current - handicap.change}`
                          : 'unchanged'
                }
              />
              <StatTile
                label="Best handicap"
                value={
                  handicap.best !== null ? String(handicap.best.handicap) : '—'
                }
                caption={handicap.best?.roundName ?? 'no full round yet'}
              />
            </View>

            {/*
              Grouping stays, one row down and in real units. It is a genuine
              measure, but a session-sized sample of it is mostly noise — so it
              informs rather than leads.
            */}
            <View style={styles.tileRow}>
              <StatTile
                label="Average arrow"
                value={
                  bests.overallAverage !== null
                    ? bests.overallAverage.toFixed(2)
                    : '—'
                }
                caption="per arrow, this range"
              />
              <StatTile
                label="Tightest group"
                value={
                  bests.tightestGroup?.groupingCm != null
                    ? formatDistance(bests.tightestGroup.groupingCm, units)
                    : '—'
                }
                caption={
                  bests.tightestGroup?.groupingCm != null
                    ? 'spread from centre'
                    : 'set a face width'
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

            {/*
              Sync state, stated plainly. The archer's question is never "did
              the protocol succeed" — it is "are my arrows safe if I lose this
              phone", so the copy answers that instead.
            */}
            {/*
              Personal bests, one per round. A best only means anything inside
              a format — 546 is a fine Portsmouth and a poor WA 720 — which is
              why these are listed by round rather than reduced to one number.
            */}
            {roundBests.length > 0 ? (
              <View style={styles.bestsRow}>
                {roundBests.slice(0, 4).map((best) => (
                  <Chip
                    key={best.roundId}
                    label={`${best.roundName} · ${best.score}`}
                    selected={false}
                    onPress={() => setDistanceFilter(null)}
                  />
                ))}
              </View>
            ) : null}

            {isSignedIn ? (
              <View style={styles.syncRow}>
                <Text
                  style={[styles.countLine, { color: palette.textMuted }]}
                  numberOfLines={2}
                >
                  {sync.state === 'syncing'
                    ? 'Backing up…'
                    : sync.error
                      ? sync.error
                      : sync.lastSyncedAt
                        ? `Backed up ${formatTime(sync.lastSyncedAt)}`
                        : 'Not backed up yet'}
                </Text>
                <Button
                  label={sync.state === 'syncing' ? 'Syncing…' : 'Back up now'}
                  variant="text"
                  disabled={sync.state === 'syncing'}
                  onPress={() => void sync.sync()}
                />
              </View>
            ) : null}

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
                    onPress={() => void onSeedDemo()}
                  />
                </View>
              ) : null}
              {/* A quiet quote of the target face — the app's motif. */}
              <View
                style={[
                  styles.emptyRingOuter,
                  { borderColor: palette.accentBorder },
                ]}
              >
                <View
                  style={[
                    styles.emptyRingInner,
                    { borderColor: palette.gridline },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyBull,
                      { backgroundColor: palette.accent },
                    ]}
                  />
                </View>
              </View>
              <Text
                style={[
                  type.body,
                  styles.emptyTitle,
                  { color: palette.textSecondary },
                ]}
              >
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  bestsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
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
