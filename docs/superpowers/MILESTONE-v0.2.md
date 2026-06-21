# Milestone: v0.2 — Dual-Output + Self-Verification + Live WP Audit

**Date:** 2025-06-21
**Tag:** v0.2 (not yet tagged)
**Previous milestone:** v0.1.0 (open-source release)

---

## What shipped in this milestone

### 1. Dual output structure
- `fallback/` — pixel-perfect reference with full `styles.css`
- `processed/` — editor-ready with mapped inline `styles` + split CSS
- Both generated simultaneously per conversion run
- Tests updated to point to `output/{project}/fallback/` paths

### 2. Tailwind class → GB inline style mapping (7 milestones)
- M1: Layout (display, flex, grid, gap, alignment, overflow, aspect-ratio)
- M2: Spacing (padding, margin, mx-auto)
- M3: Sizing (width, height, min/max, fractions)
- M4: Positioning (fixed/absolute/relative/sticky, top/left/right/bottom/inset, z-index)
- M5: Borders/Z-index/Opacity (rounded, border, border-style, border-sides)
- M6: Typography (font-size, font-weight, text-align, tracking, leading, uppercase, italic, underline)
- M8: Effects (shadow, backdrop-blur, rotate, scale)
- M7 (colors) and M9 (state modifiers) skipped by design

### 3. V3 All-Screens-centric responsive cascade
- Largest TW breakpoint → GB All Screens
- Downward `@media(max-width: N-1px)` resets
- 59-property reset table
- 66 dedicated tests in `tests/tailwind-layout-mapper.test.ts`

### 4. Mapper gap fixes (6 issues)
- `max-w-container` config-aware (reads from dossier instead of hardcoded 1280px)
- `uppercase`/`lowercase`/`capitalize` → `textTransform`
- `italic` → `fontStyle`, `underline` → `textDecoration`
- `leading-[N]` arbitrary bracket values → `lineHeight`
- `border-t/r/b/l` side-specific → `borderTopWidth`/etc
- `border-dashed/dotted/solid` → `borderStyle`
- Side-specific border resets in `PROPERTY_RESETS` (0px instead of `initial`)

### 5. Self-verification script (`src/cli/verify.ts`)
- Default mode: compares mapper output against processed styles (0 discrepancies = layout-faithful)
- `--coverage` mode: reports which DOM classes have CSS in `tailwind-utilities.css`
- Outputs `verify-report.json` and `verify-coverage.json`
- Verified across mino (10 pages), hkvc (1 page), TTN (11 pages) — 0 issues

### 6. styles + css sync fix (critical bug)
- **Root cause**: GB ignores `styles` field when `css` is non-empty
- **Symptom**: Digital Growth section lost 128px padding; form lost borders
- **Fix**: `mergeCssIntoLazyStyles()` merges `block.css` properties into `block.styles` (camelCase)
- **Followup fix**: `buildSyncedCss()` emits `@media` blocks in `css` for frontend responsiveness
  - Editor reads `styles` (with @media) — worked
  - Frontend reads `css` (was missing @media) — fixed
  - 74 blocks now have @media in css (was 0)

### 7. CSS splitter simplification
- `global-styles.json` and `global-styles-import.json` removed
- Structured styles merged into `styles-unique.css` for single-file debugging
- Setup directory now has just: `tailwind-utilities.css` + `styles-unique.css` + `rejected.json`

### 8. `expandColorPalettes()` fix
- Tailwind default colors (slate, gray, red, blue, etc.) no longer get shade expansion
- Custom colors (seafoam, surface, magenta, orange, fog) still get smart shade generation
- Matches original CDN compilation — unbiased, no opinionated shade injection

### 9. Open-source release (v0.1.0 → v0.2)
- Repo cleaned: 98 tracked files (down from 5,000+)
- MIT license
- `package.json` metadata (name: `html-to-generateblocks`)
- `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/` (bug + feature)
- Public repo: https://github.com/ivanoung/html-to-generateblocks

---

## What didn't ship (reverted)

### V3 cascade precedence fix (Phase A v1 + v2)
- **Goal**: `leading-[0.9]` should override `lg:text-8xl`'s `lineHeight` side effect
- **v1 attempt**: "base-exclusive family wins at all breakpoints" — broke `flex md:hidden`
- **v2 attempt**: "source-order position wins" — broke layout in subtle ways
- **Status**: reverted, learning documented at `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`
- **Future path**: hardcode known side-effect properties OR post-process against `styles.css`

### DOM-presence-based CSS filter (Phase B)
- **Goal**: preserve CSS for classes used in inner HTML (form children, SVG wrappers)
- **Status**: reverted along with Phase A — caused unexpected layout shifts
- **Future path**: re-apply alone (without Phase A) once Phase A is properly solved

---

## Current state

### Test suite
- 216/216 tests passing
- 66 layout mapper tests (V3 cascade)
- Pixel-parity test guards skip when input data is missing

### Projects verified
- **mino** (10 pages, Tailwind): 0 verifier issues
- **hkvc** (1 page, Tailwind): 0 verifier issues
- **TTN** (11 pages, Squarespace): 0 verifier issues (but no Tailwind = no class mapping; needs cleanup pass before meaningful conversion)

### Live WordPress deployment
- https://minodigital-2tcd.1wp.site/
- Last audited: 2025-06-21
- Most elements render identically to original (Hero H1, Services H2, CTA Button, Case Studies H2 — all computed styles match)
- Remaining visual gap: ~10% screenshot file size difference (theme CSS + font loading differences)

---

## Architecture reference

- **Main spec**: `docs/superpowers/specs/2025-06-20-all-screens-centric-cascade.md`
- **Architecture**: `docs/superpowers/architecture/gb-vs-tailwind-responsive-systems.md`
- **Latest fix spec**: `docs/superpowers/specs/2025-06-21-atmedia-css-sync.md`
- **Learning**: `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`

## Key files

| File | Purpose |
|---|---|
| `src/core/tailwind-layout-mapper.ts` | Mapper (70+ entries, V3 cascade, PROPERTY_RESETS) |
| `src/core/dom-walker.ts` | DOM walk + block creation + mapper integration |
| `src/core/orchestrator.ts` | Pipeline coordination, skipMapper/skipStylesCss flags |
| `src/core/serializer.ts` | Block → JSON, `mergeCssIntoLazyStyles`, `buildSyncedCss` |
| `src/core/tailwind-resolver.ts` | Tailwind CDN compilation, `expandColorPalettes` |
| `src/cli/index.ts` | CLI: convert, verify, CSS split, dual output |
| `src/cli/verify.ts` | Self-verification (default + `--coverage`) |
| `tests/tailwind-layout-mapper.test.ts` | 66 mapper/cascade tests |

---

## What's next (post-v0.2)

1. **V3 cascade precedence** — solve `leading-*` + responsive `text-*` conflict (see learning doc)
2. **DOM-presence CSS filter** — re-apply Phase B alone
3. **Color class strategy** — either GB Global Styles integration or accept class-based fallback
4. **Squarespace/Wix cleanup pass** — separate tool to normalize proprietary component systems before conversion
5. **Form/button styling** — currently relies on tailwind-utilities.css; may need GB-native form block support
