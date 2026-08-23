/**
 * Inline status bar for errors and undo offers.
 *
 * Deliberately not an Alert. A modal has to be dismissed before the archer can
 * do anything else, and at a range that means taking a glove off to tap OK
 * while the line is still shooting. This sits in the layout, states what
 * happened, offers one action, and never blocks the next arrow.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette, radius, spacing, type, usePalette } from '../../theme';
import Button from './Button';

export type BannerTone = 'error' | 'info';

interface Props {
  tone: BannerTone;
  message: string;
  /** Label for the single action, e.g. "Retry" or "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export default function Banner({
  tone,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: Props) {
  const palette = usePalette();
  const colors = toneColors(tone, palette);

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.bg, borderColor: colors.border },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
    >
      <Text style={[styles.message, { color: colors.fg }]}>{message}</Text>

      <View style={styles.actions}>
        {actionLabel && onAction ? (
          <Button label={actionLabel} variant="text" onPress={onAction} />
        ) : null}
        {onDismiss ? (
          <Button label="Dismiss" variant="text" onPress={onDismiss} />
        ) : null}
      </View>
    </View>
  );
}

function toneColors(tone: BannerTone, palette: Palette) {
  if (tone === 'error') {
    return {
      // Tinted rather than saturated: an error at the range is information,
      // not an emergency, and a red slab is unreadable in direct sun.
      bg: palette.surface,
      border: palette.critical,
      fg: palette.textPrimary,
    };
  }

  return {
    bg: palette.accentTonal,
    border: 'transparent',
    fg: palette.onAccentTonal,
  };
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  message: { ...type.body, flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
