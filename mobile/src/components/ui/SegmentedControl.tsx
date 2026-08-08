/**
 * Single-row segmented control for mutually exclusive ranges/filters.
 * One hairline container, equal-width segments, tonal fill on the selection.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TOUCH_TARGET, radius, spacing, type, usePalette } from '../../theme';

interface Props<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  const palette = usePalette();

  return (
    <View
      style={[
        styles.container,
        { borderColor: palette.border, backgroundColor: palette.surface },
      ]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: palette.accentTonal },
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: selected
                    ? palette.onAccentTonal
                    : palette.textSecondary,
                  fontWeight: selected ? '600' : '400',
                },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segment: {
    flex: 1,
    // Full 48dp inside the 3dp container padding.
    minHeight: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  label: { ...type.body, fontSize: 13 },
  pressed: { opacity: 0.65 },
});
