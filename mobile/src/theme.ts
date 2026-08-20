/**
 * Design tokens — "scoreboard gold".
 *
 * The structure stays minimal (four type steps, 8dp grid, 48dp targets); the
 * personality comes from what archery already owns: the bullseye gold as the
 * brand accent, a characterful display face (Space Grotesk) for numerals and
 * headings, tactile pressed-edge buttons, and the concentric-ring roundel as
 * the score motif. Direction: docs/ui-redesign-direction.md.
 *
 * Chart series colours are the validated data-viz palette and are NOT the
 * brand accent: gold is identity and actions; blue/orange remain data, where
 * they passed the contrast/CVD validator against both surfaces.
 *
 * Target-face colours depict a physical object whose colours are fixed by
 * World Archery. A restyled 10 ring would be wrong in the way a green stop
 * sign is wrong.
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
  /** Brand gold. Fills: primary action, roundel ring, selection. */
  accent: string;
  /** Darker gold for the pressed bottom edge of tactile buttons. */
  accentEdge: string;
  /**
   * Gold for borders and rings that carry meaning (selection, the loupe, the
   * roundel). Raw `accent` is only 1.8:1 on the light surface — invisible in
   * the bright sunlight this app is used in. This step clears the 3:1
   * non-text minimum while still reading as gold.
   */
  accentBorder: string;
  /** Ink on a gold fill — warm near-black, never white (gold is light). */
  onAccent: string;
  /**
   * Gold as TEXT (links, text buttons). Deliberately darker than `accent`:
   * raw gold fails contrast as small text on the light surface.
   */
  accentText: string;
  /** Quiet gold-tinted fill for selected chips and tonal buttons. */
  accentTonal: string;
  onAccentTonal: string;
  /** Score trend. Chart data keeps its validated blue — not the brand gold. */
  series1: string;
  /** Grouping trend. Never shares an axis with series1 — separate charts. */
  series2: string;
  good: string;
  critical: string;
}

const light: Palette = {
  // Warm paper, not clinical white — the light mode should feel like a
  // scorecard, not a spreadsheet.
  surface: '#fffdf7',
  page: '#f7f4ec',
  textPrimary: '#191713',
  textSecondary: '#57534a',
  // 4.9:1 on the page, 5.3:1 on the surface. The previous #8c877b measured
  // 3.3:1 and sat on every caption in the app.
  textMuted: '#6f6a5e',
  gridline: '#e6e1d4',
  baseline: '#c9c3b3',
  border: 'rgba(25,23,19,0.12)',
  accent: '#f0b429',
  accentEdge: '#c68e17',
  accentBorder: '#b2851e',
  onAccent: '#231a04',
  accentText: '#8a6100',
  accentTonal: '#f9ecca',
  onAccentTonal: '#6e4e00',
  series1: '#2a78d6',
  series2: '#eb6834',
  good: '#006300',
  // 4.5:1 against the page, which is the harsher of the two light backgrounds
  // — #d03b3b cleared the surface but not the page.
  critical: '#cc3a3a',
};

const dark: Palette = {
  surface: '#1b1a17',
  page: '#0e0d0b',
  textPrimary: '#f7f4ec',
  textSecondary: '#c6c1b4',
  textMuted: '#8c877b',
  gridline: '#2d2b26',
  baseline: '#3a3831',
  border: 'rgba(247,244,236,0.12)',
  accent: '#f0b429',
  accentEdge: '#b07f12',
  // Gold already clears 9:1 on the dark surface; no separate step needed.
  accentBorder: '#f0b429',
  onAccent: '#231a04',
  accentText: '#f5c64f',
  accentTonal: '#332a12',
  onAccentTonal: '#f0c862',
  series1: '#3987e5',
  series2: '#d95926',
  good: '#0ca30c',
  // Lightened from #d03b3b, which measured 3.6:1 against the dark surface.
  critical: '#d85a5a',
};

/** Both palettes, so contrast can be asserted in tests rather than reviewed. */
export const PALETTES = { light, dark } as const;

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
  /** Buttons — chunky, confident corner, deliberately not a pill. */
  control: 14,
  /** Cards and grouped surfaces. */
  lg: 16,
  /** Chips and roundels. */
  pill: 999,
} as const;

/** Minimum pressable size (dp). Glyphs may be smaller; the target may not. */
export const TOUCH_TARGET = 48;

/**
 * The display face. Loaded in App.tsx via expo-font; headings and hero
 * numerals wear it, body text stays in the system face for reading comfort.
 */
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  heading: 'SpaceGrotesk_600SemiBold',
  medium: 'SpaceGrotesk_500Medium',
} as const;

/**
 * The four-step type scale. Nothing renders text outside these steps plus a
 * weight tweak; if a fifth step feels needed, the hierarchy is wrong.
 */
/*
 * The type scale.
 *
 * Five steps, and the gaps between them are the point. Before this the
 * dashboard rendered six different figures at the same 32px — the handicap,
 * the group size, the number of tens, and the word "centred" all carried
 * identical weight, so nothing read as more important than anything else and
 * the screen had no focus. A scale that does not separate things is not a
 * scale.
 *
 * `hero` exists for exactly one number per screen. If two things on a screen
 * are hero, neither is.
 */
export const type: Record<
  'hero' | 'display' | 'title' | 'body' | 'label',
  TextStyle
> = {
  /** The single most important figure on a screen. Never more than one. */
  hero: {
    fontSize: 60,
    fontFamily: fonts.display,
    fontWeight: '700',
    letterSpacing: -2,
    lineHeight: 62,
  },
  /** Supporting figures. Deliberately less than half the hero's size. */
  display: {
    fontSize: 26,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    lineHeight: 31,
  },
  title: { fontSize: 20, fontFamily: fonts.heading, lineHeight: 26 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  /** Uppercase in use, which is why it carries tracking. */
  label: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    letterSpacing: 0.5,
  },
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
  // `as const` so the first element is known to exist and can be the fallback.
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
  ] as const;

  // NaN would survive the clamp — Math.min/max propagate it — and index the
  // ramp with NaN, yielding undefined and a zone drawn with no fill at all.
  const ratio = maxScore <= 0 || !Number.isFinite(score) ? 0 : score / maxScore;
  const t = Math.min(1, Math.max(0, ratio));
  const fill = ramp[Math.round(t * (ramp.length - 1))] ?? ramp[0];

  return { fill, stroke: 'rgba(0,0,0,0.25)' };
}

/** Arrow marks sit on top of every face colour, so they carry their own ring. */
export const arrowMark = {
  fill: '#ffffff',
  stroke: '#0b0b0b',
  missFill: '#d03b3b',
} as const;
