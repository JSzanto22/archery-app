/**
 * What a new archer sees instead of an empty dashboard.
 *
 * The dashboard is a grid of measurements, and before anyone has shot an arrow
 * every one of them reads as a dash. Four blanks and two empty charts say
 * nothing about what the app is for and give no reason to keep it — so until
 * there is something to measure, this stands in its place.
 *
 * Deliberately not a tutorial carousel. There is one thing to do, it takes one
 * tap, and the app has nothing to teach that recording an end will not teach
 * better. The three lines below exist to make the point that this is an
 * archery app rather than a generic tracker, which is exactly the impression
 * an empty grid fails to give.
 *
 * Adding a bow is offered but not required. It is what sight marks hang off,
 * so an archer who does it here gets those working from their first session —
 * but nobody should have to fill in a form before they are allowed to shoot.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { createGearProfile } from '../db/actions';
import { fonts, radius, spacing, type, usePalette } from '../theme';
import { Button, Roundel } from './ui';

interface Props {
  /** Whether the archer already has at least one bow recorded. */
  hasGear: boolean;
  onGearAdded: () => void;
  onStart: () => void;
}

const POINTS = [
  {
    heading: 'Mark where every arrow landed',
    body: 'Tap the face as you score. Grouping and bias come out of the plot, not out of a number you type.',
  },
  {
    heading: 'Get an Archery GB handicap',
    body: 'Shoot a full round and the app works out the same number your club uses — comparable across every distance and face.',
  },
  {
    heading: 'Find the arrow that keeps missing',
    body: 'Number your set and the app will tell you when one shaft is landing away from the rest.',
  },
];

export default function FirstRun({ hasGear, onGearAdded, onStart }: Props) {
  const palette = usePalette();

  const [bowName, setBowName] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveBow() {
    if (bowName.trim() === '' || saving) return;

    setSaving(true);
    try {
      await createGearProfile(bowName.trim());
      setBowName('');
      onGearAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View
        style={styles.crest}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Roundel value="10" size={72} />
      </View>

      <Text
        style={[type.display, styles.title, { color: palette.textPrimary }]}
      >
        Every arrow, on the face
      </Text>
      <Text style={[type.body, styles.blurb, { color: palette.textSecondary }]}>
        Score a session in the time it takes to walk back from the boss.
      </Text>

      <View style={styles.points}>
        {POINTS.map((point) => (
          <View key={point.heading} style={styles.point}>
            <Text
              style={[
                type.body,
                styles.pointHeading,
                { color: palette.textPrimary },
              ]}
            >
              {point.heading}
            </Text>
            <Text style={[type.label, { color: palette.textMuted }]}>
              {point.body}
            </Text>
          </View>
        ))}
      </View>

      {hasGear ? null : (
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[type.body, { color: palette.textPrimary }]}>
            Which bow do you shoot?
          </Text>
          <Text style={[type.label, { color: palette.textMuted }]}>
            Optional, and you can add it later. Sight marks are kept per bow, so
            recording one now means they work from your first session.
          </Text>

          <View style={styles.bowRow}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: palette.page,
                  borderColor: palette.border,
                  color: palette.textPrimary,
                },
              ]}
              placeholder="e.g. Hoyt recurve"
              placeholderTextColor={palette.textMuted}
              value={bowName}
              onChangeText={setBowName}
              accessibilityLabel="Name of the bow"
              returnKeyType="done"
              onSubmitEditing={() => void saveBow()}
            />
            <Button
              label={saving ? 'Saving…' : 'Save'}
              variant="tonal"
              disabled={bowName.trim() === '' || saving}
              onPress={() => void saveBow()}
            />
          </View>
        </View>
      )}

      <Button
        label="Record your first session"
        variant="filled"
        block
        onPress={onStart}
      />

      <Text style={[type.label, styles.footnote, { color: palette.textMuted }]}>
        Everything is saved on this phone first. Signal is optional.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.lg, gap: spacing.md },
  crest: { alignItems: 'center' },
  title: { fontFamily: fonts.display, textAlign: 'center' },
  blurb: { textAlign: 'center' },
  points: { gap: spacing.md, marginTop: spacing.sm },
  point: { gap: 2 },
  pointHeading: { fontFamily: fonts.heading },
  card: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  input: {
    ...type.body,
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
  },
  footnote: { textAlign: 'center' },
});
