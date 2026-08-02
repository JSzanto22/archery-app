import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { collections, GearProfile, Target } from '../db';
import { createSession } from '../db/actions';
import { RootStackParamList } from '../navigation';
import { Palette, radius, spacing, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession'>;

const COMMON_DISTANCES = [18, 25, 30, 50, 70];

export default function NewSessionScreen({ navigation }: Props) {
  const palette = usePalette();
  const styles = makeStyles(palette);

  const [targets, setTargets] = useState<Target[]>([]);
  const [gear, setGear] = useState<GearProfile[]>([]);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [gearId, setGearId] = useState<string | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [customDistance, setCustomDistance] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
    customDistance.trim() !== ''
      ? Number.parseFloat(customDistance)
      : distance;

  const canSave =
    targetId !== null &&
    !saving &&
    (resolvedDistance === null || Number.isFinite(resolvedDistance));

  const onStart = async () => {
    if (!targetId || saving) return;
    setSaving(true);

    try {
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

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Target face</Text>
        <View style={styles.chipRow}>
          {targets.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={targetId === t.id}
              onPress={() => setTargetId(t.id)}
              palette={palette}
            />
          ))}
        </View>

        <Text style={styles.label}>Distance</Text>
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
              palette={palette}
            />
          ))}
        </View>
        <TextInput
          style={styles.input}
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
            <Text style={styles.label}>Gear</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Not recorded"
                selected={gearId === null}
                onPress={() => setGearId(null)}
                palette={palette}
              />
              {gear.map((g) => (
                <Chip
                  key={g.id}
                  label={g.name}
                  selected={gearId === g.id}
                  onPress={() => setGearId(g.id)}
                  palette={palette}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Location</Text>
        <TextInput
          style={styles.input}
          placeholder="Optional"
          placeholderTextColor={palette.textMuted}
          value={location}
          onChangeText={setLocation}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Wind, form, equipment changes…"
          placeholderTextColor={palette.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <Pressable
          style={[styles.primary, !canSave && styles.primaryDisabled]}
          onPress={onStart}
          disabled={!canSave}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>
            {saving ? 'Starting…' : 'Start marking'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({
  label,
  selected,
  onPress,
  palette,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  const styles = makeStyles(palette);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.page },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.textSecondary,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    chipActive: {
      backgroundColor: palette.textPrimary,
      borderColor: palette.textPrimary,
    },
    chipText: { color: palette.textSecondary, fontSize: 13 },
    chipTextActive: { color: palette.surface, fontWeight: '600' },
    input: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: palette.textPrimary,
      fontSize: 15,
      marginTop: spacing.sm,
    },
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    primary: {
      backgroundColor: palette.series1,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    primaryDisabled: { opacity: 0.5 },
    primaryText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  });
}
