/**
 * Target-zone geometry validation.
 *
 * A zone's `shape_params` is JSONB, and both write paths — `POST /targets` and
 * `/sync/push` — used to accept whatever JSON arrived. The database's CHECK
 * only tests that the expected keys are present, not that they hold numbers,
 * so `{"cx": "x", "cy": [], "r": null}` stored cleanly and then reached the
 * device, where the scoring arithmetic produced NaN and every arrow inside that
 * ring silently scored as a miss. A polygon could carry an unbounded point
 * list, which the device ray-casts once per arrow per zone.
 *
 * This module is the single definition both paths validate against, so the two
 * cannot drift apart.
 */

import { z } from 'zod';

/**
 * Coordinates are normalized to the face, so 0-1 is the meaningful range. The
 * bounds are widened to -1..2 because a legitimate zone may extend past the
 * face edge before being clipped; they exist to reject nonsense and infinities,
 * not to second-guess a target designer.
 */
const normalized = z.number().min(-1).max(2);

/** A radius or side length, in the same normalized units. */
const extent = z.number().positive().max(2);

const degrees = z.number().min(-360).max(360);

/** Detailed enough for any real silhouette, far short of a denial of service. */
export const MAX_POLYGON_POINTS = 500;

/** A face with more scoring rings than this is not a target anyone shoots at. */
export const MAX_ZONES_PER_TARGET = 100;

export const zoneShapeSchema = z.discriminatedUnion('shapeType', [
  z.object({
    shapeType: z.literal('circle'),
    shapeParams: z.object({ cx: normalized, cy: normalized, r: extent }),
  }),
  z.object({
    shapeType: z.literal('ellipse'),
    shapeParams: z.object({
      cx: normalized,
      cy: normalized,
      rx: extent,
      ry: extent,
      rot: degrees.optional(),
    }),
  }),
  z.object({
    shapeType: z.literal('rectangle'),
    shapeParams: z.object({
      x: normalized,
      y: normalized,
      w: extent,
      h: extent,
      rot: degrees.optional(),
    }),
  }),
  z.object({
    shapeType: z.literal('polygon'),
    shapeParams: z.object({
      points: z
        .array(z.tuple([normalized, normalized]))
        .min(3)
        .max(MAX_POLYGON_POINTS),
    }),
  }),
]);

export type ZoneShape = z.infer<typeof zoneShapeSchema>;

/**
 * Validate a shape from the sync wire format, where the two halves arrive as
 * separate loosely-typed columns and `shape_params` may still be a JSON string.
 *
 * Returns null rather than throwing: a push carries a whole device's history,
 * and one malformed zone should be dropped, not fail the archer's entire sync.
 */
export function parseZoneShape(
  shapeType: unknown,
  shapeParams: unknown,
): ZoneShape | null {
  let params = shapeParams;

  if (typeof params === 'string') {
    try {
      params = JSON.parse(params);
    } catch {
      return null;
    }
  }

  const parsed = zoneShapeSchema.safeParse({ shapeType, shapeParams: params });
  return parsed.success ? parsed.data : null;
}
