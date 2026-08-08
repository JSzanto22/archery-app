/**
 * The score roundel — a number inside a concentric ring, the app's motif.
 *
 * It quotes the target face itself: gold ring, quiet centre, heavy numeral.
 * Used wherever a score is the payload of a row or header.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, usePalette } from '../../theme';

interface Props {
  value: string;
  /** Diameter in dp. */
  size?: number;
}

export default function Roundel({ value, size = 52 }: Props) {
  const palette = usePalette();
  const ring = Math.max(2, Math.round(size / 17));

  return (
    <View
      style={[
        styles.outer,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring,
          borderColor: palette.accentBorder,
          backgroundColor: palette.surface,
        },
      ]}
    >
      <Text
        style={[
          styles.value,
          {
            color: palette.textPrimary,
            fontSize: size * 0.36,
            lineHeight: size * 0.44,
          },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontFamily: fonts.display,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
});
