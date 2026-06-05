# Known Gaps — HTML-to-GB Pipeline

**Date:** 2026-06-05
**Milestone:** M3 — First end-to-end conversion (MINO index page)

## Next Priorities

| # | Gap | Impact | Suggested Fix |
|---|---|---|---|
| 1 | **CSS variable chains not resolved** — Tailwind v3 outputs `rgb(30 41 59/var(--tw-text-opacity,1))` instead of `#1E293B`. These variables don't exist in WordPress. | Colors render incorrectly or as fallbacks | Post-process resolved styles to replace `var(--tw-*)` with computed values from the Tailwind config's opacity defaults |
| 2 | ~~**Embed blocks produce empty containers**~~ — **FIXED** | ~~Complex sections lost~~ | Added `planCoreHtml()` in `ir-planner.ts`, exception processing in `html-to-ir.ts`. Code-diff, forms, iconify icons now produce `core/html` blocks with inline-styled content. |
| 3 | **Logo-marquee not detected** — `<div id="client-logo-marquee">` isn't a `<section>`, so the structure parser misses it. Priority-2 heuristic (padding ≥ 64px) also misses it because it uses Tailwind classes, not inline styles. | Logo marquee section excluded from conversion | Run structure parser AFTER style resolution so inline styles exist for heuristic detection. Or detect by `id` attribute on non-section elements with significant child content. |
| 4 | **`iconify-icon` web components** — These render via client-side JS and have no text content. Core/html wrapping needs the SVG string, which requires headless browser extraction. | Icons in feature cards and marquee lost | Either: (a) extract SVG via headless browser, or (b) mark iconify elements as `decoration` (strip) and replace with emoji/unicode icons |
| 5 | **SVG star ratings** — Five `<svg>` elements for stars + text → `core/html`. Better approach: convert to a single container with text content. | Star ratings become raw SVG blobs | Add a `star-rating-text` role that extracts just the "from 20 reviews" text and discards star SVGs |
| 6 | **Section background styles** — The wrapping `section` container gets `"styles":{}` with no background, even when the original section has complex backgrounds (blueprint grids, gradients). | Sections look unstyled | Extract section root element styles during IR conversion and apply to the section wrapper IRNode |
| 7 | **Responsive breakpoint inversion not implemented** — `lg:pt-48` resolved as base style, but non-responsive equivalent (mobile `pt-32`) isn't captured. | Desktop-first values applied at all breakpoints | After resolution, compare resolved class declarations to detect responsive overrides and build `responsiveIntent` |

## Non-critical (can defer)

| # | Gap |
|---|---|
| 8 | `clip-hex`, `clip-path`, `backdrop-filter` — unsupported CSS properties silently dropped |
| 9 | `group-hover/*`, `peer-checked/*`, `::before`, `::after` — pseudo-classes stripped |
| 10 | `@keyframes` animations — marquee animation stripped |
| 11 | `hover-shadow-md` — complex box-shadow with rgba not mapped |
| 12 | `blueprint-bg` — background-image patterns not mapped because they use CSS classes, not inline styles |
