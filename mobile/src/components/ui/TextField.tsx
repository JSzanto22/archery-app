/**
 * A labelled text field.
 *
 * Every screen before this one styled its inputs inline, which was fine for
 * the two on New Session and would have meant five copies once auth arrived.
 *
 * The error sits under the field rather than in a Banner at the top: on a
 * form, "which box is wrong" is the whole question, and an archer holding a
 * phone in one hand should not have to look away from the field to read the
 * answer. Colour is not the only signal — the message is text, so it survives
 * both bright sun and colour-blindness.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { TOUCH_TARGET, radius, spacing, type, usePalette } from '../../theme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field, in the critical colour, when set. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string;
}

export default function TextField({ label, error, hint, ...input }: Props) {
  const palette = usePalette();

  return (
    <View style={styles.group}>
      <Text
        style={[type.label, styles.label, { color: palette.textSecondary }]}
      >
        {label.toUpperCase()}
      </Text>

      <TextInput
        {...input}
        accessibilityLabel={label}
        // Announced with the field rather than as a separate alert, so a
        // screen reader reaches the message while focus is still on the box
        // that caused it.
        accessibilityHint={error ?? hint}
        placeholderTextColor={palette.textMuted}
        style={[
          type.body,
          styles.input,
          {
            backgroundColor: palette.surface,
            color: palette.textPrimary,
            // A field in error is outlined, not tinted: a filled red box in
            // direct sunlight loses the text inside it.
            borderColor: error ? palette.critical : palette.border,
            borderWidth: error ? 2 : 1,
          },
        ]}
      />

      {error ? (
        <Text style={[type.label, styles.note, { color: palette.critical }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[type.label, styles.note, { color: palette.textMuted }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs, letterSpacing: 0.6 },
  input: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm,
  },
  note: { marginTop: spacing.xs },
});
