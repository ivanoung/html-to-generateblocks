# Project Scope — html-to-generateblocks

**Date:** 2025-06-21
**Status:** Authoritative

---

## Converter's job

Convert **clean HTML/CSS/JS sites** into WordPress paste-ready GenerateBlocks block markup.

"Clean" means:
- Standard HTML5 elements with class attributes
- CSS in external stylesheets or `<style>` blocks (not embedded in JS-injected Shadow DOM)
- JS for interactivity (preserved as-is, not converted)
- Layout via CSS classes or inline styles (not proprietary component systems)

## Supported input types

### Tailwind CSS sites (primary)
- Hand-written or framework-generated HTML using Tailwind utility classes
- `tailwind.config` present in `<script>` tag or as a separate file
- Utility classes mapped to GB inline `styles` (editor-editable)
- Unmapped classes (colors, state modifiers) stay as utility classes with CSS support

### Vanilla CSS sites
- Standard CSS classes (BEM, semantic, utility-like)
- No Tailwind config — CSS compilation step is skipped
- Classes preserved in `globalClasses`, CSS split into `styles-unique.css`
- No class-to-inline-style mapping (mapper only handles Tailwind patterns)

## Out of scope (need cleanup pass first)

These site types have proprietary component systems that require human cleanup before the converter can process them:

### Squarespace exports
- Component-scoped CSS using `[data-definition-name="website.components.button"]` attribute selectors
- 26+ component stylesheets (`website.components.button.styles.css`, etc.)
- `sqs-block` / `sqs-layout` / `sqs-row` / `sqs-col` grid system
- JS-injected content via Squarespace runtime
- **Cleanup needed**: normalize to standard HTML + class-based CSS before conversion

### Wix exports
- Proprietary component system
- JS-rendered content (not in static HTML)
- Complex inline styles with Wix-specific properties

### Webflow exports
- `w-node-*` / `w-col` / `w-row` grid system
- Webflow-specific interactions and animations
- Custom property system

## What the converter does NOT do

- **Does not clean messy markup** — garbage in, garbage out
- **Does not migrate content** between CMS platforms — input must be static HTML
- **Does not generate WordPress themes** — only block markup for pasting into the editor
- **Does not handle JavaScript frameworks** (React, Vue, Svelte) — input must be server-rendered HTML
- **Does not reverse-engineer proprietary systems** — Squarespace/Wix/Webflow need separate cleanup tools

## Decision rule

> If the input HTML has class attributes that map to CSS rules in standard stylesheets, the converter can process it. If styling depends on attribute selectors, JS injection, or proprietary component systems, it needs a cleanup pass first.

## Examples

| Input | Verdict |
|---|---|
| `inputs/mino/` (Tailwind) | ✅ Converts cleanly |
| `inputs/hkvc/` (Tailwind) | ✅ Converts cleanly |
| `inputs/TTN/` (Squarespace) | ⚠️ Runs but produces unstyled output — needs cleanup pass first |
| Hand-written HTML + styles.css | ✅ Converts cleanly |
| React app (client-rendered) | ❌ Out of scope — needs SSR snapshot first |
| Webflow export | ❌ Out of scope — needs cleanup pass |
