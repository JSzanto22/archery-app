/**
 * Regression tests for the marking gesture.
 *
 * Every case below corresponds to a bug reported from real-device testing.
 * The gesture is the app's core interaction and its defects are all in
 * bookkeeping, so it gets pinned down here rather than re-tested by hand.
 */

import {
  DragState,
  MarkPoint,
  TAP_SLOP_PX,
  beginDrag,
  findMarkAt,
  finishDrag,
  updateDrag,
} from '../markingGesture';

const SIZE = { w: 400, h: 400 };
const CAN_PLACE = { canPlace: true };

/** A mark dead centre: pixel (200, 200) on the 400x400 face. */
const centreMark: MarkPoint = { id: 'a', x: 0.5, y: 0.5 };

/** Drive a drag through n intermediate steps, as a real pointer would. */
function dragThrough(
  state: DragState,
  from: [number, number],
  to: [number, number],
  steps: number,
): DragState {
  let current = state;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    current = updateDrag(
      current,
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      SIZE,
    );
  }
  return current;
}

describe('beginDrag', () => {
  it('starts a placement on empty space', () => {
    const state = beginDrag(100, 300, SIZE, [], CAN_PLACE)!;
    expect(state.mode).toBe('new');
    expect(state.x).toBeCloseTo(0.25, 6);
    expect(state.y).toBeCloseTo(0.75, 6);
  });

  it('grabs an existing mark within finger reach', () => {
    const state = beginDrag(210, 205, SIZE, [centreMark], CAN_PLACE)!;
    expect(state.mode).toBe('move');
    expect(state.markId).toBe('a');
  });

  it('refuses to start on an unmeasured face', () => {
    // A zero-sized view would otherwise place a mark at a guessed position.
    expect(beginDrag(50, 50, { w: 0, h: 0 }, [], CAN_PLACE)).toBeNull();
  });

  it('still grabs marks on a read-only face but places nothing', () => {
    expect(beginDrag(100, 300, SIZE, [], { canPlace: false })).toBeNull();
    expect(
      beginDrag(200, 200, SIZE, [centreMark], { canPlace: false })?.mode,
    ).toBe('move');
  });
});

describe('a slow, careful drag', () => {
  it('is not mistaken for a tap', () => {
    // The bug: `moved` compared each event to the PREVIOUS one, so a 60px
    // drag delivered in 30 tiny steps never exceeded the slop in any single
    // step. It was classified as a tap, and the mark snapped back.
    const start = beginDrag(200, 200, SIZE, [centreMark], CAN_PLACE)!;
    const dragged = dragThrough(start, [200, 200], [260, 200], 30);

    expect(dragged.moved).toBe(true);
    expect(finishDrag(dragged, null)).toEqual({
      type: 'move',
      markId: 'a',
      x: 0.65,
      y: 0.5,
    });
  });

  it('commits the final position, not an intermediate one', () => {
    const start = beginDrag(200, 200, SIZE, [centreMark], CAN_PLACE)!;
    const dragged = dragThrough(start, [200, 200], [300, 100], 20);

    const intent = finishDrag(dragged, null);
    expect(intent).toEqual({ type: 'move', markId: 'a', x: 0.75, y: 0.25 });
  });

  it('leaves a genuine micro-movement classified as a tap', () => {
    const start = beginDrag(200, 200, SIZE, [centreMark], CAN_PLACE)!;
    const nudged = updateDrag(start, 200 + TAP_SLOP_PX - 1, 200, SIZE);

    expect(nudged.moved).toBe(false);
    expect(finishDrag(nudged, null)).toEqual({ type: 'select', markId: 'a' });
  });
});

describe('grab offset', () => {
  it('does not teleport a mark grabbed by its edge', () => {
    // Touch 18px right of the mark's centre — inside the grab radius, but not
    // on the centre. Releasing without moving must leave it exactly put.
    const start = beginDrag(218, 200, SIZE, [centreMark], CAN_PLACE)!;
    expect(start.x).toBeCloseTo(0.5, 6);
    expect(start.y).toBeCloseTo(0.5, 6);

    // Drag 40px right: the mark should travel 40px, landing at 240 — not jump
    // to the fingertip.
    const dragged = dragThrough(start, [218, 200], [258, 200], 10);
    expect(dragged.x).toBeCloseTo(0.6, 6);
    expect(dragged.y).toBeCloseTo(0.5, 6);
  });
});

describe('finishDrag', () => {
  it('places when tapping empty space with nothing selected', () => {
    const state = beginDrag(120, 120, SIZE, [], CAN_PLACE)!;
    expect(finishDrag(state, null)).toEqual({ type: 'place', x: 0.3, y: 0.3 });
  });

  it('deselects instead of placing when tapping away from a selection', () => {
    // The phantom arrow: "tap away to deselect" used to spawn a mark.
    const state = beginDrag(120, 120, SIZE, [centreMark], CAN_PLACE)!;
    expect(finishDrag(state, 'a')).toEqual({ type: 'select', markId: null });
  });

  it('still places on a deliberate drag even while something is selected', () => {
    const start = beginDrag(120, 120, SIZE, [centreMark], CAN_PLACE)!;
    const dragged = dragThrough(start, [120, 120], [160, 160], 8);
    expect(finishDrag(dragged, 'a')).toEqual({
      type: 'place',
      x: 0.4,
      y: 0.4,
    });
  });

  it('toggles a selected mark off when tapped again', () => {
    const state = beginDrag(200, 200, SIZE, [centreMark], CAN_PLACE)!;
    expect(finishDrag(state, 'a')).toEqual({ type: 'select', markId: null });
  });

  it('commits nothing when the state was already claimed', () => {
    // The duplicate-arrow guard: the caller clears its state before
    // committing, so a second end event for one gesture finds nothing.
    expect(finishDrag(null, null)).toEqual({ type: 'none' });
  });
});

describe('bounds', () => {
  it('clamps a drag that leaves the face', () => {
    const start = beginDrag(200, 200, SIZE, [], CAN_PLACE)!;
    const dragged = updateDrag(start, 900, -400, SIZE);
    expect(dragged.x).toBe(1);
    expect(dragged.y).toBe(0);
  });

  it('finds the nearest mark when several are in reach', () => {
    const marks: MarkPoint[] = [
      { id: 'near', x: 0.5, y: 0.5 },
      { id: 'far', x: 0.53, y: 0.5 },
    ];
    expect(findMarkAt(marks, 204, 200, SIZE)?.id).toBe('near');
    expect(findMarkAt(marks, 210, 200, SIZE)?.id).toBe('far');
  });

  it('ignores marks beyond finger reach', () => {
    expect(findMarkAt([centreMark], 300, 300, SIZE)).toBeNull();
  });
});
