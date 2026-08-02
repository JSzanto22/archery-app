/**
 * Renders a target face from its zone geometry and handles tap-to-mark.
 *
 * The whole face is drawn in a 0-1 viewBox and scaled by SVG, so this component
 * never converts coordinates itself beyond the single tap-to-normalized step.
 * That keeps exactly one place where a pixel becomes a normalized coordinate,
 * which is the conversion that would otherwise drift out of step with scoring.
 */

import React, { useCallback, useMemo } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, View } from 'react-native';
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
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    setSize({ width, height: width / aspectRatio });
  }, [aspectRatio]);

  const maxScore = useMemo(() => maxZoneScore(zones), [zones]);

  // Zones arrive innermost-first for scoring, so they must be drawn in reverse
  // or the 10 ring would be painted over by the 1 ring.
  const paintOrder = useMemo(
    () => [...zones].sort((a, b) => b.zoneIndex - a.zoneIndex),
    [zones],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (!onTap || size.width === 0 || size.height === 0) return;

      const { locationX, locationY } = event.nativeEvent;
      const x = locationX / size.width;
      const y = locationY / size.height;

      // A tap that lands outside the face is a miss the archer meant to record,
      // but a tap outside the *view* is a stray gesture. Only the latter is
      // discarded.
      if (x < 0 || x > 1 || y < 0 || y > 1) return;

      onTap(x, y);
    },
    [onTap, size.height, size.width],
  );

  // Mark radius shrinks on a squashed face so it stays circular on screen.
  const markRadius = 0.018;

  return (
    <View onLayout={onLayout} style={{ width: '100%', height: size.height }}>
      {size.width > 0 && (
        <Svg
          width={size.width}
          height={size.height}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          onPress={handlePress}
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
            <G key={mark.id} onPress={() => onMarkPress?.(mark.id)}>
              <Circle
                cx={mark.x}
                cy={mark.y}
                r={markRadius}
                // The 2px surface ring is what keeps a mark readable whether it
                // lands on gold, black or white.
                fill={
                  mark.scoreValue === 0 ? arrowMark.missFill : arrowMark.fill
                }
                stroke={arrowMark.stroke}
                strokeWidth={markRadius * 0.35}
                vectorEffect="non-scaling-stroke"
              />
              {mark.id === selectedMarkId ? (
                <Circle
                  cx={mark.x}
                  cy={mark.y}
                  r={markRadius * 2}
                  fill="none"
                  stroke={arrowMark.stroke}
                  strokeWidth={markRadius * 0.25}
                />
              ) : null}
            </G>
          ))}
        </Svg>
      )}
    </View>
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
