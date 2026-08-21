/**
 * The handicap, given the room it deserves.
 *
 * It used to be one of six tiles, all rendering their figure at the same size
 * and weight — so the number that answers "am I getting better?" carried
 * exactly as much visual weight as the word "centred". A dashboard where
 * everything is emphasised has no emphasis.
 *
 * This is the one hero on the screen. Everything else steps down from it.
 *
 * The direction of travel is spelled out rather than shown as a signed number,
 * because a handicap improves by going *down* and a green "-5" reads as a loss
 * to anyone who has not internalised that. "Down from 32" cannot be
 * misread, and the arrow and colour agree with the words rather than carrying
 * the meaning alone.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../theme';

interface Props {
  /** Null until a full round has been shot. */
  handicap: number | null;
  /** Change against the previous qualifying shoot. Negative is better. */
  change: number | null;
  /** The round the current handicap came from. */
  roundName: string | null;
  /** Best handicap ever recorded, and where. */
  best: { handicap: number; roundName: string } | null;
}

export default function HandicapHero({
  handicap,
  change,
  roundName,
  best,
}: Props) {
  const palette = usePalette();

  const improved = change !== null && change < 0;
  const worsened = change !== null && change > 0;

  const trendColour = improved
    ? palette.good
    : worsened
      ? palette.critical
      : palette.textMuted;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[type.label, { color: palette.textMuted }]}>HANDICAP</Text>

      <View style={styles.figureRow}>
        <Text
          style={[type.hero, styles.figure, { color: palette.textPrimary }]}
          accessibilityLabel={
            handicap === null
              ? 'No handicap yet'
              : `Handicap ${handicap}${
                  improved
                    ? `, down from ${handicap - change}`
                    : worsened
                      ? `, up from ${handicap - change}`
                      : ''
                }`
          }
        >
          {handicap === null ? '—' : handicap}
        </Text>
      </View>

      {/*
        The sentence carries the trend on its own.
        
        There was an arrow-and-number chip beside the figure as well, saying
        the same thing in a weaker form: it needed colour to mean anything,
        and colour is the one signal that fails in bright sun and for a
        colour-blind archer. Two ways of saying "down five" is one too many,
        and the one that survives should be the one that cannot be misread.
      */}
      <Text style={[type.body, { color: trendColour }]}>
        {handicap === null
          ? 'Shoot a full round and this is the number your club uses.'
          : change === null
            ? `First full round — ${roundName ?? 'recorded'}.`
            : improved
              ? `Down from ${handicap - change}. Lower is better.`
              : worsened
                ? `Up from ${handicap - change}.`
                : 'Unchanged since your last round.'}
      </Text>

      {best ? (
        <View style={[styles.bestRow, { borderTopColor: palette.gridline }]}>
          <Text style={[type.label, { color: palette.textMuted }]}>BEST</Text>
          <Text style={[type.body, { color: palette.textPrimary }]}>
            {best.handicap}
          </Text>
          <Text
            style={[type.label, styles.bestWhere, { color: palette.textMuted }]}
          >
            {best.roundName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  figureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  figure: { fontVariant: ['tabular-nums'] },
  bestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  bestWhere: { flex: 1, fontWeight: '400', letterSpacing: 0 },
});
