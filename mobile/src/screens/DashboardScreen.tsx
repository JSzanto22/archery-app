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
import TrendChart, { TrendPoint } from '../components/TrendChart';
import {
  Button,
  Chip,
  ListRow,
  SectionHeader,
  SegmentedControl,
  StatTile,
} from '../components/ui';
import { useDashboardData } from '../hooks/useDashboardData';
import { RootStackParamList } from '../navigation';
import { spacing, type, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

const RANGES: RangeKey[] = ['30d', '90d', '1y', 'all'];

export default function DashboardScreen({ navigation }: Props) {
  const palette = usePalette();

  const [range, setRange] = useState<RangeKey>('90d');
  const [showFilters, setShowFilters] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null);

  const { summaries, loading, reload } = useDashboardData(range);

  // Coming back from marking must show the new arrows.
  useFocusEffect(useCallback(() => reload(), [reload]));

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

  const groupingPoints: TrendPoint[] = useMemo(
    () =>
      filtered
        .filter((s) => s.grouping !== null)
        .map((s) => ({
          t: s.shotAt.getTime(),
          v: s.grouping!,
          label: formatDate(s.shotAt),
        })),
    [filtered],
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

            <View style={styles.tileRow}>
              <StatTile
                label="Best average"
                value={
                  bests.bestAverage?.averageScore
                    ? bests.bestAverage.averageScore.toFixed(2)
                    : '—'
                }
                caption={
                  bests.bestAverage
                    ? formatDate(bests.bestAverage.shotAt)
                    : 'per arrow'
                }
              />
              <StatTile
                label="Tightest group"
                value={
                  bests.tightestGroup?.grouping
                    ? formatGrouping(bests.tightestGroup.grouping)
                    : '—'
                }
                caption={
                  bests.tightestGroup
                    ? formatDate(bests.tightestGroup.shotAt)
                    : 'of face width'
                }
              />
            </View>

            {/* The counting stats don't earn tiles — one quiet line. */}
            <Text style={[styles.countLine, { color: palette.textMuted }]}>
              {plural(bests.totalSessions, 'session')} ·{' '}
              {plural(bests.totalArrows, 'arrow')} ·{' '}
              {RANGE_LABELS[range].toLowerCase()}
            </Text>

            {/* Two measures, two charts. Never a shared axis. */}
            <TrendChart
              title="Average score per arrow"
              points={scorePoints}
              color={palette.series1}
              format={(v) => v.toFixed(2)}
            />

            <TrendChart
              title="Grouping (smaller is tighter)"
              points={groupingPoints}
              color={palette.series2}
              format={formatGrouping}
              lowerIsBetter
            />

            <SectionHeader title="Sessions" />
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={[type.body, { color: palette.textSecondary }]}>
                Nothing here yet.
              </Text>
              <Text
                style={[
                  type.label,
                  styles.emptyBody,
                  { color: palette.textMuted },
                ]}
              >
                Record a session and it will show up here with its score and
                grouping.
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
      valueCaption={
        plural(summary.arrowCount, 'arrow') +
        (summary.averageScore !== null
          ? ` · ${summary.averageScore.toFixed(1)} avg`
          : '')
      }
      dotColor={summary.isPendingSync ? palette.accent : undefined}
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

/** Grouping is a fraction of face width; percent reads better than 0.0913. */
function formatGrouping(v: number): string {
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
  countLine: {
    ...type.label,
    fontWeight: '400',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyBody: {
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
