/**
 * Flat list row, Google-style: no card, no divider — rhythm comes from
 * spacing, feedback from a pressed wash. Primary text left, big quiet number
 * right.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../../theme';

interface Props {
  title: string;
  subtitle?: string;
  /** Right-aligned figure — rendered large and tabular. */
  value?: string;
  valueCaption?: string;
  /** Small leading dot, e.g. pending-sync state. */
  dotColor?: string;
  onPress?: () => void;
}

export default function ListRow({
  title,
  subtitle,
  value,
  valueCaption,
  dotColor,
  onPress,
}: Props) {
  const palette = usePalette();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: palette.gridline },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.titleRow}>
          {dotColor ? (
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
          ) : null}
          <Text
            style={[styles.title, { color: palette.textPrimary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text
            style={[styles.subtitle, { color: palette.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value !== undefined ? (
        <View style={styles.trailing}>
          <Text style={[styles.value, { color: palette.textPrimary }]}>
            {value}
          </Text>
          {valueCaption ? (
            <Text style={[styles.valueCaption, { color: palette.textMuted }]}>
              {valueCaption}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm,
    borderRadius: radius.md,
  },
  main: { flex: 1, paddingRight: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: { ...type.body, fontWeight: '600' },
  subtitle: { ...type.label, fontWeight: '400', marginTop: 2 },
  trailing: { alignItems: 'flex-end' },
  value: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 26,
  },
  valueCaption: { ...type.label, fontWeight: '400', marginTop: 1 },
});
