/**
 * Single-series trend line.
 *
 * Deliberately one series per chart. Score and grouping are different measures
 * on different scales, and putting them on a shared axis would be a dual-axis
 * chart — the one construction guaranteed to mislead, since the crossing point
 * of the two lines is an artefact of the scales chosen rather than anything in
 * the data. Two charts, stacked, is the honest form.
 *
 * With one series there is no legend: the title names the line. The last value
 * is direct-labelled; the rest are reachable by tapping, because a number on
 * every point is noise.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Palette, radius, spacing, usePalette } from '../theme';

export interface TrendPoint {
  /** X position, typically a timestamp. */
  t: number;
  v: number;
  label: string;
}

interface Props {
  title: string;
  points: TrendPoint[];
  color: string;
  /** Formats a value for the axis and the direct label. */
  format: (v: number) => string;
  /** True when a smaller number is the better one, as with grouping. */
  lowerIsBetter?: boolean;
  height?: number;
}

const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

export default function TrendChart({
  title,
  points,
  color,
  format,
  lowerIsBetter = false,
  height = 160,
}: Props) {
  const palette = usePalette();
  const [measured, setMeasured] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Width falls back to the window minus the screen's horizontal padding.
   *
   * Relying on `onLayout` alone left the chart at zero width, which made the
   * scale null and dropped every chart into the "not enough data" branch — so
   * the trends silently never drew, even with fourteen sessions loaded. A
   * layout pass that never arrives must not be indistinguishable from having
   * no data.
   */
  const width = measured || Math.max(0, windowWidth - spacing.md * 2);

  const scale = useMemo(() => {
    if (points.length === 0 || width === 0) return null;

    const values = points.map((p) => p.v);
    let min = Math.min(...values);
    let max = Math.max(...values);

    // A flat series would collapse to a zero-height band and divide by zero.
    if (min === max) {
      min -= Math.abs(min) * 0.1 || 1;
      max += Math.abs(max) * 0.1 || 1;
    } else {
      const headroom = (max - min) * 0.12;
      min -= headroom;
      max += headroom;
    }

    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;

    const xs = points.map((p) => p.t);
    const tMin = Math.min(...xs);
    const tMax = Math.max(...xs);
    const tSpan = tMax - tMin || 1;

    return {
      x: (t: number) => PAD_LEFT + ((t - tMin) / tSpan) * plotW,
      y: (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * plotH,
      min,
      max,
    };
  }, [height, points, width]);

  const path = useMemo(() => {
    if (!scale) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(p.t)},${scale.y(p.v)}`)
      .join(' ');
  }, [points, scale]);

  const last = points[points.length - 1];
  const first = points[0];

  const delta = first && last && points.length > 1 ? last.v - first.v : null;
  const improved =
    delta === null ? null : lowerIsBetter ? delta < 0 : delta > 0;

  const styles = makeStyles(palette);
  const active = selected !== null ? points[selected] : null;

  return (
    <View
      style={styles.card}
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {delta !== null ? (
          <Text
            style={[
              styles.delta,
              { color: improved ? palette.good : palette.textSecondary },
            ]}
          >
            {improved ? '▲' : '▼'} {format(Math.abs(delta))}
          </Text>
        ) : null}
      </View>

      {points.length < 2 ? (
        <View style={[styles.empty, { height }]}>
          <Text style={styles.emptyText}>
            {points.length === 0
              ? 'No sessions in this range yet.'
              : 'One session so far — a trend needs at least two.'}
          </Text>
        </View>
      ) : !scale ? (
        // Measuring. Reserve the space rather than claim there is no data.
        <View style={[styles.empty, { height }]} />
      ) : (
        <>
          <Svg width={width} height={height}>
            {/* Recessive gridlines: three hairlines, no box, no ticks. */}
            {[0, 0.5, 1].map((f) => {
              const y = PAD_TOP + f * (height - PAD_TOP - PAD_BOTTOM);
              return (
                <Line
                  key={f}
                  x1={PAD_LEFT}
                  y1={y}
                  x2={width - PAD_RIGHT}
                  y2={y}
                  stroke={palette.gridline}
                  strokeWidth={1}
                />
              );
            })}

            <Path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {points.map((p, i) => (
              <Circle
                key={`${p.t}-${i}`}
                cx={scale.x(p.t)}
                cy={scale.y(p.v)}
                r={i === selected ? 6 : 3}
                fill={i === selected ? color : palette.surface}
                stroke={color}
                strokeWidth={2}
              />
            ))}
          </Svg>

          {/* Axis extremes and the direct label for the latest value. */}
          <View style={styles.axisRow} pointerEvents="none">
            <Text style={styles.axisText}>{format(scale.min)}</Text>
            <Text style={styles.axisText}>{format(scale.max)}</Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>
              {active ? active.label : `Latest · ${last.label}`}
            </Text>
            <Text style={[styles.footerValue, { color: palette.textPrimary }]}>
              {format(active ? active.v : last.v)}
            </Text>
          </View>

          {/* Tap targets are full-height columns, far bigger than the 3px dots. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={styles.hitRow} pointerEvents="box-none">
              {points.map((_, i) => (
                <Pressable
                  key={i}
                  style={styles.hitCell}
                  onPress={() => setSelected(selected === i ? null : i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${points[i].label}, ${format(points[i].v)}`}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    title: {
      color: palette.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    delta: {
      fontSize: 13,
      fontVariant: ['tabular-nums'],
    },
    axisRow: {
      position: 'absolute',
      left: spacing.md,
      top: spacing.md + 26,
      height: 120,
      justifyContent: 'space-between',
    },
    axisText: {
      color: palette.textMuted,
      fontSize: 11,
      fontVariant: ['tabular-nums'],
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: spacing.xs,
    },
    footerLabel: {
      color: palette.textSecondary,
      fontSize: 12,
    },
    footerValue: {
      fontSize: 15,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    hitRow: {
      flexDirection: 'row',
      marginLeft: PAD_LEFT,
      marginRight: PAD_RIGHT,
      marginTop: 40,
      height: 140,
    },
    hitCell: {
      flex: 1,
    },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: palette.textMuted,
      fontSize: 13,
      textAlign: 'center',
    },
  });
}
