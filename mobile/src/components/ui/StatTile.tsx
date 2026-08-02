/**
 * A single headline number. The number is the hero; the label recedes.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../../theme';

interface Props {
  label: string;
  value: string;
  caption?: string;
}

export default function StatTile({ label, value, caption }: Props) {
  const palette = usePalette();

  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
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
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  label: { ...type.label },
  value: {
    ...type.display,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  caption: { ...type.label, fontWeight: '400', marginTop: 2 },
});
