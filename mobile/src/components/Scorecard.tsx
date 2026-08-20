/**
 * The scorecard, laid out the way paper is.
 *
 * Recognition is the whole point. An archer has filled in hundreds of these,
 * and the conventions are not arbitrary — each one earns its place:
 *
 * - **Arrows descending within an end.** 10, 9, 8, never the order they were
 *   shot. It makes an end's total checkable at a glance and it is what the
 *   person scoring next to you will write.
 * - **A running total.** The number an archer actually watches during a shoot,
 *   and the one they compare against the last time.
 * - **X in its own column.** Xs are worth ten points like any other 10; they
 *   are counted separately because ties are decided on them.
 *
 * The plot stays as the richer record behind this. It is a better input and a
 * worse output: nobody checks a group cloud against the sheet on the wall.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, type, usePalette } from '../theme';

export interface ScorecardEnd {
  /** Ends are numbered from 1, as they are on paper. */
  number: number;
  /** Every arrow's value, in the order shot. Sorted for display. */
  scores: number[];
  /** Xs in this end. */
  innerTens: number;
}

interface Props {
  ends: ScorecardEnd[];
  /** Widest end in the round, so every row has the same number of cells. */
  arrowsPerEnd: number;
  /** Omitted for faces with no X ring — see scoring/innerTen.ts. */
  showInnerTens?: boolean;
}

/** A miss is written M, never 0 — the convention on every scoresheet. */
function cell(score: number | undefined): string {
  if (score === undefined) return '';
  return score === 0 ? 'M' : String(score);
}

export default function Scorecard({
  ends,
  arrowsPerEnd,
  showInnerTens = true,
}: Props) {
  const palette = usePalette();

  let running = 0;
  const rows = ends.map((end) => {
    // Highest first. The array is the order they were shot; the card is not.
    const sorted = [...end.scores].sort((a, b) => b - a);
    const endTotal = sorted.reduce((sum, score) => sum + score, 0);
    running += endTotal;

    return { end, sorted, endTotal, running };
  });

  const totalScore = running;
  const totalInnerTens = ends.reduce((sum, end) => sum + end.innerTens, 0);
  const totalArrows = ends.reduce((sum, end) => sum + end.scores.length, 0);

  const columns = Math.max(arrowsPerEnd, 1);

  return (
    <View style={styles.wrap}>
      {/*
        Horizontally scrollable on its own: a six-arrow end plus totals is
        wider than a small phone, and the alternative is shrinking the digits
        an archer is trying to read in sunlight.
      */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View
            style={[
              styles.row,
              styles.headerRow,
              { borderColor: palette.border },
            ]}
          >
            <Text
              style={[
                styles.head,
                styles.endCell,
                { color: palette.textMuted },
              ]}
            >
              END
            </Text>
            {Array.from({ length: columns }, (_, i) => (
              <Text
                key={i}
                style={[styles.head, styles.cell, { color: palette.textMuted }]}
              >
                {i + 1}
              </Text>
            ))}
            <Text
              style={[
                styles.head,
                styles.totalCell,
                { color: palette.textMuted },
              ]}
            >
              END
            </Text>
            <Text
              style={[
                styles.head,
                styles.totalCell,
                { color: palette.textMuted },
              ]}
            >
              TOT
            </Text>
            {showInnerTens ? (
              <Text
                style={[
                  styles.head,
                  styles.xCell,
                  { color: palette.textMuted },
                ]}
              >
                X
              </Text>
            ) : null}
          </View>

          {rows.map(({ end, sorted, endTotal, running: runningTotal }) => (
            <View
              key={end.number}
              style={[styles.row, { borderColor: palette.gridline }]}
            >
              <Text
                style={[
                  styles.body,
                  styles.endCell,
                  { color: palette.textMuted },
                ]}
              >
                {end.number}
              </Text>
              {Array.from({ length: columns }, (_, i) => (
                <Text
                  key={i}
                  style={[
                    styles.body,
                    styles.cell,
                    { color: palette.textPrimary },
                  ]}
                >
                  {cell(sorted[i])}
                </Text>
              ))}
              <Text
                style={[
                  styles.body,
                  styles.totalCell,
                  { color: palette.textPrimary },
                ]}
              >
                {endTotal}
              </Text>
              <Text
                style={[
                  styles.body,
                  styles.totalCell,
                  styles.running,
                  { color: palette.textPrimary },
                ]}
              >
                {runningTotal}
              </Text>
              {showInnerTens ? (
                <Text
                  style={[
                    styles.body,
                    styles.xCell,
                    { color: palette.accentText },
                  ]}
                >
                  {end.innerTens > 0 ? end.innerTens : ''}
                </Text>
              ) : null}
            </View>
          ))}

          <View
            style={[
              styles.row,
              styles.totalRow,
              { borderColor: palette.textPrimary },
            ]}
          >
            <Text
              style={[
                styles.body,
                styles.endCell,
                { color: palette.textMuted },
              ]}
            >
              ∑
            </Text>
            {Array.from({ length: columns }, (_, i) => (
              <Text key={i} style={[styles.body, styles.cell]} />
            ))}
            <Text
              style={[
                styles.body,
                styles.totalCell,
                { color: palette.textMuted },
              ]}
            >
              {totalArrows}
            </Text>
            <Text
              style={[
                styles.body,
                styles.totalCell,
                styles.running,
                { color: palette.textPrimary },
              ]}
            >
              {totalScore}
            </Text>
            {showInnerTens ? (
              <Text
                style={[
                  styles.body,
                  styles.xCell,
                  styles.running,
                  { color: palette.accentText },
                ]}
              >
                {totalInnerTens}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const CELL = 34;

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, borderRadius: radius.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
  },
  headerRow: { borderBottomWidth: 1 },
  totalRow: { borderBottomWidth: 0, borderTopWidth: 1, marginTop: 2 },
  head: {
    ...type.label,
    fontSize: 10,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  body: {
    ...type.body,
    // Digits must line up between rows or the column stops being scannable,
    // which is the only reason to lay a scorecard out as a grid at all.
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  running: { fontFamily: fonts.heading },
  endCell: { width: 30 },
  cell: { width: CELL },
  totalCell: { width: 42 },
  xCell: { width: 30 },
});
