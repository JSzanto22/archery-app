/**
 * A supporting figure: a label, a number, and a caption.
 *
 * No longer a card. Four of these in bordered boxes made four objects out of
 * what is really one row of related numbers, and a screen where every group is
 * boxed has no hierarchy — the boxes all shout equally and none of them means
 * anything. They sit on the page now, separated by whitespace, with a hairline
 * between them so the columns stay legible without becoming containers.
 *
 * The one card left on the dashboard is the handicap, which is the point:
 * elevation used once reads as emphasis, used everywhere it reads as texture.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, type, usePalette } from '../../theme';

interface Props {
  label: string;
  value: string;
  caption?: string;
}

export default function StatTile({ label, value, caption }: Props) {
  const palette = usePalette();

  return (
    <View style={styles.tile}>
      <Text
        style={[styles.label, { color: palette.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.value, { color: palette.textPrimary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {caption ? (
        <Text
          style={[styles.caption, { color: palette.textMuted }]}
          numberOfLines={1}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    // Vertical padding only. Horizontal padding on a borderless tile just
    // pushes the numbers away from the edge they should align to.
    paddingVertical: spacing.sm,
  },
  label: { ...type.label },
  value: {
    ...type.display,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  caption: { ...type.label, fontWeight: '400', marginTop: 2 },
});
