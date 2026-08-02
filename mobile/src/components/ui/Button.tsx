/**
 * The app's one button, three emphases.
 *
 * `filled` is the single primary action a screen gets — it wears the accent.
 * `tonal` is the supporting action. `text` is everything else. If a screen
 * seems to need two filled buttons, the screen has two jobs.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { Palette, TOUCH_TARGET, radius, spacing, type, usePalette } from '../../theme';

export type ButtonVariant = 'filled' | 'tonal' | 'text';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Stretch to the row/container width. Default hugs content. */
  block?: boolean;
}

export default function Button({
  label,
  onPress,
  variant = 'text',
  disabled = false,
  block = false,
}: Props) {
  const palette = usePalette();

  const colors = variantColors(variant, palette);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        block && styles.block,
        { backgroundColor: colors.bg },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function variantColors(variant: ButtonVariant, palette: Palette) {
  switch (variant) {
    case 'filled':
      return { bg: palette.accent, fg: palette.onAccent };
    case 'tonal':
      return { bg: palette.accentTonal, fg: palette.onAccentTonal };
    case 'text':
      return { bg: 'transparent', fg: palette.accent };
  }
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  block: { alignSelf: 'stretch', flex: undefined },
  label: { ...type.body, fontWeight: '600' },
  // Feedback is an opacity dip — no animation, no ripple machinery.
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
});
