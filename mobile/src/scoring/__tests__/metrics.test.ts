/**
 * Tests for the metrics the dashboard reports.
 *
 * These numbers drive coaching decisions — "your group sits low left, adjust
 * your sight" — so a sign error would send an archer the wrong way.
 */

import {
  groupBias,
  scoreConsistency,
  scoreDistribution,
  toCentimetres,
} from '../grouping';
import { formatDistance, formatGrouping } from '../../units';

describe('groupBias', () => {
  it('names a low-left group', () => {
    // y grows downward, so a larger y is lower on the face.
    const points = [
      { x: 0.4, y: 0.6 },
      { x: 0.38, y: 0.62 },
      { x: 0.42, y: 0.58 },
    ];
    const bias = groupBias(points)!;

    expect(bias.dx).toBeLessThan(0);
    expect(bias.dy).toBeGreaterThan(0);
    expect(bias.direction).toBe('low left');
  });

  it('names a high-right group', () => {
    const bias = groupBias([
      { x: 0.6, y: 0.4 },
      { x: 0.62, y: 0.38 },
    ])!;
    expect(bias.direction).toBe('high right');
  });

  it('reports no direction for a centred group', () => {
    const bias = groupBias([
      { x: 0.5, y: 0.5 },
      { x: 0.505, y: 0.495 },
    ])!;
    expect(bias.direction).toBeNull();
  });

  it('names a single axis when only one is off', () => {
    expect(
      groupBias([
        { x: 0.5, y: 0.7 },
        { x: 0.5, y: 0.7 },
      ])!.direction,
    ).toBe('low');

    expect(
      groupBias([
        { x: 0.75, y: 0.5 },
        { x: 0.75, y: 0.5 },
      ])!.direction,
    ).toBe('right');
  });

  it('corrects the vertical offset on a squashed face', () => {
    const points = [{ x: 0.5, y: 0.7 }];
    const square = groupBias(points, { x: 0.5, y: 0.5 }, { aspectRatio: 1 })!;
    const squashed = groupBias(
      points,
      { x: 0.5, y: 0.5 },
      { aspectRatio: 1 / 3 },
    )!;

    expect(squashed.distance).toBeCloseTo(square.distance / 3, 10);
  });

  it('returns null with no arrows', () => {
    expect(groupBias([])).toBeNull();
  });
});

describe('scoreConsistency', () => {
  it('is zero for identical scores', () => {
    expect(scoreConsistency([8, 8, 8, 8])).toBe(0);
  });

  it('separates a steady archer from a streaky one', () => {
    // Both average 8; the second alternates 10s and 6s.
    const steady = scoreConsistency([8, 8, 8, 8])!;
    const streaky = scoreConsistency([10, 6, 10, 6])!;

    expect(steady).toBeLessThan(streaky);
    expect(streaky).toBeCloseTo(2, 10);
  });

  it('needs at least two arrows', () => {
    expect(scoreConsistency([9])).toBeNull();
    expect(scoreConsistency([])).toBeNull();
  });
});

describe('scoreDistribution', () => {
  it('counts each ring, highest first', () => {
    expect(scoreDistribution([10, 9, 10, 0, 8, 10])).toEqual([
      { score: 10, count: 3 },
      { score: 9, count: 1 },
      { score: 8, count: 1 },
      { score: 0, count: 1 },
    ]);
  });

  it('is empty for no arrows', () => {
    expect(scoreDistribution([])).toEqual([]);
  });
});

describe('physical units', () => {
  it('converts a normalized spread to centimetres on the right face', () => {
    // The same 9% spread is a very different group on each face — which is
    // exactly why a bare percentage is ambiguous.
    expect(toCentimetres(0.09, 122)).toBeCloseTo(10.98, 6);
    expect(toCentimetres(0.09, 40)).toBeCloseTo(3.6, 6);
  });

  it('formats metric and imperial', () => {
    expect(formatDistance(10.98, 'metric')).toBe('11.0 cm');
    expect(formatDistance(10.98, 'imperial')).toBe('4.3"');
  });

  it('leads with the real distance and keeps the percentage as context', () => {
    const shown = formatGrouping(0.09, 122, 'metric');
    expect(shown.primary).toBe('11.0 cm');
    expect(shown.secondary).toBe('9.0% of face');
  });

  it('falls back to the percentage when the face size is unknown', () => {
    // Inventing a centimetre figure from an assumed diameter would be worse
    // than admitting the size is unknown.
    const shown = formatGrouping(0.09, null, 'metric');
    expect(shown.primary).toBe('9.0% of face');
    expect(shown.secondary).toBeNull();
  });

  it('has nothing to show without a grouping', () => {
    expect(formatGrouping(null, 122, 'metric')).toEqual({
      primary: '—',
      secondary: null,
    });
  });
});
