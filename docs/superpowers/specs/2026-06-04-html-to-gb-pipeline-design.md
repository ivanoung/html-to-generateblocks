# HTML → GenerateBlocks Conversion Pipeline

**Date:** 2026-06-04
**Status:** Design — pending review

---

## Overview

Extend the existing gb-converter prototype from "hand-crafted JSON fixtures → GB blocks" to a full **HTML-to-GB pipeline**. The key insight: the existing IR layer and serializer are already solid. The gap is everything *before* the IR.

Target input: HTML pages from aura.build (Tailwind CDN + inline `<style>` blocks + `<script>` config). Output: WordPress paste-ready GenerateBlocks + Core block markup.

Architecture: **LLM for semantic classification + Node.js for deterministic, repeatable conversion.** The LLM never touches GB internals — it only classifies sections and labels elements with semantic roles.

---

## Pipeline

```
INPUT: Raw HTML (Tailwind classes + <style> blocks + <script> config)
    │
    ▼
Phase 2: Structural Parse (Node.js)
    ├── Strip <nav>, <footer>, <script>, <style>, <link>
    ├── Identify section boundaries
    ├── Attach decorative dividers to adjacent sections
    ├── Extract <head> metadata (fonts, colors)
    └── Output: SectionSnippet[] + PageMeta
    │
    ▼
Phase 3: LLM Manifest (per section, raw HTML with classes)
    ├── Classify section kind
    ├── Label elements with roles + CSS selectors
    ├── Node.js validates selectors + retries (max 3)
    ├── Human review (optional, async)
    └── Output: SectionManifest per section
    │
    ▼
Phase 1: Style Resolution (per section, Tailwind CLI + style parser)
    ├── Extract tailwind.config from <script>
    ├── Run Tailwind CLI → class → declarations map
    ├── Parse <style> blocks → class → declarations map
    ├── Merge maps per element (CSS specificity order)
    ├── Invert responsive breakpoints (min-width → max-width)
    ├── Handle hover: map to GB, strip unsupported pseudo-classes
    └── Output: Resolved HTML (inline styles, no classes)
    │
    ▼
Phase 4: HTML + Manifest → IR (Node.js)
    ├── For each section, parse resolved HTML DOM
    ├── Use manifest selectors to find elements
    ├── Map roles → IR node types via role mapping table
    ├── Apply groups/templates/exceptions
    ├── Extract inline styles → styles + css + responsiveIntent
    └── Output: IRNode[]
    │
    ▼
Phase 5: Existing Pipeline (untouched)
    ├── ir-planner.ts → Block[]
    ├── serializer.ts → block markup
    ├── validator.ts → validation
    └── Output: paste-ready .html + report.json + manifest.json
```

Phases 1 and 2 are numbered as designed — **execution order** is Phase 2 → 3 → 1 → 4 → 5 because Phase 3 (LLM) needs raw HTML with CSS classes to write accurate selectors, and Phase 1 (style resolution) strips those classes.

---

## Phase 2: Structural Parse

### Input
Raw HTML page (full document with `<head>`, `<body>`, `<script>` blocks).

### Processing

1. **Strip non-content elements:** Remove `<nav>`, `<footer>`, `<script>`, `<style>`, `<link>` tags.

2. **Identify section boundaries (priority order):**
   - Priority 1: `<section>` tags with `id` attributes
   - Priority 2: `<div>` elements with structural styles (padding-top or padding-bottom ≥ 4rem/64px, min-height ≥ 50vh, or margin-top ≥ 4rem/64px). All unit types (px, rem, em, %) are evaluated after conversion to px at 16px base.
   - Priority 3: Fallback — wrap entire `<main>` as one section

3. **Attach decorative dividers:** Elements with `aria-hidden="true"` that sit between sections are attached to the preceding section as a footer decoration or the following section as a header decoration.

4. **Extract `<head>` metadata:**
   - Document `<title>`
   - Font families from `<link>` tags (Google Fonts)
   - Meta description

5. **De-duplicate repeating DOM:**
   - Detect identical adjacent sibling subtrees (marquee logo sets)
   - Keep first instance, record `repeat` in manifest notes

6. **Section-level sanity checks:**
   - Very short sections (< 2 elements) → merged with adjacent section
   - Pages with only nav/footer/scripts → fails with clear error
   - Element count logged for coverage validation later

### Output
```typescript
interface SectionSnippet {
  sectionId: string;       // id attribute or generated (e.g., "section-1")
  html: string;            // raw HTML fragment with classes intact
  elementCount: number;    // count of child elements
  isDecorative: boolean;   // true if this is a divider attached to adjacent section
}

interface PageMeta {
  title: string;
  fontFamilies: string[];  // array of font-family strings
  description: string;
}
```

### Edge Cases
- No `<section>` tags → wraps `<main>` as one section
- Nested sections → picks outermost only
- Broken HTML → best-effort parsing, log parse errors

---

## Phase 3: LLM Manifest Generation

### Input
One `SectionSnippet` (raw HTML with CSS classes intact, no nav/footer/scripts).

### LLM Prompt

```
You are an HTML section classifier. Analyze the section HTML and output a
section manifest. Follow these rules exactly:

1. Identify the section KIND: hero | card-grid | stats-row | testimonial-grid |
   data-rows | checklist | feature-grid | contact-form | logo-marquee |
   text-block | generic

2. For each meaningful element, determine its ROLE and write the EXACT CSS
   selector from the HTML. Copy the class string verbatim — do not simplify.
   If the element has an id, use it. If neither class nor id exists, use the
   tag name with :nth-of-type(). Never invent selectors.

3. Group elements that form a visual row/container together using "groups".

4. Use "templates" with "repeat": "siblings" for repeating patterns.
   Use "exceptions" for items that break the pattern.

5. Mark purely decorative elements (background SVGs, animation wrappers) as
   "decoration" with "action": "strip".

6. Mark elements too complex to convert as "embed".

7. After writing the manifest, add a "coverage" field: estimate what percentage
   of the section's meaningful elements you captured (0-100).

8. Output ONLY raw JSON — no markdown fences, no explanation.
   Format:
{
  "sectionId": "<id attribute of section element>",
  "kind": "...",
  "layout": "single-column" | "two-column" | "grid" | "flex-row" | "form",
  "elements": [
    { "selector": "<exact CSS selector>", "role": "<role>" }
  ],
  "groups": [
    {
      "selector": "<selector for group container>",
      "role": "<group role>",
      "elements": [ ... ]
    }
  ],
  "templates": [
    {
      "selector": "<selector of first instance>",
      "role": "<element role>",
      "elements": [ ... ],
      "repeat": "siblings"
    }
  ],
  "exceptions": [
    { "selector": "...", "role": "...", "elements": [ ... ] }
  ],
  "notes": {
    "decorationEls": ["<selector>"],
    "unsupportedFeatures": ["<description>"],
    "warnings": ["<description>"]
  },
  "coverage": 85
}
```

### Available Roles

**Element roles:** `section-label`, `heading`, `eyebrow`, `body`, `cta-button`, `cta-link`, `image`, `icon`, `iconify`, `avatar`, `avatar-stack`, `star-rating`, `social-proof`, `card`, `card-heading`, `card-body`, `card-footer`, `card-step-label`, `checklist-item`, `testimonial`, `testimonial-quote`, `testimonial-name`, `testimonial-title`, `testimonial-company`, `form-field`, `form-radio-group`, `form-textarea`, `form-submit`, `embed`, `decoration`

**Group roles:** `cta-row`, `checklist`, `card-grid`, `feature-card-grid`, `testimonial-grid`, `social-proof-group`, `avatar-row`, `star-row`

### Node.js Validation + Retry Loop

```
Parse LLM output:
  ├── Strip markdown fences (```json ... ```) if present
  ├── JSON parse error → retry: "Output was not valid JSON. Output ONLY raw JSON."
  ├── Schema validation (required fields: sectionId, kind, elements, coverage)
  ├── Selector check: querySelector() on each selector against section HTML
  │   ├── 0 matches → collect all misses → retry with the missed selectors PLUS
  │   a list of ALL id attributes and unique class tokens found in the section HTML.
  │   Instruction: "These selectors did not match: [...]. Available ids: [...]. Available unique class tokens: [...].
  │   Replace each missed selector with one from the available list. If no suitable selector exists, use the
  │   element's tag name with :nth-of-type()."
  │   ├── >1 matches → log warning, use first match
  │   └── All matched → OK
  ├── Coverage check:
  │   ├── coverage ≥ 70% → accept
  │   └── coverage < 70% → accept but flag for human review
  └── Max 3 retries total per section
```

### Human Review (optional, async)

Manifest saved to `output/<page>-manifest.json`. An override file at `output/<page>-manifest-overrides.json` can fix:
- Wrong section kind: `{ "sectionId": "hero", "kind": "generic" }`
- Wrong selectors: `{ "sectionId": "hero", "elements": [{ "selector": "h1", "role": "heading" }] }` (replaces all elements for that section)
- Add missing elements: use `_add` key

Overrides are merged automatically before Phase 4.

### Type Definitions

```typescript
type SectionKind =
  | "hero" | "card-grid" | "stats-row" | "testimonial-grid"
  | "data-rows" | "checklist" | "feature-grid" | "contact-form"
  | "logo-marquee" | "text-block" | "generic";

type ElementRole =
  | "section-label" | "heading" | "eyebrow" | "body"
  | "cta-button" | "cta-link" | "image" | "icon" | "iconify"
  | "avatar" | "avatar-stack" | "star-rating" | "social-proof"
  | "card" | "card-heading" | "card-body" | "card-footer" | "card-step-label"
  | "checklist-item"
  | "testimonial" | "testimonial-quote" | "testimonial-name"
  | "testimonial-title" | "testimonial-company"
  | "form-field" | "form-radio-group" | "form-textarea" | "form-submit"
  | "embed" | "decoration";

type GroupRole =
  | "cta-row" | "checklist" | "card-grid" | "feature-card-grid"
  | "testimonial-grid" | "social-proof-group" | "avatar-row" | "star-row";

interface ManifestElement {
  selector: string;
  role: ElementRole;
  action?: "strip";  // only valid for role: "decoration"
}

interface ManifestGroup {
  selector: string;
  role: GroupRole;
  elements: ManifestElement[];
}

interface ManifestTemplate {
  selector: string;
  role: ElementRole;
  elements: ManifestElement[];
  repeat: "siblings";
}

interface ManifestNotes {
  decorationEls: string[];
  unsupportedFeatures: string[];
  warnings: string[];
}

interface SectionManifest {
  sectionId: string;
  kind: SectionKind;
  layout: "single-column" | "two-column" | "grid" | "flex-row" | "form";
  elements: ManifestElement[];
  groups?: ManifestGroup[];
  templates?: ManifestTemplate[];
  exceptions?: ManifestElement[];
  notes: ManifestNotes;
  coverage: number; // 0-100
}
```

---

## Phase 1: Style Resolution

### Input
One section's raw HTML (Tailwind classes + `<style>` blocks) + the page's `<script>` tailwind config.

### Processing

1. **Extract tailwind.config** from `<script>tailwind.config = {...}</script>` → write to temp file `tailwind.config.cjs`.

2. **Run Tailwind CLI:**
   ```bash
   npx tailwindcss -i <temp-input.css> -o <temp-output.css> --content <temp-content.html> --minify
   ```
   Where `input.css` contains `@tailwind base; @tailwind components; @tailwind utilities;`, and `content.html` is the section HTML.

3. **Parse `<style>` blocks** in the section HTML → build a class → declarations map using a CSS parser.

4. **Merge maps with CSS specificity:**
   - For each element, collect Tailwind-resolved declarations and custom-style declarations
   - Custom styles override Tailwind where both apply the same property
   - Output: per-element map of `property → value`

5. **Invert responsive breakpoints:**
   - Tailwind uses `min-width` (mobile-first). GB uses `max-width` (desktop-first).
   - `lg:pt-48` → `@media(min-width:1024px) { padding-top: 12rem }`
   - Invert to: base style = `padding-top: 12rem`, override at `@media(max-width:1023px)` = `padding-top: 8rem` (the non-lg value)
   - Breakpoint mapping: `sm`=640, `md`=768, `lg`=1024, `xl`=1280

6. **Pseudo-class handling:**
   - `:hover` → map to GB hover styles in `css` field
   - `:focus` → map to GB hover styles (applied on focus within GB)
   - `group-hover/*`, `peer-checked/*` → strip with warning
   - `::before`, `::after` → strip with warning

7. **Produce resolved HTML:**
   - Replace `class="..."` with `style="property:value;..."` on every element
   - Keep `id`, `aria-*` attributes
   - Strip all `class` attributes
   - Preserve `<svg>` and `<iconify-icon>` elements as-is

### Output
Resolved HTML string — every element has inline styles, no CSS classes, ready for style-parser.ts.

### Error Handling
- Missing tailwind.config in `<script>` → skip Tailwind resolution, use only `<style>` block parsing + inline `style=""` attributes. Log warning.
- Tailwind CLI not installed → log clear install instructions, skip resolution.
- Tailwind CLI returns error → log error, skip resolution for that section.

---

## Phase 4: HTML + Manifest → IR Conversion

### Input
Resolved HTML (inline styles only) + SectionManifest for one section.

### Processing

1. **Parse resolved HTML** into a DOM tree using a lightweight HTML parser (e.g., `cheerio` or `jsdom`).

2. **Build IR section wrapper:** Create a `section` IRNode. Set `layoutIntent` from manifest `layout` field. Extract background styles from the section root element.

3. **For each element in the manifest** (in order):
   - Run `querySelector(manifest.selector)` on the section DOM
   - If found: extract the DOM element, call `style-parser.ts` on its `style` attribute → `{ styles, css }`
   - Map `manifest.role` to IR node type via the role mapping table
   - Create IRNode with appropriate `nodeType`, `layoutIntent`, `fallbackPolicy`
   - Handle responsive: if the styles include media query keys, translate to `responsiveIntent`

4. **For each group in the manifest:**
   - Find the group container by selector
   - Create a `container` IRNode with the group's `layoutIntent`
   - Process group `elements` as children of this container
   - For layout groups (`cta-row`, `checklist`, `card-grid`), extract flex/grid styles from the container element

5. **For each template:**
   - Find all siblings matching the template pattern (all direct children of the template's parent)
   - For each sibling: apply the template's element roles and selectors
   - Exceptions replace the template for specific siblings

6. **For exceptions:** Process like elements but override the template's element list.

7. **Style extraction** per element:
   - Parse `style="property:value;..."` → extract each declaration
   - Feed through existing `style-parser.ts` → `{ styles: { camelCase }, css: "kebab-case" }`
   - Properties with GB editor panel equivalents go to BOTH `styles` and `css`
   - Properties without panel equivalents go to `css` only

8. **Handle `embed` role:**
   - Create IRNode with `nodeType: "container"`, `fallbackPolicy: "core"`
   - Serialize the raw resolved HTML for that element into `core/html` content
   - No style extraction for embedded elements — preserve as-is

9. **Handle `decoration` role:** Skip entirely — do not create an IRNode.

### Role → IR Mapping Table

| Manifest role | IR `nodeType` | IR `layoutIntent` | IR `fallbackPolicy` | Notes |
|---|---|---|---|---|
| `heading` | `heading` | — | `generateblocks` | Tag from HTML preserved |
| `eyebrow` | `paragraph` | — | `generateblocks` | |
| `section-label` | `paragraph` | — | `generateblocks` | |
| `body` | `paragraph` | — | `generateblocks` | |
| `cta-button` | `button-link` | — | `generateblocks` | `<button>` or `<a>` |
| `cta-link` | `button-link` | — | `generateblocks` | Inline text CTA |
| `image` | `image` | — | auto-detect | Captioned → `core/image`, else → `generateblocks/media` |
| `icon` | `icon` → `core/html` | — | `core` | Inline SVG preserved |
| `iconify` | → `core/html` | — | `core` | Web component, preserved as-is |
| `avatar` | `image` | — | `core` | Individual avatar image |
| `avatar-stack` | `container` | `row` | `generateblocks` | Flex row of avatars |
| `star-rating` | `container` → `core/html` | `row` | `core` | SVGs + text preserved |
| `social-proof` | `container` | `row` | `generateblocks` | Wraps avatars + rating |
| `card` | `container` | `stack` | `generateblocks` | |
| `card-heading` | `heading` | — | `generateblocks` | |
| `card-body` | `paragraph` | — | `generateblocks` | |
| `card-footer` | `container` | `row` | `generateblocks` | |
| `card-step-label` | `paragraph` | — | `generateblocks` | |
| `checklist-item` | `container` | `row` | `generateblocks` | Icon + text |
| `testimonial` | `container` | `stack` | `generateblocks` | |
| `testimonial-quote` | `paragraph` | — | `generateblocks` | |
| `testimonial-name` | `paragraph` | — | `generateblocks` | |
| `testimonial-title` | `paragraph` | — | `generateblocks` | |
| `testimonial-company` | `paragraph` | — | `generateblocks` | |
| `form-field` | → `core/html` | — | `core` | GB has no native form support |
| `form-radio-group` | → `core/html` | — | `core` | |
| `form-textarea` | → `core/html` | — | `core` | |
| `form-submit` | `button-link` | — | `generateblocks` | If it's a `<button>` |
| `embed` | `container` → `core/html` | `wrapper` | `core` | |
| `decoration` | stripped | — | — | No node created |

### Group → Layout Mapping

| Manifest group `role` | IR container `layoutIntent` |
|---|---|
| `cta-row` | `row` |
| `checklist` | `stack` |
| `card-grid` | `grid` |
| `feature-card-grid` | `grid` |
| `testimonial-grid` | `grid` |
| `social-proof-group` | `row` |
| `avatar-row` | `row` |
| `star-row` | `row` |

### Output
`IRNode[]` — one or more IR nodes for the section, ready for `ir-planner.ts`.

---

## Phase 5: Existing Pipeline (Untouched)

### Processing
1. Feed `IRNode[]` → `ir-planner.ts` → `Block[]`
2. Feed `Block[]` → `serializer.ts` → WordPress block markup
3. Feed `Block[]` → `validator.ts` → validation report

No changes to these modules. The IR format is the stable boundary.

---

## Output Files

For each converted page, generate in `output/`:

| File | Contents |
|---|---|
| `<page-name>.html` | Paste-ready WordPress block markup |
| `<page-name>-manifest.json` | Full manifest per section (for audit/review) |
| `<page-name>.report.json` | Extended validation report |

### Report Schema (extended from existing)

```typescript
interface PageReport {
  page: string;
  sectionCount: number;
  sections: SectionReport[];
  overallStatus: "pass" | "partial" | "fail";
  patternConversionRate: number; // % sections converted as patterns vs generic
}

interface SectionReport {
  sectionId: string;
  kind: string;
  mode: "pattern" | "generic" | "embed" | "rejected";
  coverage: number;
  selectorsMatched: number;
  selectorsTotal: number;
  blockCount: number;
  hardFails: HardFail[];
  warnings: Warning[];
}
```

---

## Error Recovery

### Section-level recovery

| Problem | Action |
|---|---|
| LLM manifest fails after 3 retries | Section → `core/html` embed of resolved HTML |
| Section kind is `generic` | Best-effort: heading → GB heading, rest → `core/html` |
| Selector misses after retries | Skip element, log warning, continue |
| `embed` role | Wrap in `core/html`, preserve inline-styled HTML |
| Tailwind CLI unavailable | Skip resolution, pass through raw HTML, log warning |
| Parse errors in `<style>` blocks | Skip that block, continue with remaining styles |

### Page-level recovery

| Problem | Action |
|---|---|
| No sections detected | Fail with clear error, suggest manual section markup |
| All sections fail | Output file contains only `core/html` embeds, report shows full failure |
| Page is not HTML | Fail immediately with format error |

---

## Caching

- **Style resolution cache:** Keyed by `hash(tailwind.config + section HTML)`. The tailwind config is the same for all sections on a page, so it's extracted once and reused. Stored in `output/.cache/`. Avoids re-running Tailwind CLI for unchanged sections.
- **Manifest cache:** Not cached by default (LLM output varies). An opt-in flag `--cache-manifest` stores manifest to `output/.cache/` keyed by `hash(section HTML)`.

---

## Testing Strategy

### Deterministic tests (existing pattern)
- Unit tests for `style-parser.ts`, `serializer.ts`, `validator.ts` — unchanged.
- Unit tests for structural parse: section boundary detection, nav/footer stripping, `<head>` extraction.
- Unit tests for role mapping table: every role maps to a valid IRNodeType.
- Unit tests for manifest validation: schema check, selector coverage check, retry logic.

### LLM-dependent tests
- **Not deterministic output tests.** Do not assert exact LLM JSON.
- Instead: snapshot tests on manifest format — validate schema, check selectors exist in fixture HTML, check coverage ≥ threshold.
- Fixture pages (small, representative) with expected manifest shape.

### Integration tests
- End-to-end: fixture HTML → pipeline → validated GB blocks.
- Regression: existing 22+ fixtures still pass (no change to existing pipeline).

---

## CLI Extensions

New commands added to `src/cli/index.ts`:

```bash
# Full pipeline
npx tsx src/cli/index.ts convert --input page.html --output page-gb.html

# Individual phases
npx tsx src/cli/index.ts parse-structure --input page.html
npx tsx src/cli/index.ts resolve-styles --input section.html --output section-resolved.html
npx tsx src/cli/index.ts manifest:generate --input section.html
npx tsx src/cli/index.ts manifest:review --page <name>
npx tsx src/cli/index.ts manifest:apply-override --page <name> --section hero --key kind --value generic

# Existing commands (unchanged)
npx tsx src/cli/index.ts fixtures:run-all
npx tsx src/cli/index.ts fixtures:run <name>
npx tsx src/cli/index.ts regression
```

---

## New Source Files

```
src/
├── core/                       # Existing (unchanged)
│   ├── types.ts
│   ├── ir-node.ts
│   ├── id-generator.ts
│   ├── style-parser.ts
│   ├── mapper.ts
│   ├── ir-planner.ts
│   ├── serializer.ts
│   ├── validator.ts
│   ├── hero-scorer.ts
│   └── hero-converter.ts
├── runner/
│   └── run-fixture.ts          # Existing (unchanged)
├── converter/                   # NEW
│   ├── structure-parser.ts      # Phase 2: section boundary detection
│   ├── llm-manifest.ts          # Phase 3: LLM prompt + response parsing + retry
│   ├── style-resolver.ts        # Phase 1: Tailwind CLI wrapper + style merging
│   ├── html-to-ir.ts            # Phase 4: HTML DOM + manifest → IRNode[]
│   ├── role-mapper.ts           # Phase 4: role → IR mapping table
│   └── pipeline.ts              # Orchestrator: runs phases in order
├── cli/
│   └── index.ts                 # Extended: new commands
└── types/
    └── manifest.ts              # NEW: Manifest type definitions + SectionKind union
```

---

## Dependencies (new)

| Package | Purpose |
|---|---|
| `cheerio` or `jsdom` | Lightweight HTML parsing for Phase 4 |
| `tailwindcss` + `@tailwindcss/cli` | Phase 1 style resolution |
| `css` (npm) | CSS parser for `<style>` blocks |
| LLM API client | Phase 3 manifest generation (provider-agnostic interface) |

---

## Non-Goals (explicitly excluded from this milestone)

- Converting `<nav>` navigation menus or `<footer>` elements
- Handling JavaScript-driven content (SPAs, React rendered)
- Converting `<form>` elements to native GB form support (GB has none)
- Converting CSS animations (`@keyframes`) to GB equivalents
- Full pixel-perfect replication of complex `clip-path` or `backdrop-filter` effects
- Support for non-Tailwind CSS frameworks (Bootstrap, custom CSS-only)
- Multi-page conversion (one page per run)
