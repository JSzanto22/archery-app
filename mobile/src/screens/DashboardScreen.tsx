import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  RANGE_LABELS,
  RangeKey,
  SessionSummary,
  personalBests,
} from '../analytics/dashboard';
import StatTile from '../components/StatTile';
import TrendChart, { TrendPoint } from '../components/TrendChart';
import { useDashboardData } from '../hooks/useDashboardData';
import { RootStackParamList } from '../navigation';
import { Palette, radius, spacing, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

const RANGES: RangeKey[] = ['30d', '90d', '1y', 'all'];

export default function DashboardScreen({ navigation }: Props) {
  const palette = usePalette();
  const styles = makeStyles(palette);

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
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
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
              <Text style={styles.screenTitle}>Your shooting</Text>
              <Pressable
                style={styles.newButton}
                onPress={() => navigation.navigate('NewSession')}
                accessibilityRole="button"
              >
                <Text style={styles.newButtonText}>New session</Text>
              </Pressable>
            </View>

            <View style={styles.rangeRow}>
              {RANGES.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setRange(key)}
                  style={[
                    styles.rangeChip,
                    range === key && styles.rangeChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: range === key }}
                >
                  <Text
                    style={[
                      styles.rangeChipText,
                      range === key && styles.rangeChipTextActive,
                    ]}
                  >
                    {RANGE_LABELS[key]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Advanced filters stay collapsed until asked for. */}
            <Pressable
              onPress={() => setShowFilters((v) => !v)}
              style={styles.filterToggle}
            >
              <Text style={styles.filterToggleText}>
                {showFilters ? 'Hide filters' : 'Filters'}
                {distanceFilter !== null ? ` · ${distanceFilter} m` : ''}
              </Text>
            </Pressable>

            {showFilters ? (
              <View style={styles.filterRow}>
                <Pressable
                  onPress={() => setDistanceFilter(null)}
                  style={[
                    styles.rangeChip,
                    distanceFilter === null && styles.rangeChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.rangeChipText,
                      distanceFilter === null && styles.rangeChipTextActive,
                    ]}
                  >
                    All distances
                  </Text>
                </Pressable>
                {distances.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setDistanceFilter(d)}
                    style={[
                      styles.rangeChip,
                      distanceFilter === d && styles.rangeChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rangeChipText,
                        distanceFilter === d && styles.rangeChipTextActive,
                      ]}
                    >
                      {d} m
                    </Text>
                  </Pressable>
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
              <View style={{ width: spacing.sm }} />
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

            <View style={styles.tileRow}>
              <StatTile
                label="Sessions"
                value={String(bests.totalSessions)}
                caption={RANGE_LABELS[range].toLowerCase()}
              />
              <View style={{ width: spacing.sm }} />
              <StatTile
                label="Arrows"
                value={String(bests.totalArrows)}
                caption="marks recorded"
              />
            </View>

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

            <Text style={styles.sectionTitle}>Sessions</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyBody}>
                Record a session and it will show up here with its score and
                grouping.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <SessionRow
            summary={item}
            palette={palette}
            onPress={() =>
              navigation.navigate('SessionDetail', { sessionId: item.sessionId })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

function SessionRow({
  summary,
  palette,
  onPress,
}: {
  summary: SessionSummary;
  palette: Palette;
  onPress: () => void;
}) {
  const styles = makeStyles(palette);

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowMain}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowDate}>{formatDate(summary.shotAt)}</Text>
          {summary.isPendingSync ? (
            <View style={styles.pendingPill}>
              <Text style={styles.pendingText}>Not synced</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[
            summary.distanceM !== null ? `${summary.distanceM} m` : null,
            summary.gearLabel,
            summary.location,
          ]
            .filter(Boolean)
            .join(' · ') || 'No details'}
        </Text>
      </View>

      <View style={styles.rowStats}>
        <Text style={styles.rowScore}>{summary.totalScore}</Text>
        <Text style={styles.rowSub}>
          {summary.arrowCount} arrows
          {summary.averageScore !== null
            ? ` · ${summary.averageScore.toFixed(1)} avg`
            : ''}
        </Text>
      </View>
    </Pressable>
  );
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

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.page },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    screenTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: palette.textPrimary,
    },
    newButton: {
      backgroundColor: palette.series1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    newButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
    rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    rangeChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    rangeChipActive: {
      backgroundColor: palette.textPrimary,
      borderColor: palette.textPrimary,
    },
    rangeChipText: { color: palette.textSecondary, fontSize: 13 },
    rangeChipTextActive: { color: palette.surface, fontWeight: '600' },
    filterToggle: { paddingVertical: spacing.sm },
    filterToggleText: { color: palette.series1, fontSize: 13, fontWeight: '600' },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    tileRow: { flexDirection: 'row', marginBottom: spacing.sm },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.textPrimary,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    rowMain: { flex: 1, paddingRight: spacing.sm },
    rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowDate: { fontSize: 15, fontWeight: '600', color: palette.textPrimary },
    rowMeta: { fontSize: 12, color: palette.textSecondary, marginTop: 2 },
    rowStats: { alignItems: 'flex-end' },
    rowScore: {
      fontSize: 20,
      fontWeight: '700',
      color: palette.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    rowSub: { fontSize: 11, color: palette.textMuted },
    pendingPill: {
      backgroundColor: palette.gridline,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    pendingText: { fontSize: 10, color: palette.textSecondary },
    emptyCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.lg,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.textPrimary,
      marginBottom: spacing.xs,
    },
    emptyBody: {
      fontSize: 13,
      color: palette.textSecondary,
      textAlign: 'center',
    },
  });
}
