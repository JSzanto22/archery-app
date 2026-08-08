/**
 * Choice chip. Selected state is a quiet tonal fill, not a full inversion —
 * the selection should read at a glance without shouting.
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { TOUCH_TARGET, radius, spacing, type, usePalette } from '../../theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export default function Chip({ label, selected, onPress }: Props) {
  const palette = usePalette();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: selected ? palette.accentTonal : palette.surface,
          borderColor: selected ? 'transparent' : palette.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: selected ? palette.onAccentTonal : palette.textSecondary,
            fontWeight: selected ? '600' : '400',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // A real 48dp target, not 40dp plus hitSlop. hitSlop extends the touch
    // area but not the visual one, so with gloves the archer aims at a
    // control that looks smaller than it is and misses the neighbouring gap.
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...type.body },
  pressed: { opacity: 0.65 },
});
