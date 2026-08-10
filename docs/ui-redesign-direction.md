# UI Redesign Direction — Minimal & Fluent

_2026-08-01 — direction for approval; implementation follows sign-off._

## Research, briefly

Current guidance for this category converges on a few points: remove anything
that doesn't directly help the user — calmer screens, intent over decoration,
whitespace used deliberately; for stat-heavy fitness/sport dashboards
specifically, a near-black dark base, **a single accent reserved for progress
and primary actions**, **oversized numerals for the stats themselves**, and
generous spacing. Material's mechanical rules underpin it: 8dp spacing grid,
48×48dp minimum touch targets with 8dp between, and a small type scale on a
4dp baseline.

That maps cleanly onto the Google/YouTube feel requested: flat surfaces, one
accent, big quiet type, no ornament.

## Principles (the whole direction in six lines)

1. **Numbers are the heroes.** Scores and grouping get oversized tabular
   numerals; labels shrink and recede to secondary ink.
2. **One accent.** The existing validated blue is reserved for the single
   primary action per screen and for live data. Everything else is neutral.
3. **Flat, hairline-separated surfaces.** No shadows, no gradients. Cards only
   where content genuinely groups (charts, the target face); lists become
   divider-less rows, Google-style.
4. **8dp grid, 48dp targets.** Section rhythm opens up to 24–32dp; every
   pressable reaches 48dp even where the glyph is smaller.
5. **A four-step type scale**, system font: Display (32, hero numbers),
   Title (22), Body (15), Label (12). Nothing outside it.
6. **Zero decorative motion.** Built-in navigation transitions and pressed-state
   feedback only.

## What this means per screen

- **Dashboard** — large-title header; range selector becomes one segmented
  control row; two headline stat tiles (best average, tightest group) with the
  secondary counts demoted to a single quiet line; charts unchanged in
  substance (their palette is already validated); session list becomes clean
  rows — date primary, meta secondary, score right-aligned and large;
  "Not synced" shrinks to a subtle dot + label.
- **New Session** — labeled sections on the 8dp grid; selection chips get a
  proper selected state (tonal fill) instead of full inversion; 48dp inputs;
  one full-width filled primary button.
- **Marking** — the stat strip loses its card chrome (three inline numbers),
  the face gets the width, and the four actions get hierarchy: Finish (filled),
  Next board (tonal), Undo/Photo (text). Interaction behavior itself is
  Task 5, not this task.
- **Session Detail** — header block with the big total; boards as light
  sections rather than heavy bordered cards.

## What deliberately does not change

- **Target-face colors** — fixed by World Archery; a "restyled" gold is wrong.
- **Chart palette and rules** — already validated for contrast and CVD.
- **Navigation structure and the screens' information contracts** — this is a
  reskin plus a small component kit, not an IA change.
- **Dark mode** — stays; the near-black base is already right.

## Implementation shape (small, reviewable)

1. Tokens: extend `theme.ts` with the type scale and component tokens.
2. A tiny internal kit: `Button` (filled/tonal/text), `Chip`, `StatTile`,
   `ListRow`, `SectionHeader`, `Screen` — six components, no library added.
3. Restyle the four screens on top of the kit, one commit per screen or pair.

Sources: [uidesignz — mobile UI best practices](https://uidesignz.com/blogs/mobile-ui-design-best-practices),
[canvasbuilder — fitness dashboard traits](https://canvasbuilder.co/blog/fitness-website-design-trends-2026),
[gisuser — mobile dashboard practices](https://gisuser.com/2026/07/best-practices-for-designing-effective-mobile-app-dashboards/),
[Material touch targets](https://support.google.com/accessibility/android/answer/7101858?hl=en),
[Material spacing methods](https://m2.material.io/design/layout/spacing-methods.html),
[Material 3 typography](https://m3.material.io/styles/typography/applying-type).
