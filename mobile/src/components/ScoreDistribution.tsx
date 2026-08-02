/**
 * Score distribution — how many arrows landed in each ring.
 *
 * A horizontal bar per score, because the job is comparing magnitudes across a
 * short ordered list. Bars are one hue with intensity following the score, so
 * the encoding is sequential rather than eight arbitrary colours; the count
 * and score are direct-labelled, so colour never carries meaning alone.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, type, usePalette, zoneColors } from '../theme';

interface Props {
  distribution: Array<{ score: number; count: number }>;
  maxScore: number;
  /** Standard face: bars wear the real ring colours rather than one accent. */
  isPreset?: boolean;
}

export default function ScoreDistribution({
  distribution,
  maxScore,
  isPreset = true,
}: Props) {
  const palette = usePalette();

  if (distribution.length === 0) return null;

  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const peak = Math.max(...distribution.map((d) => d.count));

  return (
    <View style={styles.wrap}>
      {distribution.map(({ score, count }) => {
        const share = count / total;

        // Each bar wears its ring's own colour — gold, red, blue, black,
        // white. An archer reads this the way they read the boss, and it
        // costs nothing: the score is direct-labelled either way, so colour
        // is reinforcement rather than the only channel.
        const ring =
          score === 0
            ? { fill: palette.critical, stroke: palette.critical }
            : zoneColors(score, maxScore, isPreset);

        return (
          <View key={score} style={styles.row}>
            <View
              style={[
                styles.pip,
                { backgroundColor: ring.fill, borderColor: ring.stroke },
              ]}
            />
            <Text
              style={[styles.score, { color: palette.textPrimary }]}
              numberOfLines={1}
            >
              {score === 0 ? 'M' : score}
            </Text>

            <View style={[styles.track, { backgroundColor: palette.gridline }]}>
              <View
                style={[
                  styles.bar,
                  {
                    // Widths are relative to the busiest ring, so the shape of
                    // the distribution stays visible even when it is flat.
                    width: `${Math.max(2, (count / peak) * 100)}%`,
                    backgroundColor: ring.fill,
                    // White and black rings would otherwise vanish into one
                    // theme or the other.
                    borderColor: ring.stroke,
                  },
                ]}
              />
            </View>

            <Text
              style={[styles.count, { color: palette.textSecondary }]}
              numberOfLines={1}
            >
              {count}
              <Text style={{ color: palette.textMuted }}>
                {`  ${Math.round(share * 100)}%`}
              </Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pip: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  score: {
    width: 18,
    textAlign: 'right',
    fontFamily: fonts.display,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    width: 62,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
});
