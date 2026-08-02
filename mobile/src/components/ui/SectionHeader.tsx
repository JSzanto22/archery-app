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
        {title}
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
  title: { ...type.body, fontSize: 16, fontWeight: '700' },
});
