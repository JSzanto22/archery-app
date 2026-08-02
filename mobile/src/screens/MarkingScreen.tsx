/**
 * The screen the app exists for: tap the face where each arrow landed.
 *
 * Score and grouping update on every tap, computed here on the device from the
 * marks already in local state. Nothing waits on the network — the archer is
 * standing at a target, frequently with no signal.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import TargetFace, { Mark } from '../components/TargetFace';
import { Button, Screen } from '../components/ui';
import { Arrow, Round, Target, collections } from '../db';
import {
  addArrow,
  addRound,
  attachLocalPhoto,
  deleteArrow,
  moveArrow,
} from '../db/actions';
import { findPreset } from '../db/presets';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
import { Zone, maxZoneScore } from '../scoring/scoring';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';
import { formatDistance, useUnits } from '../units';

type Props = NativeStackScreenProps<RootStackParamList, 'Marking'>;

export default function MarkingScreen({ navigation, route }: Props) {
  const { sessionId, roundId } = route.params;
  const palette = usePalette();
  const { units } = useUnits();

  const [round, setRound] = useState<Round | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * Write re-entry guard. A ref, not state: `setBusy(true)` does not take
   * effect until the next render, so two writes dispatched in the same tick
   * would both read `busy === false` and both commit — the same stale-read
   * class of bug as the drag state.
   */
  const busyRef = useRef(false);

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
  const faceWidthCm = target?.faceWidthCm ?? preset?.faceWidthCm ?? null;

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

  const onPlace = async (x: number, y: number) => {
    if (!round || !target || busyRef.current) return;
    busyRef.current = true;
    try {
      await addArrow(round, target, x, y);
      await load();
    } finally {
      busyRef.current = false;
    }
  };

  const onMoveMark = async (markId: string, x: number, y: number) => {
    if (!target || busyRef.current) return;
    const mark = arrows.find((a) => a.id === markId);
    if (!mark) return;

    busyRef.current = true;
    try {
      // Score is re-resolved at the new position inside moveArrow.
      await moveArrow(mark, target, x, y);
      await load();
    } finally {
      busyRef.current = false;
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
      <Screen>
        <Text style={[type.body, { color: palette.textSecondary }]}>
          Loading…
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Three numbers, no card chrome — the stats speak for themselves. */}
      <View style={styles.statRow}>
        <Stat
          label="Round score"
          value={String(total)}
          caption={
            arrows.length > 0 ? `of ${arrows.length * best} possible` : '—'
          }
        />
        <Stat
          label="Arrows"
          value={String(arrows.length)}
          caption={`board ${round.roundOrder}`}
        />
        <Stat
          label="Grouping"
          value={
            grouping === null
              ? '—'
              : faceWidthCm
                ? formatDistance(grouping * faceWidthCm, units)
                : `${(grouping * 100).toFixed(1)}%`
          }
          caption={
            grouping !== null && faceWidthCm
              ? `${(grouping * 100).toFixed(1)}% of face`
              : 'spread from centre'
          }
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
          onPlace={onPlace}
          onMoveMark={onMoveMark}
          onSelectMark={setSelected}
        />
      </View>

      <Text style={[styles.hint, { color: palette.textMuted }]}>
        {selected
          ? 'Drag the selected mark to move it, or remove it below.'
          : 'Press and drag to aim — release to place. Tap a mark to select it.'}
      </Text>

      {/* Action hierarchy: one filled, one tonal, the rest text. */}
      <View style={styles.textActions}>
        <Button
          label="Undo last"
          variant="text"
          disabled={arrows.length === 0}
          onPress={onUndo}
        />
        <Button
          label={selected ? 'Remove mark' : 'Photo'}
          variant="text"
          onPress={selected ? onDeleteSelected : onAddPhoto}
        />
      </View>

      <View style={styles.mainActions}>
        <View style={styles.actionFlex}>
          <Button label="Next board" variant="tonal" block onPress={onNextRound} />
        </View>
        <View style={styles.actionFlex}>
          <Button
            label="Finish session"
            variant="filled"
            block
            onPress={() => navigation.replace('SessionDetail', { sessionId })}
          />
        </View>
      </View>

      {arrows.length > 0 ? (
        <View style={styles.scoreList}>
          <Text style={[type.label, { color: palette.textSecondary }]}>
            Marks
          </Text>
          <View style={styles.scoreChips}>
            {arrows.map((a) => {
              const isSelected = a.id === selected;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setSelected(isSelected ? null : a.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  hitSlop={4}
                  style={[
                    styles.scoreChip,
                    {
                      backgroundColor: isSelected
                        ? palette.accentTonal
                        : palette.surface,
                      borderColor: isSelected
                        ? 'transparent'
                        : a.isMiss
                          ? palette.critical
                          : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.scoreChipText,
                      {
                        color: isSelected
                          ? palette.onAccentTonal
                          : a.isMiss
                            ? palette.critical
                            : palette.textPrimary,
                      },
                    ]}
                  >
                    {a.isMiss ? 'M' : a.scoreValue}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Stat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.stat}>
      <Text style={[type.label, { color: palette.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, { color: palette.textPrimary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.statCaption, { color: palette.textMuted }]}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  stat: { flex: 1 },
  statValue: {
    ...type.display,
    fontSize: 28,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
  statCaption: { ...type.label, fontWeight: '400' },
  faceWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  hint: {
    ...type.label,
    fontWeight: '400',
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
  textActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  mainActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionFlex: { flex: 1 },
  scoreList: { marginTop: spacing.lg },
  scoreChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  scoreChip: {
    minWidth: 44,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  scoreChipText: {
    ...type.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
