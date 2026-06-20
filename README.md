# GenerateBlocks Converter

Convert HTML pages into WordPress paste-ready GenerateBlocks & Core block markup.

📺 **[Watch the demo →](https://www.boomshare.ai/shared/01KVJWQBK46FQYP698B0AC6MSM)** (3:54 showcase)

> **Status:** Intent-based style transfer pipeline — GenerateBlocks Element/Text/Media/Shape
> + WordPress Core fallbacks verified. Tailwind CSS resolution via headless Chromium,
> with automatic class-to-style inlining and Global Styles generation.

## Quick Start

```bash
# Prerequisites: Node.js 18+, Chromium (npx playwright install chromium)
npm install

# Run all test fixtures
npx tsx src/cli/index.ts fixtures:run-all

# Convert an HTML page
npx tsx src/cli/index.ts convert inputs/mino/index.html

# Convert an entire project (all pages in directory)
npx tsx src/cli/index.ts convert inputs/mino/
```

## Pipeline

```
Fixtures:  FixtureNode → mapper → Block[] → serialize → validate → report
HTML:      inputHtml → preprocess → DOM walk → Block[] → serialize → validate → report
Convert:   HTML file → Tailwind inliner (CSS rule parsing → class→property registry
           → per-element style assignment → desktop-first conversion)
           → preprocess → DOM walk → serialize → multi-file output
```

## Block Coverage

| GB Block | Status |
|---|---|
| `generateblocks/element` | ✅ Containers, sections, links |
| `generateblocks/text` | ✅ All tag variants, CTA pattern, rich inline |
| `generateblocks/media` | ✅ Uncensored images, responsive |
| `generateblocks/shape` | ✅ SVG icons |

| Core Block | Status |
|---|---|
| `core/image` | ✅ Captioned images |
| `core/embed` | ✅ YouTube provider |
| `core/list` | ✅ Unordered lists |
| `core/quote` | ✅ With citation |
| `core/html` | ✅ Raw HTML fallback |

## Output Files

- **`.html`** — paste-ready WordPress block markup
- **`.report.json`** — validation report (`validator_pass`, `validator_fail`, `wordpress_verified_pass`, etc.)
- **`global-styles.json`** — WordPress Global Styles JSON with consolidated reusable classes and responsive overrides
- **`custom.css`** — Tailwind Preflight/reset, keyframes, vendor prefixes

## Manual WordPress Verification

1. Open the WordPress code editor
2. Paste the contents of the `.html` output
3. Save and reload — confirm **no "Attempt Recovery"** prompt

## Known Limitations

- **Tailwind color classes** (`bg-primary`, `text-slate/80`) rely on CSS custom properties
  not supported by GenerateBlocks inline styles. These remain as utility classes requiring
  `tailwind-utilities.css`.
- **State modifiers** (`hover:`, `focus:`, `group-hover:`) have no GB inline equivalent —
  they stay in `globalClasses` with CSS support.
- **Transition/animation classes** remain as utility classes (no CSS property mapping in GB).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). For internal development details (directory
layout, fixture catalog, design decisions, verification workflow), see
[`DEV.md`](./DEV.md).
