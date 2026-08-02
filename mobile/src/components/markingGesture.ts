/**
 * The marking gesture, as a pure state machine.
 *
 * Extracted from TargetFace so it can be tested without a renderer, a pointer,
 * or a device. Every drag bug reported so far has been in this bookkeeping
 * rather than in the drawing, and bookkeeping is exactly what unit tests are
 * good at pinning down.
 *
 * The component owns *when* these run; this module owns *what they mean*.
 */

export interface Size {
  w: number;
  h: number;
}

export interface MarkPoint {
  id: string;
  x: number;
  y: number;
}

export interface DragState {
  /** 'new' places a fresh mark; 'move' relocates an existing one. */
  mode: 'new' | 'move';
  markId?: string;
  /** Normalized AIM position — where the mark will land. */
  x: number;
  y: number;
  /** Aim position in pixels, for placing the loupe. */
  px: number;
  py: number;
  /**
   * Where the FINGER first touched, in pixels. `moved` is measured against
   * this, never against the previous event: the per-event deltas of a slow,
   * careful drag — exactly what the loupe encourages — all sit under the tap
   * slop, so a previous-event comparison classifies precise drags as taps.
   */
  startPx: number;
  startPy: number;
  /**
   * Grab offset (aim minus finger) so a mark picked up by its edge moves
   * relative to where it was instead of teleporting under the fingertip.
   */
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

/** What the caller should do when the gesture ends. */
export type FinishIntent =
  | { type: 'none' }
  | { type: 'place'; x: number; y: number }
  | { type: 'move'; markId: string; x: number; y: number }
  | { type: 'select'; markId: string | null };

/** Finger-sized radius (px) for grabbing an existing mark. */
export const GRAB_SLOP_PX = 24;

/** Cumulative movement (px) below which a gesture counts as a tap. */
export const TAP_SLOP_PX = 8;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** The mark nearest the touch, if one is within grabbing distance. */
export function findMarkAt(
  marks: readonly MarkPoint[],
  px: number,
  py: number,
  size: Size,
): MarkPoint | null {
  if (!size.w || !size.h) return null;

  let best: MarkPoint | null = null;
  let bestDist = GRAB_SLOP_PX;

  for (const mark of marks) {
    const dx = mark.x * size.w - px;
    const dy = mark.y * size.h - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= bestDist) {
      best = mark;
      bestDist = dist;
    }
  }

  return best;
}

/**
 * Touch down. Returns null when the gesture cannot start — an unmeasured face
 * (no size yet) or a read-only face with nothing to grab. Returning null is
 * deliberate: guessing at a position from a zero-sized view would place marks
 * in the wrong spot.
 */
export function beginDrag(
  px: number,
  py: number,
  size: Size,
  marks: readonly MarkPoint[],
  options: { canPlace: boolean },
): DragState | null {
  if (!size.w || !size.h) return null;

  const grabbed = findMarkAt(marks, px, py, size);

  if (grabbed) {
    return {
      mode: 'move',
      markId: grabbed.id,
      x: grabbed.x,
      y: grabbed.y,
      px: grabbed.x * size.w,
      py: grabbed.y * size.h,
      startPx: px,
      startPy: py,
      offsetX: grabbed.x * size.w - px,
      offsetY: grabbed.y * size.h - py,
      moved: false,
    };
  }

  if (!options.canPlace) return null;

  return {
    mode: 'new',
    x: clamp01(px / size.w),
    y: clamp01(py / size.h),
    px,
    py,
    startPx: px,
    startPy: py,
    offsetX: 0,
    offsetY: 0,
    moved: false,
  };
}

/** Pointer moved. `fingerPx/Py` are raw; the aim point carries the grab offset. */
export function updateDrag(
  state: DragState,
  fingerPx: number,
  fingerPy: number,
  size: Size,
): DragState {
  if (!size.w || !size.h) return state;

  const aimPx = fingerPx + state.offsetX;
  const aimPy = fingerPy + state.offsetY;

  return {
    ...state,
    x: clamp01(aimPx / size.w),
    y: clamp01(aimPy / size.h),
    px: aimPx,
    py: aimPy,
    moved:
      state.moved ||
      Math.abs(fingerPx - state.startPx) > TAP_SLOP_PX ||
      Math.abs(fingerPy - state.startPy) > TAP_SLOP_PX,
  };
}

/**
 * Pointer released. Pure — the caller performs the returned intent.
 *
 * A null state yields `none`, which is what makes double-delivered end events
 * harmless: the caller clears its state before calling, so a second call finds
 * nothing and cannot commit a duplicate.
 */
export function finishDrag(
  state: DragState | null,
  selectedMarkId: string | null | undefined,
): FinishIntent {
  if (!state) return { type: 'none' };

  if (state.mode === 'move') {
    if (state.moved) {
      return { type: 'move', markId: state.markId!, x: state.x, y: state.y };
    }
    // A press on a mark that never moved is a tap: toggle its selection.
    return {
      type: 'select',
      markId: state.markId === selectedMarkId ? null : state.markId!,
    };
  }

  // Tap on empty space while a mark is selected deselects — it does not place.
  // This is the Figma/Excalidraw convention, and without it the natural "tap
  // away to deselect" gesture spawns an unwanted arrow.
  if (!state.moved && selectedMarkId) {
    return { type: 'select', markId: null };
  }

  return { type: 'place', x: state.x, y: state.y };
}
