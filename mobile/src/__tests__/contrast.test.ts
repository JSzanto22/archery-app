/**
 * Contrast is a measurable property, so it is measured rather than reviewed.
 *
 * This app is used outdoors in direct sunlight, where an already-marginal
 * ratio becomes unreadable. Every text and meaning-carrying pair is checked
 * against WCAG AA here so a future palette tweak cannot quietly regress it —
 * `textMuted` previously sat at 3.3:1 on the page and carried every caption
 * in the app.
 */

import { PALETTES } from '../theme';

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as RGB;
}

function channelLuminance(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(channelLuminance) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: 4.5 for body text, 3.0 for UI components and graphics. */
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3.0;

describe.each(['light', 'dark'] as const)('%s palette', (mode) => {
  const p = PALETTES[mode];

  // Both backgrounds matter: cards sit on `surface`, the screen on `page`,
  // and captions appear on both.
  const backgrounds: Array<[string, string]> = [
    ['surface', p.surface],
    ['page', p.page],
  ];

  describe.each(backgrounds)('text on %s', (_name, bg) => {
    it.each([
      ['textPrimary', p.textPrimary],
      ['textSecondary', p.textSecondary],
      ['textMuted', p.textMuted],
      ['accentText', p.accentText],
      ['critical', p.critical],
      ['good', p.good],
    ])('%s meets AA', (_label, fg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    });

    it('accentBorder is visible as a component boundary', () => {
      // Selection rings, the loupe and the roundel all depend on this being
      // distinguishable, not merely present.
      expect(contrastRatio(p.accentBorder, bg)).toBeGreaterThanOrEqual(
        NON_TEXT_MIN,
      );
    });
  });

  it('labels on the filled button meet AA', () => {
    expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });

  it('labels on the tonal button meet AA', () => {
    expect(
      contrastRatio(p.onAccentTonal, p.accentTonal),
    ).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('chart series are distinguishable from their surface', () => {
    for (const series of [p.series1, p.series2]) {
      expect(contrastRatio(series, p.surface)).toBeGreaterThanOrEqual(
        NON_TEXT_MIN,
      );
    }
  });
});

describe('contrastRatio', () => {
  it('matches known reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order must not matter.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});
