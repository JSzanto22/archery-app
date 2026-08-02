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

import { fonts, radius, spacing, type, usePalette } from '../theme';

interface Props {
  distribution: Array<{ score: number; count: number }>;
  /** Ring colours are shown when the face is a standard World Archery one. */
  maxScore: number;
}

export default function ScoreDistribution({ distribution, maxScore }: Props) {
  const palette = usePalette();

  if (distribution.length === 0) return null;

  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const peak = Math.max(...distribution.map((d) => d.count));

  return (
    <View style={styles.wrap}>
      {distribution.map(({ score, count }) => {
        const share = count / total;
        // Intensity tracks the score: a 10 is the strongest, a miss the faintest.
        const weight = maxScore > 0 ? Math.max(0.18, score / maxScore) : 0.5;

        return (
          <View key={score} style={styles.row}>
            <Text
              style={[styles.score, { color: palette.textPrimary }]}
              numberOfLines={1}
            >
              {score === 0 ? 'M' : score}
            </Text>

            <View
              style={[styles.track, { backgroundColor: palette.gridline }]}
            >
              <View
                style={[
                  styles.bar,
                  {
                    // Widths are relative to the busiest ring, so the shape of
                    // the distribution stays visible even when it is flat.
                    width: `${Math.max(2, (count / peak) * 100)}%`,
                    backgroundColor: palette.accent,
                    opacity: weight,
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
  score: {
    width: 22,
    textAlign: 'right',
    fontFamily: fonts.display,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bar: { height: '100%', borderRadius: radius.pill },
  count: {
    width: 62,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
});
