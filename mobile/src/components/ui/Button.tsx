/**
 * The app's one button, three emphases — with weight.
 *
 * `filled` is the single primary action a screen gets: a gold slab with a
 * darker bottom edge that compresses when pressed, so the button feels like a
 * physical key rather than a painted rectangle. No animation library — the
 * press effect is a static style swap (edge shrinks, face drops 2dp).
 *
 * `tonal` is the supporting action, same physics in a quieter tint.
 * `text` is everything else. If a screen seems to need two filled buttons,
 * the screen has two jobs.
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import {
  Palette,
  TOUCH_TARGET,
  fonts,
  radius,
  spacing,
  usePalette,
} from '../../theme';

export type ButtonVariant = 'filled' | 'tonal' | 'text';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Stretch to the row/container width. Default hugs content. */
  block?: boolean;
}

const EDGE = 3;

export default function Button({
  label,
  onPress,
  variant = 'text',
  disabled = false,
  block = false,
}: Props) {
  const palette = usePalette();
  const colors = variantColors(variant, palette);
  const hasEdge = variant !== 'text';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        block && styles.block,
        {
          backgroundColor: colors.bg,
          borderBottomColor: colors.edge,
          borderBottomWidth: hasEdge ? (pressed ? 1 : EDGE) : 0,
          // The face drops by the edge it lost, so the button's footprint is
          // stable and nothing below it shifts.
          marginTop: hasEdge && pressed ? EDGE - 1 : 0,
        },
        pressed && variant === 'text' && styles.textPressed,
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
      return {
        bg: palette.accent,
        fg: palette.onAccent,
        edge: palette.accentEdge,
      };
    case 'tonal':
      return {
        bg: palette.accentTonal,
        fg: palette.onAccentTonal,
        edge: palette.gridline,
      };
    case 'text':
      return { bg: 'transparent', fg: palette.accentText, edge: 'transparent' };
  }
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.control,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  block: { alignSelf: 'stretch' },
  label: { fontSize: 15, fontFamily: fonts.heading, letterSpacing: 0.2 },
  textPressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
