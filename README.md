# GenerateBlocks Converter — Prototype

A TypeScript prototype that converts HTML pages and JSON fixtures into
WordPress paste-ready GenerateBlocks & Core block markup, validates against
known "Attempt Recovery" rules, and writes files for manual verification in
the WordPress editor.

> **Status:** Intent-based style transfer pipeline — 18 fixtures (5 M1, 6
> fidelity, 6 preprocessor/dom-walk, 1 tailwind-inliner) verified across
> GenerateBlocks Element/Text/Media/Shape + WordPress Core fallbacks.
> The `convert` command processes full HTML pages (e.g. `inputs/mino/index.html`)
> with automatic Tailwind CSS resolution: compiled CSS rules are parsed from
> `document.styleSheets`, mapped to elements by class name, and consolidated
> into reusable Global Styles classes. No browser defaults, no noise.

---

## Directory Layout

```
.
├── fixtures/              # Input fixture JSON files (17 total)
│   ├── text-stack.json            # M1 — section + heading + paragraph
│   ├── button-link.json           # M1 — CTA as text<a> block
│   ├── two-col.json               # M1 — two-column flex layout
│   ├── captioned-image.json       # M1 — core/image with caption
│   ├── embed-fallback.json        # M1 — core/embed for YouTube
│   ├── fidelity-flat-section.json # Fidelity — flat heading + paragraph
│   ├── fidelity-cta-link.json     # Fidelity — CTA button
│   ├── fidelity-captioned-image.json # Fidelity — captioned image
│   ├── fidelity-inline-formatting.json # Fidelity — rich inline text
│   ├── fidelity-svg-icon.json     # Fidelity — SVG icon shape
│   ├── fidelity-form-fallback.json # Fidelity — form → HTML fallback
│   ├── dom-walk-text-only.json    # DOM walk — text-only structure
│   ├── dom-walk-nested.json       # DOM walk — nested elements
│   ├── dom-walk-mixed.json        # DOM walk — mixed tags + styles
│   ├── preprocess-basic.json      # Preprocessor — class extraction
│   ├── style-transfer-flat.json   # Class → inline style transfer
│   └── global-class-ref.json      # Global class reference resolution
├── src/
│   ├── core/
│   │   ├── types.ts            # TypeScript type definitions
│   │   ├── id-generator.ts     # Deterministic auto-increment IDs
│   │   ├── style-parser.ts     # Inline style parsing → styles/css split
│   │   ├── mapper.ts           # M1: FixtureNode → Block conversion
│   │   ├── serializer.ts       # Blocks → WordPress block markup
│   │   ├── validator.ts        # Hard-fail & warning checks
│   │   ├── preprocessor.ts     # HTML preprocess: extract classes, custom CSS
│   │   ├── dom-walker.ts       # DOM walk: HTML → Block[] via tag rules
│   │   ├── orchestrator.ts     # Full pipeline: preprocess → walk → serialize
│   │   ├── global-styles-collector.ts  # Registers class→styles from preprocessor
│   │   ├── global-styles-generator.ts  # Generates Global Styles JSON from Tailwind
│   │   ├── tailwind-resolver.ts # Compiles Tailwind CSS from extracted config
│   │   ├── theme-settings-extractor.ts # Generates theme settings prompt payload
│   │   ├── hero-intake.ts      # Hero detection and conversion intake
│   │   └── tailwind-inliner.ts  # CSS rule parsing → class→property registry → style assignment
│   ├── runner/
│   │   └── run-fixture.ts      # Pipeline orchestration (M1 + fidelity)
│   └── cli/
│       └── index.ts            # CLI entry point
├── skill-reference/            # Skills for manual HTML→GB conversion workflows
│   ├── html-to-generateblocks/
│   ├── elementor-to-generateblocks/
│   └── figma-to-generateblocks/
├── plugin/                     # GenerateBlocks plugin JSON for schema reference
│   ├── generateblocks/
│   ├── generateblocks-pro/
│   └── gp-premium/
├── inputs/                     # Raw HTML inputs for convert command (e.g. inputs/mino/)
├── snippets/                   # Reusable GB snippet PHP files
├── snapshots/m1/               # M1 regression golden files
├── output/                     # Generated output (gitignored), organized by project
├── package.json
├── tsconfig.json
└── README.md                   # ← You are here (living doc)
```

---

## Pre-Conversion Checklist

Before running `convert` on an HTML page, clean the source to avoid
`FIX_SOURCE` hard fails. Run this prompt with your AI assistant:

> Scan all HTML files. Find any element (section, article, aside, header,
> main, div) where raw text sits at the same level as block children — i.e.,
> text not wrapped in `<p>`, `<span>`, `<h1>`–`<h6>`, or other tags. For
> each, wrap the bare text in the smallest appropriate tag: `<span>` for
> short inline phrases, `<p>` for sentences and paragraphs. Do not touch
> elements where all text is already properly wrapped. Show each change
> as a diff before applying.

### Marker System

Add `data-gb-wrap="core-html"` to any element you want preserved as raw
HTML in the output (not decomposed into GB blocks):

```html
<div data-gb-wrap="core-html">
  <!-- This entire div stays as raw HTML in a core/html block -->
  <custom-chart data-source="analytics"></custom-chart>
  <script type="application/json">{"key": "value"}</script>
</div>
```

### Iconify Icons

`<iconify-icon>` elements are automatically resolved to inline SVGs during
conversion via the [Iconify API](https://api.iconify.design). No manual
action needed. If an icon can't be resolved (API downtime, invalid name),
the converter falls back to wrapping it in a `core/html` block.

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Chromium (for Tailwind resolution — `npx playwright install chromium`)

### Install

```bash
npm install
```

### Run all fixtures

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

### Run a single fixture

```bash
npx tsx src/cli/index.ts fixtures:run button-link
```

### List all fixtures

```bash
npx tsx src/cli/index.ts fixtures:list
```

### Run regression check

```bash
npx tsx src/cli/index.ts regression
```

### Convert a project (all pages)

```bash
npx tsx src/cli/index.ts convert inputs/mino/
```

Compiles Tailwind CSS from ALL pages in the directory (union of all classes),
writes shared `styles.css` once, then converts each page individually.
Output goes to `output/mino/`.

### Convert a single HTML page

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Use `--skip-shared` for subsequent pages if `styles.css` already exists from
a project-mode run.

Outputs go to `output/<project>/` with `.html` (blocks), `.report.json`,
optional `-custom.css`, `-global-styles.json`, and `tailwind.css`.

### Validate a fixture output

```bash
npx tsx src/cli/index.ts validate button-link
```

### Update report after WordPress verification

```bash
npx tsx src/cli/index.ts report:update <name> --pasted true --saved true --notes "..."
```

---

## Input Formats

The project supports multiple input formats, auto-detected by the CLI:

### M1 Format (FixtureNode)

The original format — uses `element`/`text`/`image` node types with inline CSS strings.

```json
{
  "name": "text-stack",
  "input": {
    "nodeType": "element",
    "tagName": "section",
    "style": "padding:64px 24px;background:#f7f7f7;",
    "children": [
      { "nodeType": "text", "tagName": "h2", "text": "Heading", "style": "font-size:2rem;" }
    ]
  },
  "expect": { "shouldPass": true, "hardFailCount": 0, "warningCodes": [] }
}
```

### Fidelity Format (HTML string)

Takes raw HTML as a string — the fixture is processed through the full
preprocessor → DOM walk → serialization pipeline. Used for testing the
convert command's block output against known inputs.

```json
{
  "name": "fidelity-flat-section",
  "description": "Section with heading and paragraph — fidelity-first, tag-driven",
  "inputHtml": "<main><section id=\"hero\"><h1 style=\"font-size:2rem;color:#111\">Title</h1><p style=\"font-size:1rem;color:#444\">Body text</p></section></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 3
  }
}
```

### HTML Page (convert command)

Any `.html` file — processed through `convert` with Tailwind config extraction,
class-to-inline transfer, and custom CSS generation. Output goes to
`output/<projectDir>/`.

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

---

## Pipeline

```
M1:      FixtureNode → mapper → Block[] → serialize → validate → report
Fidelity:  inputHtml → preprocess → DOM walk → Block[] → serialize → validate → report
Convert:  HTML file → (Tailwind inliner: parse CSS rules → class→property registry
                    → per-element style assignment → CSS variable resolution
                    → normalization → desktop-first conversion → consolidation)
                    → preprocess (class extraction + custom CSS)
                    → DOM walk (section wrapper + tag-driven block mapping)
                    → serialize → validate → multi-file output
Hero:    HTML section → hero-intake (detect/conform/plan) → Block[]
```

### Tailwind Inliner (convert only)
When Tailwind is detected (CDN script or utility classes), the inliner:
1. Loads the page in headless Chromium and waits for the CDN to compile
2. Parses `document.styleSheets` to extract every CSS rule (class base,
   responsive, state, compound, element, @keyframes, vendor-prefixed)
3. Builds a ClassRegistry mapping each class name to its declared properties
4. For each element, looks up its original class list against the registry
   and collects only the properties Tailwind actually set (~5-8 per element)
5. Resolves CSS variable chains in transforms (`--tw-translate-x` etc.)
6. Normalizes values (rgb→hex, 0px→0) and converts to desktop-first
7. Consolidates shared property sets into reusable Global Styles classes;
   unique properties stay inline; pseudo-classes follow their base

### Preprocessor
Extracts `<style>` blocks into `customCss`, maps CSS class definitions to
property dictionaries, and transfers matched class styles to inline `style`
attributes on elements. Also detects inline `<script>` Tailwind configs for
compilation.

### DOM Walker
Walks the preprocessed HTML DOM, mapping elements to blocks by tag name:
- `section`, `div`, `nav`, `header`, `footer`, `main`, `article`, `aside` → `generateblocks/element`
- `h1`–`h6`, `p`, `span`, `a`, `strong`, `em`, `small`, `label` → `generateblocks/text`
- `<a>` with only text → `generateblocks/text` (tagName `a`, no blocks inside)
- `<a>` with inner blocks → `generateblocks/element` (tagName `a`)
- `<img>` → `generateblocks/media` or `core/image` (if caption)
- `<figure>` with `<figcaption>` → `core/image`
- `<svg>` → `generateblocks/shape`
- `<iframe>` → `core/embed`
- `<ul>`, `<ol>` → `core/list`
- `<blockquote>` → `core/quote`
- `<form>` → `core/html` (fallback)
- Unknown/unsupported → stripped with warning

---

## Block Coverage

| GB Block | Status | Notes |
|---|---|---|
| `generateblocks/element` | ✅ verified | Containers, sections, links |
| `generateblocks/text` | ✅ verified | All tag variants, CTA pattern, rich inline |
| `generateblocks/media` | ✅ verified | Uncensored images, responsive |
| `generateblocks/shape` | ✅ verified | SVG icons with styles.svg |

| Core Block | Status | Notes |
|---|---|---|
| `image` | ✅ verified | Captioned images |
| `core/embed` | ✅ verified | YouTube provider |
| `core/list` | ✅ verified | Unordered lists |
| `core/quote` | ✅ verified | With citation |
| `core/html` | ✅ verified | Raw HTML fallback |

---

## Verified Fixtures (17 total)

| Fixture | Blocks | Pipeline | Status |
|---|---|---|---|
| text-stack | 3 | M1 | ✅ |
| button-link | 1 | M1 | ✅ |
| two-col | 8 | M1 | ✅ |
| captioned-image | 1 | M1 | ✅ |
| embed-fallback | 1 | M1 | ✅ |
| fidelity-flat-section | 3 | Fidelity | ✅ |
| fidelity-cta-link | 1 | Fidelity | ✅ |
| fidelity-captioned-image | 1 | Fidelity | ✅ |
| fidelity-inline-formatting | 1 | Fidelity | ✅ |
| fidelity-svg-icon | 1 | Fidelity | ✅ |
| fidelity-form-fallback | 1 | Fidelity | ✅ |
| dom-walk-text-only | — | DOM walk | ✅ |
| dom-walk-nested | — | DOM walk | ✅ |
| dom-walk-mixed | — | DOM walk | ✅ |
| preprocess-basic | — | Preprocess | ✅ |
| style-transfer-flat | — | Preprocess | ✅ |
| global-class-ref | — | Preprocess | ✅ |

---

## Output Files

### Fixture output (`output/`)

- **`<fixture-name>.html`** — paste-ready WordPress block markup
- **`<fixture-name>.report.json`** — validation report
- **`<fixture-name>-global-styles.json`** — extracted class→properties manifest (fidelity fixtures with global classes)
- **`<fixture-name>-custom.css`** — extracted `<style>` block CSS (fidelity fixtures)

### Convert command output (`output/<projectDir>/`)

- **`<pageName>.html`** — paste-ready WordPress block markup with section wrapper pattern
- **`<pageName>.report.json`** — validation report with `overallStatus`, `blockCount`, `hardFails`
- **`global-styles.json`** — WordPress Global Styles JSON: consolidated reusable classes
  with responsive `@media` overrides and `&:hover`/`&:focus` state blocks
- **`custom.css`** — Tailwind Preflight/reset, `@keyframes`, `::-webkit-*` vendor prefixes,
  body-level rules
- **`<pageName>-global-styles.json`** — legacy class→properties manifest

### Report status values

- `validator_pass` — passed local validation
- `validator_fail` — failed local validation
- `wordpress_verified_pass` — confirmed via paste/save/reload
- `wordpress_verified_fail` — recovery triggered
- `rejected_unsupported` — not convertible (hero only)

---

## Design Decisions

### Stack
- **TypeScript + ESM** — `tsx` for direct execution, no build step
- Canonical key orders verified against plugin `block.json` files

### Style handling
- Inline `style` strings parsed → split into `styles` object (camelCase)
  and `css` string (kebab-case, sorted, single-line, minified)
- Properties with GB editor panel equivalents go to BOTH `styles` and `css`
- Properties without panel equivalents go to `css` only
- Shorthand properties (padding/margin/border-radius) expanded to granular
  keys in styles, kept as shorthand in CSS

### Responsive patterns
- Desktop-first: base styles at top, media queries for overrides
- Tablet: `@media(max-width:1024px)`
- Mobile: `@media(max-width:768px)`
- Responsive overrides in `responsiveIntent` per breakpoint

### HTML conversion pipeline
- **CSS rule parser** extracts all rules from `document.styleSheets` after Tailwind CDN
  compilation — classifies into base, responsive (with breakpoint), state (hover/focus),
  compound (descendant selectors), and element/@keyframes/vendor-prefixed (custom.css)
- **Class registry** maps each unescaped class name to its declared CSS properties
- **Per-element assignment** looks up each element's class list against the registry,
  applying class list order as tiebreaker for conflicting properties
- **CSS variable resolution** resolves `--tw-translate-*` / `--tw-scale-*` chains in
  `transform` and `filter` properties, simplifying identity components
- **Value normalization** converts `rgb()` to `#hex` and strips `0px` → `0`
- **Desktop-first conversion** transforms mobile-first Tailwind breakpoints to
  desktop-first: largest breakpoint → base, smaller → `@media(max-width)` overrides
- **Consolidator** hashes shared property sets into reusable `.gb-s-{hash}` classes;
  original CSS class names (`.blueprint-bg`, `.clip-hex`) are preserved
- **Custom CSS assembly** collects element selectors, @keyframes, and vendor-prefixed
  rules from both the Tailwind CDN output and original `<style>` blocks

### Critical recovery rules enforced
- No `className` in GB block JSON
- No descendant selectors in `css` (except documented exceptions)
- No `transition` or hover rules in `css`
- Text `<a>` blocks: `href` goes in `htmlAttributes`, not in `content`
- Captioned images → `image` block, not `generateblocks/media`
- Canonical key order per block type
- Four JSON escapes (`--` → `\u002d\u002d`, `&` → `\u0026`, `<` → `\u003c`, `>` → `\u003e`)
- Absolute URLs only in `htmlAttributes`

---

## Manual WordPress Verification

1. Open the WordPress code editor (Ctrl+Shift+Alt+M or / ⋮ menu)
2. Paste the entire contents of `<fixture-name>.html`
3. Save the post
4. Reload the editor
5. Confirm **no "Attempt Recovery"** prompt
6. Run `report:update <name> --pasted true --saved true --notes "..."`

### Troubleshooting

If recovery fires:
1. Inspect the recovery diff — compare JSON attributes
2. Check `--` / `&` / `<` / `>` escapes
3. Verify canonical key order
4. Check CSS: no transitions, no hover, no descendant selectors, sorted, minified
5. Bisect — remove blocks one at a time to isolate the failing one

---

## Known Limitations

- **display:initial reset:** When a Tailwind class sets `display` only at a responsive breakpoint (e.g., `md:flex`) with no base display class, the downward reset uses `display: initial` which resolves to `inline` in CSS. In practice, Tailwind developers always set a base display class (`flex md:flex`), making this edge case rare.
- **GB Grid initialization:** Grid blocks with pre-populated `styles` + `css` attributes may require a manual "touch" in the WordPress block editor (toggle display grid→flex→grid) to fully initialize frontend CSS. This is a GenerateBlocks behavior, not a converter bug.
- **xl/2xl breakpoints:** xl and 2xl values are collapsed into the nearest breakpoint when using GB's native tiers. For full precision, the converter uses custom `@media` queries.
- **CSS splitter:** The `--split` flag separates Tailwind preflight/utility CSS from design component classes. Some edge-case utility classes may not be classified correctly.

---

## Updating This Document

This is a **living document**. Update it whenever:
- CLI invocation changes
- New fixture types are added
- Output format changes
- Verification workflow changes
