/**
 * The screen the app exists for: tap the face where each arrow landed.
 *
 * Score and grouping update on every tap, computed here on the device from the
 * marks already in local state. Nothing waits on the network — the archer is
 * standing at a target, frequently with no signal.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TargetFace, { Mark } from '../components/TargetFace';
import { Arrow, Round, Target, collections } from '../db';
import { addArrow, addRound, attachLocalPhoto, deleteArrow } from '../db/actions';
import { findPreset } from '../db/presets';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
import { Zone, maxZoneScore } from '../scoring/scoring';
import { RootStackParamList } from '../navigation';
import { Palette, radius, spacing, usePalette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Marking'>;

export default function MarkingScreen({ navigation, route }: Props) {
  const { sessionId, roundId } = route.params;
  const palette = usePalette();
  const styles = makeStyles(palette);

  const [round, setRound] = useState<Round | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const loadedRound = await collections.rounds.find(roundId);
    const loadedTarget = await collections.targets.find(loadedRound.targetId);
    const loadedZones = await loadedTarget.toScoringZones();
    const loadedArrows = await loadedRound.orderedArrows.fetch();

    setRound(loadedRound);
    setTarget(loadedTarget);
    setZones(loadedZones);
    setArrows(loadedArrows);
  }, [roundId]);

  useEffect(() => {
    load();
  }, [load]);

  const preset = target ? findPreset(target.id) : undefined;
  const aspectRatio = target?.effectiveAspectRatio ?? 1;

  const marks: Mark[] = arrows.map((a) => ({
    id: a.id,
    x: a.x,
    y: a.y,
    scoreValue: a.scoreValue,
  }));

  const total = arrows.reduce((sum, a) => sum + a.scoreValue, 0);
  const best = maxZoneScore(zones);
  const points = arrows.map((a) => ({ x: a.x, y: a.y }));

  const grouping =
    preset && preset.aimPoints.length > 1
      ? groupSpreadMultiSpot(points, preset.aimPoints, { aspectRatio })
      : groupSpread(points, { aspectRatio });

  const onTap = async (x: number, y: number) => {
    if (!round || !target || busy) return;
    setBusy(true);
    try {
      await addArrow(round, target, x, y);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onUndo = async () => {
    const last = arrows[arrows.length - 1];
    if (!last) return;
    await deleteArrow(last);
    setSelected(null);
    await load();
  };

  const onDeleteSelected = async () => {
    const mark = arrows.find((a) => a.id === selected);
    if (!mark) return;
    await deleteArrow(mark);
    setSelected(null);
    await load();
  };

  const onAddPhoto = async () => {
    if (!round) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera unavailable',
        'Grant camera access to photograph the target face. You can keep marking by hand without it.',
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    // Stored as a local URI only. Upload to S3 happens on sync, and the round
    // keeps working offline in the meantime.
    await attachLocalPhoto(round, result.assets[0].uri);
    await load();
  };

  const onNextRound = async () => {
    if (!round || !target) return;
    const session = await collections.sessions.find(sessionId);
    const next = await addRound(session, target.id);
    navigation.replace('Marking', { sessionId, roundId: next.id });
  };

  if (!round || !target) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.loading}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statRow}>
          <Stat
            label="Round score"
            value={String(total)}
            caption={
              arrows.length > 0 ? `of ${arrows.length * best} possible` : '—'
            }
            palette={palette}
          />
          <Stat
            label="Arrows"
            value={String(arrows.length)}
            caption={`board ${round.roundOrder}`}
            palette={palette}
          />
          <Stat
            label="Grouping"
            value={grouping === null ? '—' : `${(grouping * 100).toFixed(1)}%`}
            caption="of face width"
            palette={palette}
          />
        </View>

        <View style={styles.faceWrap}>
          <TargetFace
            zones={zones}
            marks={marks}
            photoUri={round.localPhotoUri}
            isPreset={target.type === 'preset'}
            aspectRatio={aspectRatio}
            selectedMarkId={selected}
            onTap={onTap}
            onMarkPress={(id) => setSelected(id === selected ? null : id)}
          />
        </View>

        <Text style={styles.hint}>
          {selected
            ? 'Tap the highlighted mark again to deselect, or remove it below.'
            : 'Tap where each arrow landed. Tap a mark to select it.'}
        </Text>

        <View style={styles.buttonRow}>
          <SecondaryButton
            label="Undo last"
            onPress={onUndo}
            disabled={arrows.length === 0}
            palette={palette}
          />
          <SecondaryButton
            label={selected ? 'Remove mark' : 'Photo'}
            onPress={selected ? onDeleteSelected : onAddPhoto}
            palette={palette}
          />
        </View>

        <View style={styles.buttonRow}>
          <SecondaryButton
            label="Next board"
            onPress={onNextRound}
            palette={palette}
          />
          <Pressable
            style={styles.primary}
            onPress={() =>
              navigation.replace('SessionDetail', { sessionId })
            }
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Finish session</Text>
          </Pressable>
        </View>

        {arrows.length > 0 ? (
          <View style={styles.scoreList}>
            <Text style={styles.scoreListTitle}>Marks</Text>
            <View style={styles.scoreChips}>
              {arrows.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setSelected(a.id === selected ? null : a.id)}
                  style={[
                    styles.scoreChip,
                    a.id === selected && styles.scoreChipActive,
                    a.isMiss && styles.scoreChipMiss,
                  ]}
                >
                  <Text
                    style={[
                      styles.scoreChipText,
                      a.id === selected && styles.scoreChipTextActive,
                    ]}
                  >
                    {a.isMiss ? 'M' : a.scoreValue}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  caption,
  palette,
}: {
  label: string;
  value: string;
  caption: string;
  palette: Palette;
}) {
  const styles = makeStyles(palette);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statCaption}>{caption}</Text>
    </View>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled,
  palette,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  palette: Palette;
}) {
  const styles = makeStyles(palette);
  return (
    <Pressable
      style={[styles.secondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.page },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    loading: { padding: spacing.lg, color: palette.textSecondary },
    statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    stat: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.sm,
    },
    statLabel: { fontSize: 11, color: palette.textSecondary },
    statValue: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    statCaption: { fontSize: 10, color: palette.textMuted },
    faceWrap: {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.sm,
      overflow: 'hidden',
    },
    hint: {
      fontSize: 12,
      color: palette.textMuted,
      textAlign: 'center',
      marginVertical: spacing.sm,
    },
    buttonRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    secondary: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    secondaryText: { color: palette.textPrimary, fontWeight: '600', fontSize: 14 },
    disabled: { opacity: 0.4 },
    primary: {
      flex: 1,
      backgroundColor: palette.series1,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    primaryText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
    scoreList: { marginTop: spacing.md },
    scoreListTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.textSecondary,
      marginBottom: spacing.sm,
    },
    scoreChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    scoreChip: {
      minWidth: 38,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: palette.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    scoreChipActive: {
      backgroundColor: palette.textPrimary,
      borderColor: palette.textPrimary,
    },
    scoreChipMiss: { borderColor: palette.critical },
    scoreChipText: {
      color: palette.textPrimary,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    scoreChipTextActive: { color: palette.surface },
  });
}
