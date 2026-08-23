/**
 * Section heading with optional trailing action. Sets the 24dp section rhythm.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, type, usePalette } from '../../theme';

interface Props {
  title: string;
  /** Optional right-aligned element, e.g. a text Button. */
  trailing?: React.ReactNode;
}

export default function SectionHeader({ title, trailing }: Props) {
  const palette = usePalette();

  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: palette.textPrimary }]}>
        {title.toUpperCase()}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  /*
   * A section marker, not a heading.
   *
   * At 16px it sat four pixels under the page title and read as a competing
   * heading, which flattened the page: everything looked like a top-level
   * thing. Small, heavy and tracked reads as a label for what follows, and
   * leaves the title as the only heading on the screen.
   */
  title: {
    ...type.label,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    lineHeight: 16,
  },
});
