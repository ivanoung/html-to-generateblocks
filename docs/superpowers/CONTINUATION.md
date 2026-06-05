# Continuation Point — Fidelity-First Converter

**Date:** 2026-06-06  
**Status:** Nesting & Serialization — VERIFIED WORKING

---

## What Works

- **Nesting:** Structure preserved 1:1 from original HTML. No flattening, no section
  duplication. 10 sections → 10 sections in output.

- **Serialization:** WordPress paste-ready. All 11 fixtures pass (5 M1 + 6 fidelity).
  0 hard fails on Mino page conversion (311 blocks).

- **Class preservation:** Tailwind utility classes stored in `globalClasses[]` and
  rendered in HTML `class` attribute — verified WordPress round-trip safe.

- **Tailwind CSS compilation:** `--resolve-css` flag extracts tailwind.config from
  `<script>`, compiles via `npx tailwindcss@3`, outputs minified CSS file.

- **Mixed content handling:** Elements with inline text + block children → `core/html`
  fallback (avoids GB recovery). Semantic containers stay as element blocks.

- **`data-gb-wrap` markers:** Preprocessor wraps forms/style blocks/icons, walker
  converts to `core/html` blocks. Unwrapping prevents marker leaking into output.

## Known Gaps (what still needs work)

### Style Transfer (next priority)

Currently, all blocks have `"styles":{}` and `"css":""` — zero inline styles. The
visual fidelity comes 100% from Tailwind classes in `globalClasses`. This works but
has downsides:

1. **Editor preview:** GB block editor sidebar shows no controls for these styles
   since `styles` is empty. Users can't tweak padding/color/font through the UI.
2. **GlobalClasses bloat:** Each block carries 5-20 class tokens in `globalClasses`,
   making JSON verbose.
3. **No id-class on empty-styled blocks:** GB only injects `gb-element-{id}` when
   `styles` is non-empty. Without it, CSS targeting is harder.

Possible approaches to discuss:
- Resolve Tailwind classes to inline styles (style-resolver from old pipeline)
- Hybrid: resolve only panel properties (padding, color, display) to `styles`,
  keep the rest in `globalClasses`
- Accept current behavior (classes-only) and let user restyle in editor

### Fixed bugs from this session

- `data-gb-wrap` wrapper div leaked into rendered output (fixed: `$el.html()`)
- `$("div > *")` matched ALL div children causing 6x content duplication (fixed: use wrapper div only)
- Mixed content detection missed inline elements (fixed: `hasInlineElements` flag)
- Container tags (`<main>`) became text blocks (fixed: `SEMANTIC_CONTAINER_TAGS`)
- `makeCoreHtmlBlock` used innerHTML losing outer element (fixed: `makeCoreHtmlFallback`)

### Files to reference

- Converted output: `output/mino-gb-converted.html` (311 blocks, 1,684 lines)
- Tailwind CSS: `output/mino-tailwind.css`
- Spec: `docs/superpowers/specs/2026-06-05-fidelity-first-converter-design.md`
- Plan: `docs/superpowers/plans/2026-06-05-fidelity-first-converter-plan.md`
- Source: `src/core/dom-walker.ts`, `src/core/preprocessor.ts`, `src/core/orchestrator.ts`
