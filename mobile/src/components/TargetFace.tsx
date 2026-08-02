/**
 * Renders a target face from its zone geometry and handles tap-to-mark.
 *
 * The face is drawn in a 0-1 viewBox and scaled by SVG, so this component
 * never converts coordinates itself beyond the single tap-to-normalized step.
 * That keeps exactly one place where a pixel becomes a normalized coordinate,
 * which is the conversion that would otherwise drift out of step with scoring.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 * 1. **Sizing never depends on layout callbacks.** Height comes from the
 *    `aspectRatio` style, and the tap math measures the container at press
 *    time. Both replaced onLayout-driven versions that worked in theory and
 *    left the face invisible (zero height) or untappable (0x0 cached size) in
 *    practice, because react-native-web does not reliably deliver onLayout
 *    for this view.
 *
 * 2. **Taps are handled by one Pressable container, not by `onPress` on SVG
 *    elements.** Per-element press handling in react-native-svg behaves
 *    differently on web and native, and the raw responder props don't fire at
 *    all through react-native-web. One Pressable plus a hit test against
 *    existing marks behaves identically everywhere. The tap position comes
 *    from `locationX` where the platform provides it (native) and falls back
 *    to `pageX` minus the container's own window offset (web).
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { GestureResponderEvent, Pressable, View } from 'react-native';
import Svg, {
  Circle,
  Ellipse,
  G,
  Image as SvgImage,
  Polygon,
  Rect,
} from 'react-native-svg';

import {
  CircleParams,
  EllipseParams,
  PolygonParams,
  RectangleParams,
} from '../scoring/geometry';
import { maxZoneScore, Zone } from '../scoring/scoring';
import { arrowMark, zoneColors } from '../theme';

export interface Mark {
  id: string;
  x: number;
  y: number;
  scoreValue: number;
}

interface Props {
  zones: Zone[];
  marks: Mark[];
  /** Optional photo of the real face, drawn under the zones. */
  photoUri?: string | null;
  isPreset?: boolean;
  /** faceWidth / faceHeight. Keeps a non-square face from being drawn square. */
  aspectRatio?: number;
  selectedMarkId?: string | null;
  onTap?: (x: number, y: number) => void;
  onMarkPress?: (markId: string) => void;
}

/** Mark radius in viewBox units. */
const MARK_RADIUS = 0.018;

/** Finger-sized target for selecting an existing mark, in pixels. */
const MARK_HIT_SLOP_PX = 22;

export default function TargetFace({
  zones,
  marks,
  photoUri,
  isPreset = true,
  aspectRatio = 1,
  selectedMarkId,
  onTap,
  onMarkPress,
}: Props) {
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const containerRef = useRef<View>(null);

  const maxScore = useMemo(() => maxZoneScore(zones), [zones]);

  // Zones arrive innermost-first for scoring, so they must be drawn in reverse
  // or the 10 ring would be painted over by the 1 ring.
  const paintOrder = useMemo(
    () => [...zones].sort((a, b) => b.zoneIndex - a.zoneIndex),
    [zones],
  );

  const placeMark = useCallback(
    (px: number, py: number, width: number, height: number) => {
      const x = px / width;
      const y = py / height;

      // A tap outside the face is a miss the archer meant to record; a tap
      // outside the view is a stray gesture. Only the latter is discarded.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;

      // Selecting an existing mark wins over adding a new one on top of it.
      if (onMarkPress) {
        for (const mark of marksRef.current) {
          const dx = (mark.x - x) * width;
          const dy = (mark.y - y) * height;
          if (Math.sqrt(dx * dx + dy * dy) <= MARK_HIT_SLOP_PX) {
            onMarkPress(mark.id);
            return;
          }
        }
      }

      onTap?.(x, y);
    },
    [onMarkPress, onTap],
  );

  /**
   * The container is measured at press time, not cached from onLayout —
   * react-native-web never delivers onLayout for this view, so a cached size
   * stays 0x0 forever and every tap would be discarded. measureInWindow works
   * on both platforms and also supplies the offset the web path needs, since
   * react-native-web leaves locationX undefined.
   */
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const { locationX, locationY, pageX, pageY } = event.nativeEvent;

      containerRef.current?.measureInWindow((left, top, width, height) => {
        if (!width || !height) return;

        const hasLocal =
          typeof locationX === 'number' && Number.isFinite(locationX);
        const px = hasLocal ? locationX : pageX - left;
        const py = hasLocal ? locationY : pageY - top;

        placeMark(px, py, width, height);
      });
    },
    [placeMark],
  );

  return (
    <Pressable
      ref={containerRef}
      style={{ width: '100%', aspectRatio }}
      onPress={handlePress}
      disabled={!onTap && !onMarkPress}
      accessibilityRole={onTap ? 'button' : 'image'}
      accessibilityLabel={
        onTap
          ? `Target face, ${marks.length} arrows marked. Tap to add a mark.`
          : `Target face with ${marks.length} arrow marks`
      }
    >
      {/* The drawing is inert: every pointer event belongs to the Pressable.
          Without this, react-native-svg's web elements take the click and the
          press handler never fires. */}
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        pointerEvents="none"
        style={{ pointerEvents: 'none' }}
      >
        {photoUri ? (
          <SvgImage
            x={0}
            y={0}
            width={1}
            height={1}
            href={{ uri: photoUri }}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : null}

        <G opacity={photoUri ? 0.55 : 1}>
          {paintOrder.map((zone) => (
            <ZoneShape
              key={zone.zoneIndex}
              zone={zone}
              maxScore={maxScore}
              isPreset={isPreset}
            />
          ))}
        </G>

        {marks.map((mark) => (
          <G key={mark.id}>
            <Circle
              cx={mark.x}
              cy={mark.y}
              r={MARK_RADIUS}
              // The contrasting ring is what keeps a mark readable whether it
              // lands on gold, black or white.
              fill={mark.scoreValue === 0 ? arrowMark.missFill : arrowMark.fill}
              stroke={arrowMark.stroke}
              strokeWidth={MARK_RADIUS * 0.35}
            />
            {mark.id === selectedMarkId ? (
              <Circle
                cx={mark.x}
                cy={mark.y}
                r={MARK_RADIUS * 2}
                fill="none"
                stroke={arrowMark.stroke}
                strokeWidth={MARK_RADIUS * 0.25}
              />
            ) : null}
          </G>
        ))}
      </Svg>
    </Pressable>
  );
}

function ZoneShape({
  zone,
  maxScore,
  isPreset,
}: {
  zone: Zone;
  maxScore: number;
  isPreset: boolean;
}) {
  const { fill, stroke } = zoneColors(zone.scoreValue, maxScore, isPreset);
  const strokeWidth = 0.0025;

  switch (zone.shapeType) {
    case 'circle': {
      const p = zone.shapeParams as CircleParams;
      return (
        <Circle
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }

    case 'ellipse': {
      const p = zone.shapeParams as EllipseParams;
      return (
        <Ellipse
          cx={p.cx}
          cy={p.cy}
          rx={p.rx}
          ry={p.ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          transform={p.rot ? `rotate(${p.rot} ${p.cx} ${p.cy})` : undefined}
        />
      );
    }

    case 'rectangle': {
      const p = zone.shapeParams as RectangleParams;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      return (
        <Rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          transform={p.rot ? `rotate(${p.rot} ${cx} ${cy})` : undefined}
        />
      );
    }

    case 'polygon': {
      const p = zone.shapeParams as PolygonParams;
      return (
        <Polygon
          points={p.points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }

    default:
      return null;
  }
}
