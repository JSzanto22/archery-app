import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { collections, GearProfile, Target } from '../db';
import { createSession, setTargetFaceWidth } from '../db/actions';
import { Button, Chip, Screen } from '../components/ui';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession'>;

const COMMON_DISTANCES = [18, 25, 30, 50, 70];

export default function NewSessionScreen({ navigation }: Props) {
  const palette = usePalette();

  const [targets, setTargets] = useState<Target[]>([]);
  const [gear, setGear] = useState<GearProfile[]>([]);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [gearId, setGearId] = useState<string | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [customDistance, setCustomDistance] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [faceWidth, setFaceWidth] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedTarget = targets.find((t) => t.id === targetId) ?? null;

  // Show the selected face's stored width, so the archer edits a real number
  // rather than typing into an empty box.
  useEffect(() => {
    setFaceWidth(
      selectedTarget?.faceWidthCm != null
        ? String(selectedTarget.faceWidthCm)
        : '',
    );
  }, [selectedTarget?.id, selectedTarget?.faceWidthCm]);

  useEffect(() => {
    (async () => {
      const [allTargets, allGear] = await Promise.all([
        collections.targets.query().fetch(),
        collections.gearProfiles.query().fetch(),
      ]);
      setTargets(allTargets);
      setGear(allGear);
      if (allTargets.length > 0) setTargetId(allTargets[0].id);
    })();
  }, []);

  const resolvedDistance =
    customDistance.trim() !== '' ? Number.parseFloat(customDistance) : distance;

  const canSave =
    targetId !== null &&
    !saving &&
    (resolvedDistance === null || Number.isFinite(resolvedDistance));

  const onStart = async () => {
    if (!targetId || saving) return;
    setSaving(true);

    try {
      // Persist an edited face width before the session starts, so this
      // session's grouping is reported against the corrected size.
      const parsedWidth = Number.parseFloat(faceWidth);
      if (
        selectedTarget &&
        faceWidth.trim() !== '' &&
        Number.isFinite(parsedWidth) &&
        parsedWidth > 0 &&
        parsedWidth !== selectedTarget.faceWidthCm
      ) {
        await setTargetFaceWidth(selectedTarget, parsedWidth);
      }

      const { session, round } = await createSession({
        shotAt: new Date(),
        distanceM:
          resolvedDistance !== null && Number.isFinite(resolvedDistance)
            ? resolvedDistance
            : null,
        gearProfileId: gearId,
        equipmentTag: null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        targetId,
      });

      // Replace rather than push: backing out of marking should land on the
      // dashboard, not on a setup form for a session that already exists.
      navigation.replace('Marking', {
        sessionId: session.id,
        roundId: round.id,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: palette.surface,
      borderColor: palette.border,
      color: palette.textPrimary,
    },
  ];

  return (
    <Screen>
      <FieldLabel text="Target face" />
      <View style={styles.chipRow}>
        {targets.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            selected={targetId === t.id}
            onPress={() => setTargetId(t.id)}
          />
        ))}
      </View>

      <FieldLabel text="Face width (cm)" />
      <TextInput
        style={inputStyle}
        placeholder="e.g. 122"
        placeholderTextColor={palette.textMuted}
        keyboardType="numeric"
        value={faceWidth}
        onChangeText={setFaceWidth}
      />
      <Text style={[styles.hint, { color: palette.textMuted }]}>
        The real diameter of the face you shot. Grouping is reported in
        centimetres from this — change it if you printed your own.
      </Text>

      <FieldLabel text="Distance" />
      <View style={styles.chipRow}>
        {COMMON_DISTANCES.map((d) => (
          <Chip
            key={d}
            label={`${d} m`}
            selected={distance === d && customDistance === ''}
            onPress={() => {
              setDistance(d);
              setCustomDistance('');
            }}
          />
        ))}
      </View>
      <TextInput
        style={inputStyle}
        placeholder="Or enter metres"
        placeholderTextColor={palette.textMuted}
        keyboardType="numeric"
        value={customDistance}
        onChangeText={(v) => {
          setCustomDistance(v);
          setDistance(null);
        }}
      />

      {gear.length > 0 ? (
        <>
          <FieldLabel text="Gear" />
          <View style={styles.chipRow}>
            <Chip
              label="Not recorded"
              selected={gearId === null}
              onPress={() => setGearId(null)}
            />
            {gear.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                selected={gearId === g.id}
                onPress={() => setGearId(g.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <FieldLabel text="Location" />
      <TextInput
        style={inputStyle}
        placeholder="Optional"
        placeholderTextColor={palette.textMuted}
        value={location}
        onChangeText={setLocation}
      />

      <FieldLabel text="Notes" />
      <TextInput
        style={[...inputStyle, styles.multiline]}
        placeholder="Wind, form, equipment changes…"
        placeholderTextColor={palette.textMuted}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <View style={styles.submit}>
        <Button
          label={saving ? 'Starting…' : 'Start marking'}
          variant="filled"
          block
          disabled={!canSave}
          onPress={onStart}
        />
      </View>
    </Screen>
  );
}

function FieldLabel({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    ...type.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...type.body,
    marginTop: spacing.sm,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  hint: { ...type.label, fontWeight: '400', marginTop: spacing.xs },
  submit: { marginTop: spacing.xl },
});
