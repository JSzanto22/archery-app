/**
 * The screen the app exists for: mark where each arrow landed.
 *
 * Score and grouping update on every mark, computed here on the device from
 * local state. Nothing waits on the network — the archer is standing at a
 * target, frequently with no signal.
 *
 * Three rules govern this screen, all of them learned the hard way:
 *
 * 1. **No input is ever dropped.** Writes are serialised through a queue, not
 *    gated behind a busy flag. Six arrows tapped in quick succession between
 *    ends must all land; refusing the second tap silently is the worst
 *    possible failure here, because the archer has no way to notice.
 * 2. **No failure is ever silent.** Every write and the initial load report
 *    into the banner. A mark that did not save must not look identical to one
 *    that did.
 * 3. **Destructive actions stand alone.** Delete never shares a control with a
 *    benign action, and is always undoable — cold hands and bright sun make
 *    mis-taps routine.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import TargetFace, { Mark } from '../components/TargetFace';
import { Banner, Button, Screen } from '../components/ui';
import { Arrow, Round, Target, collections } from '../db';
import {
  RestorableArrow,
  addArrow,
  addRound,
  attachLocalPhoto,
  deleteArrow,
  moveArrow,
  restoreArrow,
  toRestorable,
} from '../db/actions';
import { findPreset } from '../db/presets';
import { WriteQueue, createWriteQueue } from '../lib/writeQueue';
import { groupSpread, groupSpreadMultiSpot } from '../scoring/grouping';
import { Zone, maxZoneScore } from '../scoring/scoring';
import { RootStackParamList } from '../navigation';
import { radius, spacing, type, usePalette } from '../theme';
import { formatDistance, useUnits } from '../units';

type Props = NativeStackScreenProps<RootStackParamList, 'Marking'>;

interface UndoOffer {
  arrow: RestorableArrow;
  label: string;
}

export default function MarkingScreen({ navigation, route }: Props) {
  const { sessionId, roundId } = route.params;
  const palette = usePalette();
  const { units } = useUnits();

  const [round, setRound] = useState<Round | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null);

  /**
   * Serialises writes without discarding any. See lib/writeQueue.ts for why a
   * queue rather than a busy flag.
   */
  const queueRef = useRef<WriteQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createWriteQueue({
      onError: (message, error) => {
        console.error('[marking]', message, error);
        setWriteError(message);
      },
    });
  }

  const enqueue = useCallback(
    (run: () => Promise<void>, failureMessage: string) =>
      queueRef.current!.push({ run, failureMessage }),
    [],
  );

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const loadedRound = await collections.rounds.find(roundId);
      const loadedTarget = await collections.targets.find(loadedRound.targetId);
      const loadedZones = await loadedTarget.toScoringZones();
      const loadedArrows = await loadedRound.orderedArrows.fetch();

      setRound(loadedRound);
      setTarget(loadedTarget);
      setZones(loadedZones);
      setArrows(loadedArrows);
    } catch (error) {
      // Without this the screen sits on "Loading…" forever with no way out.
      console.error('[marking] failed to load end', error);
      setLoadError("This end could not be opened. It may have been deleted.");
    }
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

  const selectedArrow = arrows.find((a) => a.id === selected) ?? null;

  const onPlace = useCallback(
    (x: number, y: number) => {
      if (!round || !target) return;

      setUndoOffer(null);
      enqueue(async () => {
        const created = await addArrow(round, target, x, y);
        // Append rather than refetch the whole end: a full reload per arrow is
        // what made rapid entry slow enough to need the guard in the first place.
        setArrows((prev) => [...prev, created]);
      }, 'That arrow did not save. Tap the face again.');
    },
    [enqueue, round, target],
  );

  const onMoveMark = useCallback(
    (markId: string, x: number, y: number) => {
      if (!target) return;

      enqueue(async () => {
        const mark = arrows.find((a) => a.id === markId);
        if (!mark) return;

        // Score is re-resolved at the new position inside moveArrow.
        await moveArrow(mark, target, x, y);
        // The model instance mutated in place; a new array reference is what
        // tells React the derived marks changed.
        setArrows((prev) => [...prev]);
      }, 'That mark could not be moved.');
    },
    [arrows, enqueue, target],
  );

  const removeArrow = useCallback(
    (mark: Arrow, label: string) => {
      const restorable = toRestorable(mark);

      enqueue(async () => {
        await deleteArrow(mark);
        setArrows((prev) => prev.filter((a) => a.id !== mark.id));
        setSelected(null);
        setUndoOffer({ arrow: restorable, label });
      }, 'That mark could not be removed.');
    },
    [enqueue],
  );

  const onUndoDelete = useCallback(() => {
    if (!round || !undoOffer) return;
    const offer = undoOffer;
    setUndoOffer(null);

    enqueue(async () => {
      const restored = await restoreArrow(round, offer.arrow);
      setArrows((prev) =>
        [...prev, restored].sort(
          (a, b) => (a.shotOrder ?? 0) - (b.shotOrder ?? 0),
        ),
      );
    }, 'That mark could not be restored.');
  }, [enqueue, round, undoOffer]);

  const onAddPhoto = useCallback(async () => {
    if (!round) return;

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setWriteError(
          'Camera access is off. You can keep marking by hand without it.',
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled || !result.assets[0]) return;

      // Stored as a local URI only. Upload to S3 happens on sync, and the end
      // keeps working offline in the meantime.
      await attachLocalPhoto(round, result.assets[0].uri);
      setRound(round);
      setArrows((prev) => [...prev]);
    } catch (error) {
      console.error('[marking] photo failed', error);
      setWriteError('The camera could not be opened.');
    }
  }, [round]);

  const onNextEnd = useCallback(async () => {
    if (!round || !target) return;

    try {
      const session = await collections.sessions.find(sessionId);
      const next = await addRound(session, target.id);
      navigation.replace('Marking', { sessionId, roundId: next.id });
    } catch (error) {
      console.error('[marking] failed to start next end', error);
      setWriteError('A new end could not be started.');
    }
  }, [navigation, round, sessionId, target]);

  if (loadError) {
    return (
      <Screen>
        <Banner
          tone="error"
          message={loadError}
          actionLabel="Retry"
          onAction={load}
        />
        <Button
          label="Back to session"
          variant="tonal"
          block
          onPress={() => navigation.replace('SessionDetail', { sessionId })}
        />
      </Screen>
    );
  }

  if (!round || !target) {
    return (
      <Screen>
        <View style={styles.statRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.stat}>
              <View
                style={[styles.skelLabel, { backgroundColor: palette.gridline }]}
              />
              <View
                style={[styles.skelValue, { backgroundColor: palette.gridline }]}
              />
            </View>
          ))}
        </View>
        <View
          style={[styles.skelFace, { backgroundColor: palette.gridline }]}
          accessibilityLabel="Loading end"
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {writeError ? (
        <Banner
          tone="error"
          message={writeError}
          onDismiss={() => setWriteError(null)}
        />
      ) : null}

      {undoOffer ? (
        <Banner
          tone="info"
          message={undoOffer.label}
          actionLabel="Undo"
          onAction={onUndoDelete}
          onDismiss={() => setUndoOffer(null)}
        />
      ) : null}

      {/* Three numbers, no card chrome — the stats speak for themselves. */}
      <View style={styles.statRow}>
        <Stat
          label="End score"
          value={String(total)}
          caption={
            arrows.length > 0 ? `of ${arrows.length * best} possible` : '—'
          }
        />
        <Stat
          label="Arrows"
          value={String(arrows.length)}
          caption={`end ${round.roundOrder}`}
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

      {/*
        The selection toolbar is the ONLY place delete appears. It replaces
        nothing — the standing actions below keep their labels and meanings at
        all times, so reaching for "Photo" can never destroy an arrow.
      */}
      {selectedArrow ? (
        <View
          style={[
            styles.selectionBar,
            {
              borderColor: palette.accentBorder,
              backgroundColor: palette.surface,
            },
          ]}
        >
          <Text style={[styles.selectionText, { color: palette.textPrimary }]}>
            Arrow {selectedArrow.shotOrder ?? '—'} ·{' '}
            {selectedArrow.isMiss ? 'miss' : selectedArrow.scoreValue}
          </Text>
          <View style={styles.selectionActions}>
            <Button
              label="Deselect"
              variant="text"
              onPress={() => setSelected(null)}
            />
            <Button
              label="Delete"
              variant="tonal"
              onPress={() =>
                removeArrow(
                  selectedArrow,
                  `Arrow ${selectedArrow.shotOrder ?? ''} removed.`.replace(
                    '  ',
                    ' ',
                  ),
                )
              }
            />
          </View>
        </View>
      ) : (
        <Text style={[styles.hint, { color: palette.textMuted }]}>
          Press and drag to aim — release to place. Tap a mark to select it.
        </Text>
      )}

      <View style={styles.textActions}>
        <Button
          label="Undo last"
          variant="text"
          disabled={arrows.length === 0}
          onPress={() => {
            const last = arrows[arrows.length - 1];
            if (last) removeArrow(last, 'Last arrow removed.');
          }}
        />
        <Button label="Photo" variant="text" onPress={onAddPhoto} />
      </View>

      <View style={styles.mainActions}>
        <View style={styles.actionFlex}>
          <Button label="Next end" variant="tonal" block onPress={onNextEnd} />
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
                  accessibilityLabel={`Arrow ${a.shotOrder ?? ''}, ${
                    a.isMiss ? 'miss' : a.scoreValue
                  }`}
                  accessibilityState={{ selected: isSelected }}
                  style={[
                    styles.scoreChip,
                    {
                      backgroundColor: isSelected
                        ? palette.accentTonal
                        : palette.surface,
                      borderColor: isSelected
                        ? palette.accentBorder
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
    minHeight: 48,
    paddingTop: spacing.md,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    marginVertical: spacing.sm,
  },
  selectionText: { ...type.body, fontWeight: '600' },
  selectionActions: { flexDirection: 'row', alignItems: 'center' },
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
    // 48dp: the minimum that survives gloves and cold hands.
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  scoreChipText: {
    ...type.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  skelLabel: { height: 10, width: '60%', borderRadius: radius.sm },
  skelValue: {
    height: 28,
    width: '80%',
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  skelFace: { width: '100%', aspectRatio: 1, borderRadius: radius.lg },
});
