# Known Gaps — html-to-generateblocks

**Last updated:** 2025-06-21
**Milestone:** v0.2 (dual-output + self-verification + live WP audit)

---

## Current gaps (active)

| # | Gap | Impact | Status |
|---|---|---|---|
| 1 | **`leading-*` + responsive `text-*` cascade** — `leading-[0.9]` at base is overridden by `lg:text-8xl`'s side-effect `lineHeight` at All Screens | Headings render with wrong line-height on desktop (96px instead of 0.9) | Reverted twice, learning documented. Future: hardcode side-effect properties OR post-process against `styles.css` |
| 2 | **DOM-presence CSS filter** — classes used in inner HTML (form children, SVG wrappers) may lose CSS when globally filtered | Form inputs, browser mockup chrome lose styling | Reverted with Phase A. Future: re-apply alone once Phase A is solved |
| 3 | **Color classes need CSS fallback** — `bg-primary`, `text-slate/80`, `border-seafoam/40` stay as utility classes | Colors only render if `tailwind-utilities.css` is loaded | By design. Future: GB Global Styles integration OR accept class-based fallback |
| 4 | **Form/button styling depends on CSS** — forms and CTAs use color + state classes that can't be inlined | Forms render as plain text without CSS support | Depends on #3. May need GB-native form block support |
| 5 | **Squarespace/Wix/Webflow exports** — proprietary component systems don't convert cleanly | TTN (Squarespace) produces unstyled output | Out of scope. Needs separate cleanup pass before conversion |

## Non-critical (can defer)

| # | Gap |
|---|---|
| 6 | `clip-hex`, `clip-path`, `backdrop-filter` — unsupported CSS properties silently dropped |
| 7 | `group-hover/*`, `peer-checked/*`, `::before`, `::after` — pseudo-classes stripped |
| 8 | `@keyframes` animations — marquee animation stripped |
| 9 | `hover-shadow-md` — complex box-shadow with rgba not mapped |
| 10 | Font families from Tailwind config (`font-display`, `font-mono`) stay in `globalClasses` |

---

## Fixed in v0.2

| # | Gap | Fix |
|---|---|---|
| ✅ | `max-w-container` hardcoded to 1280px | Now reads config's `maxWidth.container` (1600px for mino) |
| ✅ | `uppercase`/`italic`/`underline` not mapped | Added `textTransform`, `fontStyle`, `textDecoration` entries |
| ✅ | `leading-[N]` arbitrary values not mapped | Added bracket-value pattern |
| ✅ | Side-specific borders (`border-t/r/b/l`) not mapped | Added `borderTopWidth`/etc entries + 0px resets |
| ✅ | `border-dashed` not mapped | Added `borderStyle` entries |
| ✅ | GB ignores `styles` when `css` is non-empty | `mergeCssIntoLazyStyles()` merges css into styles |
| ✅ | `@media` blocks missing from `css` field | `buildSyncedCss()` emits `@media` blocks for frontend |
| ✅ | `expandColorPalettes` too aggressive | Skip Tailwind default colors, keep custom color shade generation |
| ✅ | CSS splitter produced too many files | Merged structured styles into `styles-unique.css` |
| ✅ | No self-verification tool | `verify.ts` with default + `--coverage` modes |
| ✅ | CSS variable chains not resolved | `resolveCssVariables()` post-processor |
| ✅ | Embed blocks produce empty containers | `core/html` fallback for forms, SVGs, icons |
| ✅ | Section background styles missing | DOM-based style merge preserves inline styles |
| ✅ | Responsive breakpoint inversion | V3 All-Screens-centric cascade with 59-property reset table |

---

## Self-verification loop (built)

Previously a gap — now implemented:

1. `verify.ts` default mode: compares mapper output against processed styles (0 discrepancies = faithful)
2. `verify.ts --coverage` mode: reports DOM classes with/without CSS support
3. Verified across mino (10 pages), hkvc (1 page), TTN (11 pages) — 0 issues
4. Outputs `verify-report.json` and `verify-coverage.json`
