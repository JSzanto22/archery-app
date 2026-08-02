/**
 * Screen scaffold: safe area, page background, standard horizontal padding.
 *
 * Every screen renders inside one of these so edge spacing is decided once.
 * Pass `scroll={false}` for screens that manage their own list (FlatList owns
 * scrolling and must not be nested in a ScrollView).
 */

import React, { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

import { spacing, usePalette } from '../../theme';

interface Props {
  scroll?: boolean;
  edges?: Edge[];
}

export default function Screen({
  children,
  scroll = true,
  edges = ['left', 'right', 'bottom'],
}: PropsWithChildren<Props>) {
  const palette = usePalette();

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: palette.page }]}
      edges={edges}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, styles.noScroll]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  noScroll: { paddingHorizontal: spacing.md },
});
