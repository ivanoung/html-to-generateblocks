---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
  - target: context/tailwind-mapping.md
    condition: when a decision concerns what is/isn't mapped
last_updated: 2026-06-21
---

# Decisions

<!-- HOW TO USE THIS FILE:
     Each decision follows the format below.
     When a decision changes: DO NOT delete the old entry.
     Mark it as superseded, add the new entry above it.
     The history must be preserved — this is the event clock. -->

## Decision Log

### Dual-output pipeline (fallback + processed)

**Date:** 2025-06 (v0.2)

**Status:** Active

**Decision:** Every `convert` emits two parallel outputs — fallback/ (all classes in `globalClasses`, `styles.css` present, pixel-perfect) and processed/ (mappable classes → inline `styles`, unmappable → `globalClasses` + split CSS).

**Reasoning:** GenerateBlocks' editor cannot render utility-class styles inline, so a purely-utility output is not editor-editable. A purely-inline output loses fidelity for classes that cannot be inlined (colours, states, transitions). The dual output lets processed/ be editor-ready while fallback/ is the fidelity reference that `verify.ts` diffs against.

**Alternatives considered:** Single inline-only output (rejected — loses fidelity for unmappable classes); single utility-only output (rejected — not editor-editable).

**Consequences:** Twice the output surface; `verify.ts` exists to prove the two stay equivalent on mappable properties.

---

### Tailwind utility classes → GB inline `styles` mapping

**Date:** 2025-06 (v0.2)

**Status:** Active

**Decision:** Mappable utility classes (layout, spacing, sizing, positioning, borders, typography, effects) convert to GB inline `styles`. Unmappable classes (colours using `--tw-*` vars, state modifiers, transitions/animations, config font families) stay as utility classes backed by `tailwind-utilities.css`.

**Reasoning:** GB inline `styles` cannot express CSS variables or pseudo-classes. Trying to inline them breaks the editor. Keeping them as utilities with a CSS stylesheet preserves the effect without lying to the editor.

**Alternatives considered:** Inline everything via raw CSS strings (rejected — GB editor rejects/loses editor-editability); drop unmappable classes entirely (rejected — loses fidelity).

**Consequences:** The mapping surface (`mapper.ts`, `tailwind-layout-mapper.ts`, `gb-whitelist.ts`, `token-mapper.ts`) is the project's deepest domain — see `context/tailwind-mapping.md`.

---

### Mobile-first (Tailwind) → desktop-first (GB) cascade inversion

**Date:** 2025-06 (v0.2)

**Status:** Active

**Decision:** The inverter maps Tailwind's mobile-first `min-width` cascade to GB's desktop-first model: the largest Tailwind breakpoint value becomes the GB "All Screens" base; downward breakpoints become `@media(max-width: N-1px)` resets. Both `styles` and `css` carry the `@media` blocks.

**Reasoning:** GenerateBlocks is desktop-first (max-width). Without inversion, the cascade would be backwards and responsive behaviour would not match the source.

**Alternatives considered:** Keep mobile-first and let GB override (rejected — GB's UI/model is desktop-first, mismatch causes incorrect rendering).

**Consequences:** Known edge case — `leading-*` combined with responsive `text-*` (which sets lineHeight as a side effect) causes the V3 cascade to pick the largest breakpoint value; see `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`.

---

### CSS split into `tailwind-utilities.css` + `styles-unique.css`

**Date:** 2025-06 (v0.2)

**Status:** Active

**Decision:** In the processed pass (`--split`), `styles.css` is split into `tailwind-utilities.css` (unmapped utility classes that stay in `globalClasses`) and `styles-unique.css` (structured styles + unique CSS).

**Reasoning:** Separates "utilities we could not inline" from "unique structural CSS", so each stylesheet has one job and the editor output stays clean.

**Alternatives considered:** Single combined stylesheet (rejected — mixes concerns, harder to audit coverage via `--coverage`).

**Consequences:** `verify.ts --coverage` reports CSS coverage per class against `tailwind-utilities.css`.

---

### tsx + ESM, no build step; tsc is typecheck-only

**Date:** 2025-06

**Status:** Active

**Decision:** Run TypeScript directly via `tsx`; `npm run build` runs `tsc` with `noEmit: true` purely as a typecheck. No bundler, no emitted dist/.

**Reasoning:** Prototype velocity — iterate without a compile barrier. Type safety still enforced via `tsc`.

**Alternatives considered:** Compile to dist/ and run from JS (rejected — extra step for no current benefit); drop `tsc` entirely (rejected — lose type checking).

**Consequences:** All commands are `npx tsx src/...`; tests run via `node --import tsx --test`. If a real build is ever needed, revisit.

---

### Headless Chromium (Playwright) for Tailwind resolution

**Date:** 2025-06

**Status:** Active

**Decision:** The Tailwind inliner loads the page in headless Chromium, lets the Tailwind CDN compile, and reads `document.styleSheets` to build the ClassRegistry.

**Reasoning:** The Tailwind CDN compiles stylesheets in the browser. Static analysis of the source cannot reproduce the final computed rules (responsive/state/compound selectors, CSS variable chains). A real browser is the only source of truth.

**Alternatives considered:** Static Tailwind compile server-side (rejected — cannot reproduce CDN runtime behaviour for arbitrary source sites).

**Consequences:** `npx playwright install chromium` is a prerequisite; convert is slower than a pure static pass.
