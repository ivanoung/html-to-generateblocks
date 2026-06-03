# GenerateBlocks Converter — Prototype

A TypeScript prototype that converts source-like JSON fixtures and normalized
IR nodes into WordPress paste-ready GenerateBlocks & Core block markup,
validates against known "Attempt Recovery" rules, and writes files for manual
verification in the WordPress editor.

> **Status:** Milestone 2 complete — all 22 fixtures WordPress-verified
> (paste / save / reload / no recovery). 50+ blocks tested across GenerateBlocks
> Element/Text/Media/Shape + WordPress Core fallbacks (Image, Embed, HTML,
> List, Quote).

---

## Directory Layout

```
.
├── fixtures/              # Input fixture JSON files (22 total)
│   ├── text-stack.json          # M1 — section + heading + paragraph
│   ├── button-link.json         # M1 — CTA as text<a> block
│   ├── two-col.json             # M1 — two-column flex layout
│   ├── captioned-image.json     # M1 — core/image with caption
│   ├── embed-fallback.json      # M1 — core/embed for YouTube
│   ├── section-shell.json       # M2P1 — outer section + constrained inner
│   ├── button-group.json        # M2P1 — two CTAs in flex row
│   ├── rich-text-inline.json    # M2P2 — text block with inline HTML
│   ├── list-basic.json          # M2P2 — core/list fallback
│   ├── card-grid-2up.json       # M2P2 — two cards with heading/copy/CTA
│   ├── quote-simple.json        # M2P3 — core/quote with citation
│   ├── stats-row.json           # M2P3 — flex row of stat cards
│   ├── icon-text-row.json       # M2P3 — shape + text items
│   ├── media-text-split.json    # M2P3 — image + text in two-column
│   ├── hero-simple.json         # M2P4 — hero with heading/p/CTA
│   ├── two-col-responsive.json  # M2P4 — 2-col grid → 1-col on mobile
│   ├── card-grid-responsive.json # M2P4 — 3-col grid → 2 → 1
│   ├── stats-row-responsive.json # M2P4 — stats row with wrapping
│   ├── media-text-split-responsive.json # M2P4 — flex split → column
│   ├── hero-pattern.json        # M2P5 — pattern hero (score 0.85)
│   ├── hero-generic.json        # M2P5 — generic hero (score 0.60)
│   └── hero-rejected.json       # M2P5 — rejected (tabs/carousel)
├── src/
│   ├── core/
│   │   ├── types.ts            # TypeScript type definitions
│   │   ├── ir-node.ts          # Intermediate Representation types
│   │   ├── id-generator.ts     # Deterministic auto-increment IDs
│   │   ├── style-parser.ts     # Inline style parsing → styles/css split
│   │   ├── mapper.ts           # M1: FixtureNode → Block conversion
│   │   ├── ir-planner.ts       # M2: IRNode → Block conversion (plan-blocks)
│   │   ├── serializer.ts       # Blocks → WordPress block markup
│   │   ├── validator.ts        # Hard-fail & warning checks
│   │   ├── hero-scorer.ts      # Pattern scoring for hero detection
│   │   └── hero-converter.ts   # Hero conversion (pattern/generic/rejected)
│   ├── runner/
│   │   └── run-fixture.ts      # Pipeline orchestration (M1 + M2 + hero)
│   └── cli/
│       └── index.ts            # CLI entry point
├── snapshots/m1/               # M1 regression golden files
├── output/                     # Generated output (gitignored)
├── package.json
├── tsconfig.json
└── README.md                   # ← You are here (living doc)
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm

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

### Update report after WordPress verification

```bash
npx tsx src/cli/index.ts report:update <name> --pasted true --saved true --notes "..."
```

---

## Input Formats

The project supports three fixture formats, auto-detected by the CLI:

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

### M2 IR Format (IRNode)

Uses semantic IR types (`section`/`container`/`heading`/`button-link`/`icon`),
kebab-case style keys, and optional `responsiveIntent` for breakpoints.

```json
{
  "name": "icon-text-row",
  "input": {
    "nodeType": "container",
    "tagName": "div",
    "styleIntent": { "display": "flex", "gap": "32px" },
    "children": [
      { "nodeType": "icon", "html": "<svg>...</svg>", "styleIntent": { "display": "inline-flex", "svg:fill": "currentColor" } },
      { "nodeType": "paragraph", "textContent": "Label", "styleIntent": { "font-size": "1rem" } }
    ]
  },
  "expect": { "shouldPass": true, "hardFailCount": 0, "warningCodes": [] }
}
```

### Hero Format

Same shape as M2 IR but with `"kind": "hero"` and optional `heroOptions`.
Uses the hero converter pipeline (pattern scoring + mode selection).

```json
{
  "name": "hero-pattern",
  "kind": "hero",
  "input": { "nodeType": "section", "tagName": "section", ... },
  "heroOptions": { "mode": "auto", "minPatternScore": 0.75 }
}
```

---

## Pipeline

```
M1: FixtureNode → mapper → Block[] → serialize → validate → report
M2: IRNode → ir-planner → Block[] → serialize → validate → report
Hero: IRNode → hero-scorer → convertHero (pattern|generic|rejected) → report
```

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

## Verified Fixtures (22 total)

| Fixture | Blocks | Phase | Status |
|---|---|---|---|
| text-stack | 3 | M1 | ✅ |
| button-link | 1 | M1 | ✅ |
| two-col | 8 | M1 | ✅ |
| captioned-image | 1 | M1 | ✅ |
| embed-fallback | 1 | M1 | ✅ |
| section-shell | 2 | P1 | ✅ |
| button-group | 5 | P1 | ✅ |
| rich-text-inline | 1 | P2 | ✅ |
| list-basic | 1 | P2 | ✅ |
| card-grid-2up | 10 | P2 | ✅ |
| quote-simple | 1 | P3 | ✅ |
| stats-row | 10 | P3 | ✅ |
| icon-text-row | 10 | P3 | ✅ |
| media-text-split | 7 | P3 | ✅ |
| hero-simple | 5 | P4 | ✅ |
| two-col-responsive | 7 | P4 | ✅ |
| card-grid-responsive | 11 | P4 | ✅ |
| stats-row-responsive | 11 | P4 | ✅ |
| media-text-split-responsive | 7 | P4 | ✅ |
| hero-pattern | 9 | P5 | ✅ |
| hero-generic | 5 | P5 | ✅ |
| hero-rejected | 0 | P5 | ✅ (rejected) |

---

## Output Files

Each fixture generates files in `output/`:

- **`<fixture-name>.html`** — paste-ready WordPress block markup
- **`<fixture-name>.report.json`** — validation report

Hero fixtures generate an extended report with `mode`, `patternScore`, `simplifications[]`, and `unsupportedFeatures[]`.

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

### Hero conversion
- Pattern scoring detects hero-composite layout family
- Three modes: pattern (score ≥ threshold), generic (fallback), rejected
- Rejection reasons: `PRO_REQUIRED_TABS`, `TOO_MANY_BLOCKS`

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

## Updating This Document

This is a **living document**. Update it whenever:
- CLI invocation changes
- New fixture types are added
- Output format changes
- Verification workflow changes
