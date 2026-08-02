/**
 * Design tokens.
 *
 * The visual language is deliberately small: one accent, four type steps, an
 * 8dp spacing grid, 48dp touch targets, and flat hairline-separated surfaces.
 * Direction and rationale: docs/ui-redesign-direction.md.
 *
 * Chart and chrome colours are the validated data-viz palette; the two series
 * hues passed the palette validator (lightness band, chroma floor, CVD
 * separation, normal-vision floor, contrast) against both surfaces.
 *
 * Target-face colours are a separate matter and deliberately not from that
 * palette: they depict a physical object whose colours are fixed by World
 * Archery. A blue 10 ring would be wrong in the way a green stop sign is wrong.
 */

import { TextStyle, useColorScheme } from 'react-native';

export interface Palette {
  surface: string;
  page: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gridline: string;
  baseline: string;
  border: string;
  /** The one accent. Primary action per screen, live data, nothing else. */
  accent: string;
  onAccent: string;
  /** Quiet accent-tinted fill for selected chips and tonal buttons. */
  accentTonal: string;
  onAccentTonal: string;
  /** Score trend. Same hue as accent by design — live data is accent's job. */
  series1: string;
  /** Grouping trend. Never shares an axis with series1 — separate charts. */
  series2: string;
  good: string;
  critical: string;
}

const light: Palette = {
  surface: '#fcfcfb',
  page: '#f9f9f7',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  gridline: '#e1e0d9',
  baseline: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  accent: '#2a78d6',
  onAccent: '#ffffff',
  accentTonal: '#e7f0fb',
  onAccentTonal: '#1c5cab',
  series1: '#2a78d6',
  series2: '#eb6834',
  good: '#006300',
  critical: '#d03b3b',
};

const dark: Palette = {
  surface: '#1a1a19',
  page: '#0d0d0d',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  gridline: '#2c2c2a',
  baseline: '#383835',
  border: 'rgba(255,255,255,0.10)',
  accent: '#3987e5',
  onAccent: '#ffffff',
  accentTonal: '#1a2b41',
  onAccentTonal: '#86b6ef',
  series1: '#3987e5',
  series2: '#d95926',
  good: '#0ca30c',
  critical: '#d03b3b',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** 8dp grid. Section rhythm uses lg/xl; within-component gaps use xs/sm. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 12,
  /** Cards and grouped surfaces. */
  lg: 16,
  /** Buttons and chips — fully rounded, the Google idiom. */
  pill: 999,
} as const;

/** Minimum pressable size (dp). Glyphs may be smaller; the target may not. */
export const TOUCH_TARGET = 48;

/**
 * The four-step type scale. Nothing renders text outside these steps plus a
 * weight tweak; if a fifth step feels needed, the hierarchy is wrong.
 */
export const type: Record<'display' | 'title' | 'body' | 'label', TextStyle> = {
  /** Hero numerals. Always pair with fontVariant tabular-nums for figures. */
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, lineHeight: 38 },
  title: { fontSize: 22, fontWeight: '600', lineHeight: 28 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
};

/**
 * World Archery face colours, by score band. Fixed by the sport.
 * 10/9 gold, 8/7 red, 6/5 light blue, 4/3 black, 2/1 white.
 */
const WA_BANDS: Array<{ min: number; fill: string; stroke: string }> = [
  { min: 9, fill: '#ffd94a', stroke: '#c9a200' },
  { min: 7, fill: '#f65058', stroke: '#b32027' },
  { min: 5, fill: '#5fc9f3', stroke: '#1c8fc0' },
  { min: 3, fill: '#1a1a1a', stroke: '#4d4d4d' },
  { min: 1, fill: '#f5f5f2', stroke: '#9a9a94' },
];

/**
 * Fill for a scoring zone.
 *
 * Preset faces get their real colours. Custom targets have no canonical
 * colouring, so they fall back to a single-hue sequential ramp — magnitude is
 * the job, and one hue light-to-dark is the safe encoding for it.
 */
export function zoneColors(
  score: number,
  maxScore: number,
  isPreset: boolean,
): { fill: string; stroke: string } {
  if (isPreset) {
    const band = WA_BANDS.find((b) => score >= b.min);
    if (band) return { fill: band.fill, stroke: band.stroke };
  }

  // Sequential blue, step 150 (low score) through 600 (high score).
  const ramp = [
    '#b7d3f6',
    '#9ec5f4',
    '#86b6ef',
    '#6da7ec',
    '#5598e7',
    '#3987e5',
    '#2a78d6',
    '#256abf',
    '#1c5cab',
    '#184f95',
  ];

  const t = maxScore <= 0 ? 0 : Math.min(1, Math.max(0, score / maxScore));
  const fill = ramp[Math.round(t * (ramp.length - 1))];

  return { fill, stroke: 'rgba(0,0,0,0.25)' };
}

/** Arrow marks sit on top of every face colour, so they carry their own ring. */
export const arrowMark = {
  fill: '#ffffff',
  stroke: '#0b0b0b',
  missFill: '#d03b3b',
} as const;
