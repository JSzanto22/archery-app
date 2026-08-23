/**
 * Zone geometry validation.
 *
 * These run without a database because the point is the schema itself: both
 * write paths (POST /targets and /sync/push) delegate here, so a hole in this
 * file is a hole in both.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_POLYGON_POINTS,
  parseZoneShape,
  zoneShapeSchema,
} from '../zoneShapes.js';

describe('zoneShapeSchema', () => {
  it('accepts the shapes the presets actually use', () => {
    const cases = [
      { shapeType: 'circle', shapeParams: { cx: 0.5, cy: 0.5, r: 0.1 } },
      {
        shapeType: 'ellipse',
        shapeParams: { cx: 0.5, cy: 0.25, rx: 0.2, ry: 0.07 },
      },
      {
        shapeType: 'rectangle',
        shapeParams: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rot: 15 },
      },
      {
        shapeType: 'polygon',
        shapeParams: {
          points: [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.5, 0.9],
          ],
        },
      },
    ];

    for (const shape of cases) {
      expect(zoneShapeSchema.safeParse(shape).success).toBe(true);
    }
  });

  it('rejects params of the wrong type', () => {
    // The database CHECK only tests that the keys exist, so this stored
    // cleanly and became NaN on the device: every arrow inside the ring
    // scored as a miss, with nothing on screen to explain it.
    const result = zoneShapeSchema.safeParse({
      shapeType: 'circle',
      shapeParams: { cx: 'x', cy: null, r: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a radius of zero', () => {
    const result = zoneShapeSchema.safeParse({
      shapeType: 'circle',
      shapeParams: { cx: 0.5, cy: 0.5, r: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects infinities', () => {
    const result = zoneShapeSchema.safeParse({
      shapeType: 'circle',
      shapeParams: { cx: Number.POSITIVE_INFINITY, cy: 0.5, r: 0.1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects params belonging to a different shape', () => {
    const result = zoneShapeSchema.safeParse({
      shapeType: 'circle',
      shapeParams: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown shape type', () => {
    const result = zoneShapeSchema.safeParse({
      shapeType: 'fractal',
      shapeParams: { cx: 0.5, cy: 0.5, r: 0.1 },
    });
    expect(result.success).toBe(false);
  });

  it('caps polygon points', () => {
    // Unbounded, the device ray-casts every point once per arrow per zone.
    const points = Array.from(
      { length: MAX_POLYGON_POINTS + 1 },
      (_, i) => [i / (MAX_POLYGON_POINTS + 1), 0.5] as [number, number],
    );

    const result = zoneShapeSchema.safeParse({
      shapeType: 'polygon',
      shapeParams: { points },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a polygon that is not a polygon', () => {
    const result = zoneShapeSchema.safeParse({
      shapeType: 'polygon',
      shapeParams: {
        points: [
          [0.1, 0.1],
          [0.9, 0.9],
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('parseZoneShape', () => {
  it('parses the JSON string form the sync wire uses', () => {
    const shape = parseZoneShape(
      'circle',
      JSON.stringify({ cx: 0.5, cy: 0.5, r: 0.1 }),
    );
    expect(shape?.shapeParams).toEqual({ cx: 0.5, cy: 0.5, r: 0.1 });
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseZoneShape('circle', '{not json')).toBeNull();
  });

  it('returns null for valid JSON of the wrong shape', () => {
    expect(parseZoneShape('circle', '{"r":"big"}')).toBeNull();
  });
});
