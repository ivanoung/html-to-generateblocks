# GenerateBlocks Converter — Prototype

A TypeScript prototype that converts source-like JSON fixtures into WordPress
paste-ready GenerateBlocks & Core block markup, validates against known
"Attempt Recovery" rules, and writes files for manual verification in the
WordPress editor.

> **Status:** Milestone 1 complete — all 5 fixtures WordPress-verified (paste / save / reload / no recovery).
> 15 blocks tested across GenerateBlocks Element/Text + WordPress Core fallbacks
> (Image, Embed, HTML).

---

## Directory Layout

```
.
├── fixtures/              # Input JSON fixture files
│   ├── text-stack.json
│   ├── button-link.json
│   ├── two-col.json
│   ├── captioned-image.json
│   └── embed-fallback.json
├── src/
│   ├── core/
│   │   ├── types.ts        # TypeScript type definitions
│   │   ├── id-generator.ts # Deterministic auto-increment IDs
│   │   ├── style-parser.ts # Inline style parsing → styles/css split
│   │   ├── mapper.ts       # Node tree → intermediate Block representations
│   │   ├── serializer.ts   # Blocks → WordPress block markup (canonical order, JSON escapes)
│   │   └── validator.ts    # Hard-fail & warning checks
│   ├── runner/
│   │   └── run-fixture.ts  # Full pipeline orchestration
│   └── cli/
│       └── index.ts        # CLI entry point
├── output/                 # Generated output (gitignored)
│   ├── text-stack.html
│   ├── text-stack.report.json
│   └── ...
├── package.json
├── tsconfig.json
└── README.md               # ← You are here (living doc)
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
npx tsx src/cli/index.ts
```

### Run a single fixture

```bash
npx tsx src/cli/index.ts button-link
```

---

## Input Fixture Format

Each fixture is a JSON file in `fixtures/`. See the existing fixtures for
reference. The general shape:

```json
{
  "name": "my-fixture",
  "description": "What this fixture tests",
  "input": { /* node tree */ },
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "warningCodes": []
  }
}
```

### Allowed node types

| Node type | Description | Maps to |
|-----------|-------------|---------|
| `element` | Container/layout tag (div, section, a, etc.) | `generateblocks/element` |
| `text` | Text content (p, h1-h6, span, etc.) | `generateblocks/text` |
| `image` | Static image (with optional caption) | `generateblocks/media` or `core/image` |
| `embed` | Embeddable content (YouTube, Vimeo, etc.) | `core/embed` or `core/html` |
| `html` | Raw HTML fallthrough | `core/html` |

---

## Output Files

Each fixture generates two files in `output/`:

- **`<fixture-name>.html`** — paste-ready WordPress block markup
- **`<fixture-name>.report.json`** — validation report with hard fails,
  warnings, and manual verification fields

### Report format

```json
{
  "fixture": "button-link",
  "status": "pass",
  "blockCount": 2,
  "hardFails": [],
  "warnings": [],
  "manualVerification": {
    "wordpressPasted": false,
    "savedWithoutRecovery": null,
    "notes": ""
  }
}
```

---

## Manual WordPress Verification

After generating output, manually verify in WordPress:

1. Open the WordPress code editor (Ctrl+Shift+Alt+M or / ⋮ menu)
2. Paste the entire contents of the `<fixture-name>.html` file
3. Save the post
4. Reload the editor
5. Confirm **no "Attempt Recovery"** prompt appears
6. Confirm structure, styles, and links survive the save/reload cycle
7. Edit the `output/<fixture-name>.report.json` and update:
   - `manualVerification.wordpressPasted: true`
   - `manualVerification.savedWithoutRecovery: true` (or `false`)
   - `manualVerification.notes: "What you observed"`

### If recovery fires

Troubleshooting order (most common causes first):

1. **JSON escapes** — check for unescaped `--`, `&`, `<`, `>` in block JSON
2. **Key order** — verify attributes match the canonical order per block type
3. **CSS restrictions** — no transitions, no hover states, no descendant
   selectors, function args without spaces, alphabetically sorted
4. **Bisect** — remove blocks one at a time to isolate the failing one

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

### Critical recovery rules enforced
- No `className` in block JSON (plugin-managed)
- No `href` in text `<a>` block htmlAttributes (use element<a>+text<span>)
- Captioned images → `core/image`, not `generateblocks/media`
- No stray HTML comments
- Compact nesting: closing tags directly adjacent to closing delimiters
- Absolute URLs only in `htmlAttributes`

---

## Updating This Document

This is a **living document**. Update it whenever:

- The CLI invocation changes (flags, arguments, behavior)
- New fixture types are added
- Output format changes
- Manual verification workflow changes

Keep the Quick Start section accurate. The rest is reference — update as needed
but don't let perfection delay the update.
