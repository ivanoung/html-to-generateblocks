---
name: tailwind-mapping
description: The Tailwind utility → GenerateBlocks inline styles mapping surface — categories, what maps and what doesn't, and why. Load when adding a class mapping, debugging class coverage, or working in mapper/tailwind-layout-mapper/gb-whitelist/token-mapper.
triggers:
  - "tailwind mapping"
  - "class mapping"
  - "gb styles"
  - "globalClasses"
  - "tailwind-utilities"
  - "mapper"
edges:
  - target: context/architecture.md
    condition: when locating where the mapper lives in the pipeline
  - target: context/conventions.md
    condition: when checking the mapping conventions and the "what not to map" rules
  - target: patterns/add-a-tailwind-class-mapping.md
    condition: when adding a new Tailwind class → GB style mapping
  - target: patterns/debug-conversion-discrepancy.md
    condition: when verify.ts reports a mapping discrepancy
last_updated: 2026-06-21
---

# Tailwind → GB Mapping

This is the project's deepest domain. The mapping lives across three modules:
`src/core/tailwind-layout-mapper.ts` (layout utility → GB attributes,
exposes `tailwindLayoutToGbAttributes`),
`src/core/gb-whitelist.ts` (`isGbSupported(prop, value)` — can this property
go in GB inline `styles`?), and `src/core/token-mapper.ts` (Tailwind token →
CSS value). `src/cli/verify.ts` re-runs the mapper on each fallback block's
`globalClasses` and diffs against the processed block's `styles` to prove
fidelity.

## What Maps (→ GB inline `styles`)

| Category | Classes | Notes |
|---|---|---|
| Layout | `flex`, `grid`, `gap-*`, `items-*`, `justify-*`, `grid-cols-*` | |
| Spacing | `p-*`, `px-*`, `py-*`, `m-*`, `mx-auto`, `space-*` | |
| Sizing | `w-*`, `h-*`, `min-w, max-w, min-h, max-h`, fractions | |
| Positioning | `fixed, absolute, relative, sticky`, `top, left, right, bottom, inset`, `z-*` | |
| Borders | `border`, `border-t, border-r, border-b, border-l`, `border-dashed`, `rounded-*` | |
| Typography | `text-xs`→`text-9xl`, font-weight, `text-align`, `tracking-*`, `leading-*`, `uppercase`, `italic`, `underline` | |
| Effects | `shadow-*`, `opacity-*`, `backdrop-blur-*`, `rotate-*`, `scale-*` | |

Mapped classes are removed from `globalClasses` in the processed pass and
their properties are written to inline `styles` (and mirrored to `css` where a
GB editor panel exists).

## What Does NOT Map (stays in `globalClasses` + `tailwind-utilities.css`)

| Category | Classes | Why |
|---|---|---|
| Colors | `bg-*`, `text-*`, `border-*` with colors | Rely on `--tw-*` CSS custom properties and `/opacity` modifiers; GB `styles` cannot express CSS variables. |
| State | `hover:*`, `focus:*`, `group-hover:*`, `peer-*` | Pseudo-classes have no GB inline equivalent. |
| Transitions | `transition-*`, `duration-*`, `animate-*` | No direct CSS-property mapping in GB inline styles. |
| Config fonts | `font-display`, `font-mono` | Map to `font-family` values defined in the Tailwind config, which the mapper cannot read dynamically. |

This split is **by design** — do not try to inline the unmappable categories.

## Gotchas

- **Responsive cascade inversion** — Tailwind is mobile-first (`min-width`); GB is desktop-first (`max-width`). The inverter makes the largest breakpoint the base and turns smaller breakpoints into `@media(max-width: N-1px)` resets. Both `styles` and `css` carry the `@media` blocks.
- **`leading-*` + responsive `text-*`** — `text-*` sets `lineHeight` as a side effect; combined with a base `leading-*`, the V3 cascade picks the largest breakpoint value. See `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`.
- **CSS variable chains in transforms** — `--tw-translate-*` / `--tw-scale-*` chains are resolved (identity components simplified) before mapping.
- **Value normalization** — `rgb()` → `#hex`, `0px` → `0`.
- **Consolidation** — shared property sets are hashed into reusable `.gb-s-{hash}` classes; original source class names are preserved.
- **verify.ts skips `--tw-*` variable properties** when comparing, and re-runs the mapper on the class list (not the computed style) to avoid rem→px unit conversion issues.

## How to Verify a Mapping Change

1. Add/adjust a test in `tests/tailwind-layout-mapper.test.ts` (or the relevant tests/*.test.ts).
2. `node --import tsx --test tests/<file>.test.ts`.
3. Re-run `npx tsx src/cli/verify.ts --output output/<site>` — the class should now resolve to `styles` (drop out of `globalClasses` for mapped properties) with zero discrepancies.
4. `npx tsx src/cli/verify.ts --output output/<site> --coverage` to confirm CSS coverage.
