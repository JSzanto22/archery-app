/**
 * Renders a target face from its zone geometry and owns the marking gesture.
 *
 * ## The interaction model
 *
 * Borrowed from how annotation tools (Figma, Excalidraw, Slides) and mobile
 * text selection actually behave, adapted to point marks:
 *
 * - **Press and drag to aim, release to place.** From the moment of touch a
 *   preview mark, a magnifier loupe, and a live score readout follow the
 *   finger. The loupe sits offset above the touch so the finger never hides
 *   the point being aimed — the classic fat-finger fix. A plain tap still
 *   places instantly (coarse entry stays fast; the drag is the precision
 *   path).
 * - **Tap an existing mark to select it.** Selection shows a halo ring.
 *   Tapping empty space while a mark is selected deselects it — it does NOT
 *   place (the Figma/Excalidraw convention; without it, "tap away to
 *   deselect" spawns an unwanted arrow).
 * - **Drag an existing mark to move it** — same loupe, same live score; the
 *   score is re-resolved on release. The grab keeps its offset, so a mark
 *   picked up by its edge doesn't teleport under the fingertip.
 * - Deletion is the caller's affair (a selected mark's Remove action).
 *
 * Gestures use react-native-gesture-handler's Pan, which delivers
 * view-relative coordinates on both native and web — the raw responder props
 * never fire through react-native-web, which is why this file must not go
 * back to onStartShouldSetResponder.
 *
 * All geometry is normalized 0-1; exactly one place (this file) converts
 * pixels to normalized coordinates.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, {
  Circle,
  Ellipse,
  G,
  Image as SvgImage,
  Line,
  Polygon,
  Rect,
} from 'react-native-svg';

import {
  CircleParams,
  EllipseParams,
  PolygonParams,
  RectangleParams,
} from '../scoring/geometry';
import { maxZoneScore, scoreArrow, Zone } from '../scoring/scoring';
import { arrowMark, fonts, radius, usePalette, zoneColors } from '../theme';
import {
  DragState,
  beginDrag,
  finishDrag,
  updateDrag,
} from './markingGesture';

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
  /**
   * Scatter mode: many small translucent dots instead of full marks. For
   * showing hundreds of arrows at once, where full-sized marks would merge
   * into a solid blob and hide the very shape being looked at.
   */
  dense?: boolean;
  /** Draw a crosshair at the group's centre — where the sight is actually pointing. */
  centroid?: { x: number; y: number } | null;
  /** Commit a new mark. Absent = read-only rendering. */
  onPlace?: (x: number, y: number) => void;
  /** Commit a moved mark. */
  onMoveMark?: (markId: string, x: number, y: number) => void;
  /** Toggle selection of an existing mark (null clears). */
  onSelectMark?: (markId: string | null) => void;
}

/** Mark radius in viewBox units. */
const MARK_RADIUS = 0.018;

/** Loupe: rendered size (px), and the slice of face it magnifies (0-1). */
const LOUPE_SIZE = 104;
const LOUPE_REGION = 0.16;
/** Loupe floats this far above the touch so the finger never covers it. */
const LOUPE_LIFT = 76;

export default function TargetFace({
  zones,
  marks,
  photoUri,
  isPreset = true,
  aspectRatio = 1,
  selectedMarkId,
  dense = false,
  centroid = null,
  onPlace,
  onMoveMark,
  onSelectMark,
}: Props) {
  const palette = usePalette();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const containerRef = useRef<View>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const marksRef = useRef(marks);
  marksRef.current = marks;

  /**
   * The ref — not the state — is the live drag.
   *
   * Gesture callbacks fire far faster than React re-renders, so a ref that is
   * only refreshed during render (`dragRef.current = drag`) hands every
   * callback a value lagging the pointer: the release then commits stale
   * coordinates, and a stale `moved` flag routes a real drag into the tap
   * branch. Both reported bugs came from that. `writeDrag` updates the ref
   * synchronously and the state purely so the loupe re-renders.
   */
  const dragRef = useRef<DragState | null>(null);

  const writeDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const interactive = Boolean(onPlace || onMoveMark || onSelectMark);

  const maxScore = useMemo(() => maxZoneScore(zones), [zones]);

  // Zones arrive innermost-first for scoring, so they must be drawn in reverse
  // or the 10 ring would be painted over by the 1 ring.
  const paintOrder = useMemo(
    () => [...zones].sort((a, b) => b.zoneIndex - a.zoneIndex),
    [zones],
  );

  /**
   * Dimensions are measured on demand, never trusted from onLayout —
   * react-native-web does not reliably deliver onLayout for this view (the
   * pre-gesture implementation shipped a 0x0 cached size and every tap was
   * silently discarded).
   */
  const measure = useCallback(() => {
    containerRef.current?.measureInWindow((_l, _t, w, h) => {
      if (w && h) setSize({ w, h });
    });
  }, []);

  const begin = useCallback(
    (px: number, py: number) => {
      writeDrag(
        beginDrag(px, py, sizeRef.current, marksRef.current, {
          canPlace: Boolean(onPlace || onSelectMark),
        }),
      );
    },
    [onPlace, onSelectMark, writeDrag],
  );

  const update = useCallback(
    (fingerPx: number, fingerPy: number) => {
      const current = dragRef.current;
      if (!current) return;
      writeDrag(updateDrag(current, fingerPx, fingerPy, sizeRef.current));
    },
    [writeDrag],
  );

  const finish = useCallback(() => {
    // Claim the drag synchronously before committing: if the platform ever
    // delivers a second end event for one gesture, the second call sees null
    // and returns `none` instead of placing a duplicate arrow.
    const current = dragRef.current;
    writeDrag(null);

    const intent = finishDrag(current, selectedMarkId);

    switch (intent.type) {
      case 'place':
        onPlace?.(intent.x, intent.y);
        break;
      case 'move':
        onMoveMark?.(intent.markId, intent.x, intent.y);
        break;
      case 'select':
        onSelectMark?.(intent.markId);
        break;
      case 'none':
        break;
    }
  }, [onMoveMark, onPlace, onSelectMark, selectedMarkId, writeDrag]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactive)
        .runOnJS(true)
        .minDistance(0)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          measure();
          begin(e.x, e.y);
        })
        .onUpdate((e) => update(e.x, e.y))
        .onEnd(() => finish())
        .onFinalize((_e, success) => {
          // A cancelled gesture (scroll stole it, pointer left) discards the
          // preview rather than committing a mark nobody aimed.
          if (!success) writeDrag(null);
        }),
    [begin, finish, interactive, measure, update, writeDrag],
  );

  const liveScore = drag ? scoreArrow(zones, drag.x, drag.y) : null;

  // Loupe placement: above the finger, clamped inside the face horizontally.
  const loupeLeft = drag
    ? Math.min(Math.max(drag.px - LOUPE_SIZE / 2, 4), size.w - LOUPE_SIZE - 4)
    : 0;
  const loupeTop = drag ? drag.py - LOUPE_SIZE - LOUPE_LIFT + LOUPE_SIZE / 2 : 0;
  const loupeAbove = drag ? loupeTop >= 0 : true;

  const face = (
    <View
      ref={containerRef}
      onLayout={measure}
      style={{ width: '100%', aspectRatio }}
      accessible={interactive}
      accessibilityRole={interactive ? 'button' : 'image'}
      accessibilityLabel={
        interactive
          ? `Target face, ${marks.length} arrows marked. Press and drag to aim a new mark; release to place it.`
          : `Target face with ${marks.length} arrow marks`
      }
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        // The drawing is inert: every pointer event belongs to the gesture
        // view. Without this, react-native-svg's web elements take the events.
        pointerEvents="none"
        style={styles.inert}
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

        {marks.map((mark) => {
          // The mark being moved renders at the drag position instead.
          const moving = drag?.mode === 'move' && drag.markId === mark.id;
          const x = moving ? drag!.x : mark.x;
          const y = moving ? drag!.y : mark.y;

          if (dense) {
            // Translucent so overlapping arrows accumulate into visible
            // density — the group's shape emerges from where they pile up.
            return (
              <Circle
                key={mark.id}
                cx={x}
                cy={y}
                r={MARK_RADIUS * 0.5}
                fill={
                  mark.scoreValue === 0 ? arrowMark.missFill : arrowMark.fill
                }
                opacity={0.55}
                stroke={arrowMark.stroke}
                strokeWidth={MARK_RADIUS * 0.12}
              />
            );
          }

          return (
            <G key={mark.id}>
              <Circle
                cx={x}
                cy={y}
                r={MARK_RADIUS}
                fill={
                  mark.scoreValue === 0 && !moving
                    ? arrowMark.missFill
                    : arrowMark.fill
                }
                stroke={arrowMark.stroke}
                strokeWidth={MARK_RADIUS * 0.35}
                opacity={moving ? 0.9 : 1}
              />
              {mark.id === selectedMarkId || moving ? (
                <Circle
                  cx={x}
                  cy={y}
                  r={MARK_RADIUS * 2.1}
                  fill="none"
                  stroke={arrowMark.stroke}
                  strokeWidth={MARK_RADIUS * 0.22}
                  strokeDasharray={moving ? undefined : `${MARK_RADIUS * 0.7}`}
                />
              ) : null}
            </G>
          );
        })}

        {/* Group centre: where the sight is really pointing, versus the middle. */}
        {centroid ? (
          <G>
            <Line
              x1={centroid.x - 0.05}
              y1={centroid.y}
              x2={centroid.x + 0.05}
              y2={centroid.y}
              stroke={arrowMark.stroke}
              strokeWidth={0.006}
            />
            <Line
              x1={centroid.x}
              y1={centroid.y - 0.05}
              x2={centroid.x}
              y2={centroid.y + 0.05}
              stroke={arrowMark.stroke}
              strokeWidth={0.006}
            />
            <Circle
              cx={centroid.x}
              cy={centroid.y}
              r={0.028}
              fill="none"
              stroke={arrowMark.stroke}
              strokeWidth={0.006}
            />
          </G>
        ) : null}

        {/* Live preview of a mark being placed. */}
        {drag?.mode === 'new' ? (
          <G>
            <Circle
              cx={drag.x}
              cy={drag.y}
              r={MARK_RADIUS}
              fill={arrowMark.fill}
              stroke={arrowMark.stroke}
              strokeWidth={MARK_RADIUS * 0.35}
              opacity={0.9}
            />
            <Circle
              cx={drag.x}
              cy={drag.y}
              r={MARK_RADIUS * 2.1}
              fill="none"
              stroke={arrowMark.stroke}
              strokeWidth={MARK_RADIUS * 0.22}
            />
          </G>
        ) : null}
      </Svg>

      {/* Magnifier loupe + live score, offset so the finger hides neither. */}
      {drag && size.w > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.loupeWrap,
            {
              left: loupeLeft,
              top: loupeAbove ? loupeTop : drag.py + LOUPE_LIFT - LOUPE_SIZE / 2,
            },
          ]}
        >
          <View
            style={[
              styles.loupe,
              {
                borderColor: palette.accent,
                backgroundColor: palette.surface,
              },
            ]}
          >
            <Svg
              width={LOUPE_SIZE}
              height={LOUPE_SIZE}
              viewBox={`${drag.x - LOUPE_REGION / 2} ${
                drag.y - LOUPE_REGION / (2 * aspectRatio)
              } ${LOUPE_REGION} ${LOUPE_REGION / aspectRatio}`}
              preserveAspectRatio="none"
            >
              <G>
                {paintOrder.map((zone) => (
                  <ZoneShape
                    key={zone.zoneIndex}
                    zone={zone}
                    maxScore={maxScore}
                    isPreset={isPreset}
                  />
                ))}
              </G>
              {/* Crosshair at the exact aim point. */}
              <Circle
                cx={drag.x}
                cy={drag.y}
                r={LOUPE_REGION * 0.03}
                fill={arrowMark.stroke}
              />
              <Circle
                cx={drag.x}
                cy={drag.y}
                r={LOUPE_REGION * 0.12}
                fill="none"
                stroke={arrowMark.stroke}
                strokeWidth={LOUPE_REGION * 0.012}
              />
            </Svg>
          </View>
          <View
            style={[styles.scoreBubble, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.scoreBubbleText, { color: palette.onAccent }]}>
              {liveScore === 0 ? 'M' : liveScore}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  return interactive ? (
    <GestureDetector gesture={gesture}>{face}</GestureDetector>
  ) : (
    face
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

const styles = StyleSheet.create({
  inert: { pointerEvents: 'none' },
  loupeWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  loupe: {
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    borderRadius: LOUPE_SIZE / 2,
    borderWidth: 3,
    overflow: 'hidden',
  },
  scoreBubble: {
    marginTop: 6,
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  scoreBubbleText: {
    fontFamily: fonts.display,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});
