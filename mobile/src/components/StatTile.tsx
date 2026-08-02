/**
 * A single headline number.
 *
 * The right form for one current value — a one-bar chart would be worse in
 * every way. Used for the personal bests row.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette, radius, spacing, usePalette } from '../theme';

interface Props {
  label: string;
  value: string;
  caption?: string;
}

export default function StatTile({ label, value, caption }: Props) {
  const palette = usePalette();
  const styles = makeStyles(palette);

  return (
    <View style={styles.tile}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    tile: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.md,
    },
    label: {
      color: palette.textSecondary,
      fontSize: 12,
      marginBottom: spacing.xs,
    },
    value: {
      color: palette.textPrimary,
      fontSize: 26,
      fontWeight: '700',
    },
    caption: {
      color: palette.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
  });
}
