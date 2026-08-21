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
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Palette, spacing, usePalette } from '../theme';

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
  /**
   * Range the measure can actually take. Axis headroom is clamped to it, so a
   * chart never labels an impossible value — a group spread of -0.7 cm or an
   * arrow averaging 10.12 on a ten-ring face both read as broken.
   */
  domain?: { min?: number; max?: number };
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
  domain,
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

    // Headroom must not invent values the measure cannot take. Without this a
    // tight group charts a negative spread and a good session charts an
    // average above the face's top ring.
    if (domain?.min !== undefined) min = Math.max(min, domain.min);
    if (domain?.max !== undefined) max = Math.min(max, domain.max);

    // Clamping both ends of a near-flat series can collapse the band again.
    if (max - min < Number.EPSILON) {
      max = min + 1;
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
  }, [domain?.max, domain?.min, height, points, width]);

  const path = useMemo(() => {
    if (!scale) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(p.t)},${scale.y(p.v)}`)
      .join(' ');
  }, [points, scale]);

  /**
   * The band of ordinary variation: one standard deviation either side of the
   * mean.
   *
   * This is the chart's whole argument. Dr James Park's analysis of score
   * variance — the same work that stopped grouping headlining this dashboard —
   * says a large part of what an archer sees between sessions is noise. A bare
   * line invites them to read a story into every bump. Drawing the band makes
   * the noise visible, so a point inside it reads as "that is just variance"
   * and a point outside it is worth thinking about.
   */
  const band = useMemo(() => {
    if (!scale || points.length < 3) return null;

    const values = points.map((p) => p.v);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    const sd = Math.sqrt(variance);

    if (!Number.isFinite(sd) || sd === 0) return null;

    // Clamped to the plot, so a band wider than the axis does not paint over
    // the title.
    const top = Math.max(PAD_TOP, scale.y(mean + sd));
    const bottom = Math.min(height - PAD_BOTTOM, scale.y(mean - sd));

    return { top, height: Math.max(0, bottom - top), mean: scale.y(mean) };
  }, [height, points, scale]);

  /** The line, closed down to the baseline so it can carry a fill. */
  const areaPath = useMemo(() => {
    if (!scale || points.length < 2 || path === '') return '';

    const firstPoint = points[0]!;
    const lastPoint = points[points.length - 1]!;
    const floor = height - PAD_BOTTOM;

    return `${path} L${scale.x(lastPoint.t)},${floor} L${scale.x(firstPoint.t)},${floor} Z`;
  }, [height, path, points, scale]);

  const last = points[points.length - 1];
  const first = points[0];

  const delta = first && last && points.length > 1 ? last.v - first.v : null;
  const improved =
    delta === null ? null : lowerIsBetter ? delta < 0 : delta > 0;

  const styles = makeStyles(palette);
  const active = selected !== null ? (points[selected] ?? null) : null;
  /** The point the footer describes: whichever is tapped, else the newest. */
  const shown = active ?? last ?? null;

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

            {/* Ordinary variation, drawn under everything else. */}
            {band && band.height > 0 ? (
              <>
                <Rect
                  x={PAD_LEFT}
                  y={band.top}
                  width={width - PAD_LEFT - PAD_RIGHT}
                  height={band.height}
                  fill={color}
                  opacity={0.07}
                />
                <Line
                  x1={PAD_LEFT}
                  y1={band.mean}
                  x2={width - PAD_RIGHT}
                  y2={band.mean}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.45}
                />
              </>
            ) : null}

            {/* Fill under the line: gives the series body without a second
                colour, and makes the direction of travel readable at a
                glance. */}
            {areaPath ? <Path d={areaPath} fill={color} opacity={0.1} /> : null}

            <Path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/*
              Only the latest point and the tapped one carry a dot. A circle on
              every point is fourteen marks competing with the line they sit on,
              and the tap targets are full-height columns regardless.
            */}
            {points.map((p, i) => {
              const isLast = i === points.length - 1;
              const isSelected = i === selected;
              if (!isLast && !isSelected) return null;

              return (
                <React.Fragment key={`${p.t}-${i}`}>
                  {isLast && selected === null ? (
                    <Circle
                      cx={scale.x(p.t)}
                      cy={scale.y(p.v)}
                      r={9}
                      fill={color}
                      opacity={0.18}
                    />
                  ) : null}
                  <Circle
                    cx={scale.x(p.t)}
                    cy={scale.y(p.v)}
                    r={isSelected ? 6 : 4.5}
                    fill={isSelected ? palette.surface : color}
                    stroke={color}
                    strokeWidth={2}
                  />
                </React.Fragment>
              );
            })}
          </Svg>

          {/* Axis extremes and the direct label for the latest value. */}
          <View style={styles.axisRow} pointerEvents="none">
            <Text style={styles.axisText}>{format(scale.min)}</Text>
            <Text style={styles.axisText}>{format(scale.max)}</Text>
          </View>

          {/*
            The band is meaningless without saying what it is. An unexplained
            shaded area is decoration, and this one is carrying an argument.
          */}
          {band && band.height > 0 ? (
            <Text style={styles.bandNote}>
              Shaded band is your usual spread. Inside it is normal variation.
            </Text>
          ) : null}

          {shown ? (
            <View style={styles.footer}>
              <Text style={styles.footerLabel}>
                {active ? active.label : `Latest · ${shown.label}`}
              </Text>
              <Text
                style={[styles.footerValue, { color: palette.textPrimary }]}
              >
                {format(shown.v)}
              </Text>
            </View>
          ) : null}

          {/* Tap targets are full-height columns, far bigger than the 3px dots. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={styles.hitRow} pointerEvents="box-none">
              {points.map((point, i) => (
                <Pressable
                  key={`${point.t}-${i}`}
                  style={styles.hitCell}
                  onPress={() => setSelected(selected === i ? null : i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${point.label}, ${format(point.v)}`}
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
    /*
     * Deliberately not a card.
     *
     * A chart is already a bounded object — it has an axis, a title and a
     * shape. Putting a border round it boxes something that was never in
     * danger of leaking, and two boxed charts stacked under a boxed hero and a
     * row of boxed tiles is a screen made entirely of containers. The title
     * and the space above it separate this from what precedes it.
     */
    card: {
      paddingVertical: spacing.sm,
      marginBottom: spacing.lg,
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
    bandNote: {
      color: palette.textMuted,
      fontSize: 11,
      lineHeight: 15,
      marginTop: spacing.xs,
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
