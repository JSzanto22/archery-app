import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { collections, GearProfile, Target } from '../db';
import {
  createSession,
  setSightMark,
  setTargetFaceWidth,
  sightMarksFor,
} from '../db/actions';
import { estimateMark, type SightMark } from '../scoring/sightMarks';
import { Button, Chip, Screen } from '../components/ui';
import { ROUNDS, describe as describeRound } from '../rounds/catalogue';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession'>;

const COMMON_DISTANCES = [18, 25, 30, 50, 70];

export default function NewSessionScreen({ navigation }: Props) {
  const palette = usePalette();

  const [targets, setTargets] = useState<Target[]>([]);
  const [gear, setGear] = useState<GearProfile[]>([]);

  const [targetId, setTargetId] = useState<string | null>(null);
  /**
   * Null means freeform practice, which is a first-class choice — most range
   * time is not a scored round, and forcing one would make the app lie.
   */
  const [roundFormatId, setRoundFormatId] = useState<string | null>(null);
  /**
   * Null means "do not number my arrows".
   *
   * Numbering is inferred from shot order, which is only right if the archer
   * shoots their set in order — so it stays off until they say otherwise.
   */
  const [arrowSetSize, setArrowSetSize] = useState<number | null>(null);

  /** Marks recorded for the selected bow, for the estimate below. */
  const [marks, setMarks] = useState<SightMark[]>([]);
  const [markInput, setMarkInput] = useState('');
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
    void (async () => {
      const [allTargets, allGear] = await Promise.all([
        collections.targets.query().fetch(),
        collections.gearProfiles.query().fetch(),
      ]);
      setTargets(allTargets);
      setGear(allGear);

      const [firstTarget] = allTargets;
      if (firstTarget) setTargetId(firstTarget.id);
    })();
  }, []);

  const resolvedDistance =
    customDistance.trim() !== '' ? Number.parseFloat(customDistance) : distance;

  // Reload marks whenever the bow changes: they belong to the bow, not the
  // archer, so switching riser switches the whole set of numbers.
  useEffect(() => {
    void (async () => {
      if (!gearId) {
        setMarks([]);
        return;
      }

      const records = await sightMarksFor(gearId);
      setMarks(records.map((r) => ({ distanceM: r.distanceM, mark: r.mark })));
    })();
  }, [gearId]);

  const sightEstimate =
    gearId && resolvedDistance !== null && Number.isFinite(resolvedDistance)
      ? estimateMark(marks, resolvedDistance)
      : null;

  async function saveMark() {
    const value = Number.parseFloat(markInput);
    if (
      !gearId ||
      resolvedDistance === null ||
      !Number.isFinite(resolvedDistance) ||
      !Number.isFinite(value)
    ) {
      return;
    }

    await setSightMark(gearId, resolvedDistance, value);
    const records = await sightMarksFor(gearId);
    setMarks(records.map((r) => ({ distanceM: r.distanceM, mark: r.mark })));
    setMarkInput('');
  }

  const canSave =
    targetId !== null &&
    !saving &&
    (resolvedDistance === null || Number.isFinite(resolvedDistance));

  const selectedRound =
    roundFormatId === null
      ? null
      : (ROUNDS.find((r) => r.id === roundFormatId) ?? null);

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
        roundFormatId,
        arrowSetSize,
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
      <FieldLabel text="Round" />
      <View style={styles.chipRow}>
        <Chip
          label="Practice"
          selected={roundFormatId === null}
          onPress={() => setRoundFormatId(null)}
        />
        {ROUNDS.map((round) => (
          <Chip
            key={round.id}
            label={round.name}
            selected={roundFormatId === round.id}
            onPress={() => setRoundFormatId(round.id)}
          />
        ))}
      </View>
      <Text style={[styles.hint, { color: palette.textMuted }]}>
        {selectedRound
          ? `${describeRound(selectedRound)}. Shoot all of it and this scores a handicap.`
          : 'Freeform practice. Arrows are recorded, but a handicap needs a full round.'}
      </Text>

      <FieldLabel text="Numbered arrows" />
      <View style={styles.chipRow}>
        <Chip
          label="Not numbered"
          selected={arrowSetSize === null}
          onPress={() => setArrowSetSize(null)}
        />
        {[3, 6, 8, 12].map((size) => (
          <Chip
            key={size}
            label={`Set of ${size}`}
            selected={arrowSetSize === size}
            onPress={() => setArrowSetSize(size)}
          />
        ))}
      </View>
      <Text style={[styles.hint, { color: palette.textMuted }]}>
        {arrowSetSize === null
          ? 'Leave this off unless you shoot your arrows in number order.'
          : `Arrows will be numbered 1 to ${arrowSetSize} in the order you shoot them, so a shaft that lands wide can be identified.`}
      </Text>

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

          {/*
            The sight mark for this distance, at the moment it is needed.
            
            This is the one screen where it matters: the archer is standing at
            the line about to set their sight. Anywhere else it is a reference
            table; here it is the answer to the question they are asking.
          */}
          {gearId &&
          resolvedDistance !== null &&
          Number.isFinite(resolvedDistance) ? (
            <>
              <FieldLabel text={`Sight mark at ${resolvedDistance} m`} />
              {sightEstimate ? (
                <Text style={[styles.hint, { color: palette.textSecondary }]}>
                  {sightEstimate.confidence === 'recorded'
                    ? `${sightEstimate.mark} — recorded.`
                    : sightEstimate.confidence === 'interpolated'
                      ? `About ${sightEstimate.mark.toFixed(2)} — worked out from your other marks, not measured.`
                      : `About ${sightEstimate.mark.toFixed(2)} — beyond the distances you have recorded, so treat it as a starting point.`}
                </Text>
              ) : (
                <Text style={[styles.hint, { color: palette.textMuted }]}>
                  {marks.length < 2
                    ? 'Record marks at two distances and this can work out the ones in between.'
                    : 'Too far from the distances you have recorded to estimate.'}
                </Text>
              )}

              <View style={styles.markRow}>
                <TextInput
                  style={[inputStyle, styles.markInput]}
                  placeholder="Set it"
                  placeholderTextColor={palette.textMuted}
                  keyboardType="decimal-pad"
                  value={markInput}
                  onChangeText={setMarkInput}
                  accessibilityLabel={`Sight mark for ${resolvedDistance} metres`}
                />
                <Button
                  label="Save mark"
                  variant="tonal"
                  disabled={markInput.trim() === ''}
                  onPress={() => void saveMark()}
                />
              </View>
            </>
          ) : null}
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
          onPress={() => void onStart()}
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
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  markInput: { flex: 1, marginBottom: 0 },
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
