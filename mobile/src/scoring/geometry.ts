/**
 * Point-in-shape tests for target zone geometry.
 *
 * All coordinates are normalized 0-1 relative to the target face, matching
 * `target_zones.shape_params` in the database. Nothing here knows about pixels;
 * the renderer scales, this module does not.
 *
 * This is the device-side counterpart of the seed-only scoring helper in
 * `backend/db/seeds/0002_demo_data.sql`. The two must agree, or a score
 * recorded on the phone will disagree with one derived from the same row on the
 * server. The seed deliberately ignores `rot` because every seeded shape is
 * axis-aligned; this implementation handles it properly, because the custom
 * target builder can produce rotated shapes.
 */

export type ShapeType = 'circle' | 'ellipse' | 'rectangle' | 'polygon';

export interface CircleParams {
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseParams {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Clockwise rotation in DEGREES about (cx, cy). Absent or 0 = axis-aligned. */
  rot?: number;
}

export interface RectangleParams {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise rotation in DEGREES about the rectangle's centre. */
  rot?: number;
}

export interface PolygonParams {
  /** Ordered vertices. Winding direction does not matter. */
  points: Array<[number, number]>;
}

export type ShapeParams =
  CircleParams | EllipseParams | RectangleParams | PolygonParams;

export interface Point {
  x: number;
  y: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Boundary tolerance for containment tests.
 *
 * An arrow whose centre sits exactly on a scoring line takes the higher value —
 * "line cutters" score up in every archery ruleset. Without a tolerance that
 * rule fails in practice, because floating point makes exact boundaries
 * unreliable: on the WA 10 ring, r = 0.05 and a mark at x = 0.55 computes a
 * squared distance of 0.0025000000000000044 against r² of 0.0025000000000000005
 * and scores a 9.
 *
 * 1e-9 in normalized units is roughly a ten-millionth of a centimetre on a
 * 122 cm face — far below both the 6-decimal-place storage precision and any
 * physically meaningful difference, so it only ever resolves the tie.
 */
const EPSILON = 1e-9;

/**
 * Rotate a point by -angle about a pivot, i.e. transform it into the shape's
 * own frame so the shape can be tested as if axis-aligned.
 */
function toShapeFrame(
  x: number,
  y: number,
  pivotX: number,
  pivotY: number,
  rotDegrees: number,
): Point {
  if (!rotDegrees) return { x, y };

  const a = -rotDegrees * DEG_TO_RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = x - pivotX;
  const dy = y - pivotY;

  return {
    x: pivotX + dx * cos - dy * sin,
    y: pivotY + dx * sin + dy * cos,
  };
}

function inCircle(p: CircleParams, x: number, y: number): boolean {
  const dx = x - p.cx;
  const dy = y - p.cy;
  return dx * dx + dy * dy <= p.r * p.r + EPSILON;
}

function inEllipse(p: EllipseParams, x: number, y: number): boolean {
  const local = toShapeFrame(x, y, p.cx, p.cy, p.rot ?? 0);
  const nx = (local.x - p.cx) / p.rx;
  const ny = (local.y - p.cy) / p.ry;
  return nx * nx + ny * ny <= 1 + EPSILON;
}

function inRectangle(p: RectangleParams, x: number, y: number): boolean {
  const local = toShapeFrame(x, y, p.x + p.w / 2, p.y + p.h / 2, p.rot ?? 0);
  return (
    local.x >= p.x - EPSILON &&
    local.x <= p.x + p.w + EPSILON &&
    local.y >= p.y - EPSILON &&
    local.y <= p.y + p.h + EPSILON
  );
}

/**
 * Ray casting. Counts how many edges a ray cast in +x crosses; odd means inside.
 *
 * The `(yi > y) !== (yj > y)` test is what keeps a vertex lying exactly on the
 * ray from being counted twice — the naive `>=` version double-counts and
 * reports points outside the polygon as inside.
 */
function inPolygon(p: PolygonParams, x: number, y: number): boolean {
  const pts = p.points;
  let inside = false;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    // A malformed polygon — a sparse array, or one shorter than its own
    // length claims — should skip the edge rather than score the arrow
    // against NaN, which would silently read as "outside".
    if (!a || !b) continue;

    const [xi, yi] = a;
    const [xj, yj] = b;

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/** True when (x, y) falls inside the shape, boundary inclusive. */
export function pointInShape(
  shapeType: ShapeType,
  params: ShapeParams,
  x: number,
  y: number,
): boolean {
  switch (shapeType) {
    case 'circle':
      return inCircle(params as CircleParams, x, y);
    case 'ellipse':
      return inEllipse(params as EllipseParams, x, y);
    case 'rectangle':
      return inRectangle(params as RectangleParams, x, y);
    case 'polygon':
      return inPolygon(params as PolygonParams, x, y);
    default:
      return false;
  }
}
