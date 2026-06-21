# Continuation Point — v0.2

**Date:** 2025-06-21
**Status:** Dual-output + self-verification + live WP audit complete
**Previous continuation:** 2026-06-06 (nesting & serialization)

---

## What works

- **Dual output**: `fallback/` (pixel-perfect reference with `styles.css`) + `processed/` (editor-ready with mapped inline styles)
- **Tailwind class → GB inline style mapping**: 7 milestones complete (layout, spacing, sizing, positioning, borders, typography, effects). Colors and state modifiers skipped by design.
- **V3 All-Screens-centric cascade**: largest TW breakpoint → GB All Screens, downward `@media(max-width)` resets. 66 tests.
- **styles + css sync**: `mergeCssIntoLazyStyles()` + `buildSyncedCss()` ensure editor and frontend render identically, including `@media` blocks (74 blocks now have @media in css, was 0).
- **Self-verification**: `verify.ts` (default + `--coverage` modes). 0 issues across mino/hkvc/TTN.
- **CSS splitter simplified**: single `styles-unique.css` (no more `global-styles.json` / `global-styles-import.json`).
- **216/216 tests passing**.

## Known gaps (active)

1. **`leading-*` + responsive `text-*` cascade** — base `leading-[0.9]` overridden by `lg:text-8xl`'s side-effect `lineHeight`. Reverted twice. See `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`.
2. **DOM-presence CSS filter** — classes in inner HTML may lose CSS. Reverted with Phase A. Re-apply alone later.
3. **Color classes need CSS fallback** — by design. Future: GB Global Styles integration.
4. **Squarespace/Wix/Webflow exports** — out of scope. Need cleanup pass first. See `docs/superpowers/PROJECT-SCOPE.md`.

## What's next

1. Solve V3 cascade precedence (side-effect property detection)
2. Re-apply DOM-presence CSS filter alone
3. Color class strategy (GB Global Styles or accept class-based fallback)
4. Squarespace/Wix cleanup pass (separate tool)
5. Form/button GB-native block support

## Key files

- **Milestone doc**: `docs/superpowers/MILESTONE-v0.2.md`
- **Project scope**: `docs/superpowers/PROJECT-SCOPE.md`
- **Known gaps**: `docs/superpowers/known-gaps.md`
- **Architecture**: `docs/superpowers/architecture/gb-vs-tailwind-responsive-systems.md`
- **Learning (cascade)**: `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`
- **Latest spec**: `docs/superpowers/specs/2025-06-21-atmedia-css-sync.md`

## Source files to reference

- `src/core/tailwind-layout-mapper.ts` — mapper (70+ entries, V3 cascade, PROPERTY_RESETS)
- `src/core/dom-walker.ts` — DOM walk + block creation + mapper integration
- `src/core/orchestrator.ts` — pipeline coordination
- `src/core/serializer.ts` — `mergeCssIntoLazyStyles`, `buildSyncedCss`
- `src/cli/index.ts` — CLI: convert, verify, CSS split, dual output
- `src/cli/verify.ts` — self-verification (default + `--coverage`)
- `tests/tailwind-layout-mapper.test.ts` — 66 mapper/cascade tests
