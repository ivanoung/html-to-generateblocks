# Style Transfer Pipeline — Design Spec

**Date:** 2026-06-06
**Status:** Design — awaiting approval
**Scope:** Convert Tailwind HTML pages to GenerateBlocks with full style transfer (no framework dependency)

---

## Problem

Tailwind HTML pages converted to GB blocks currently rely on an external compiled
Tailwind CSS file for visual fidelity. The block `styles` and `css` fields are empty;
all styling lives in `globalClasses[]` + the external stylesheet. This means:

- **Editor preview is broken** — the GB block editor doesn't load the Tailwind
  stylesheet, so blocks appear unstyled in the editor.
- **No framework handover** — clients receive a site that depends on a Tailwind CSS
  file. The goal is to hand over a clean WordPress site with all styles living in
  native GB/GP systems.
- **Styles aren't reusable** — each block has its own Tailwind class string. There's
  no shared style registry that GB's editor UI can browse.

## Solution Overview

Three extraction layers produce three independent outputs, each delivered through a
different mechanism into WordPress:

```
Source HTML (Tailwind)  →  Three extraction layers  →  WordPress
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
               Layer 1       Layer 2      Layer 3
            Theme Settings  Global       GB Block
            (colors,        Styles       Markup
             typography,    (gblocks_    (globalClasses
             spacing)       styles CPT)  references)
                    │           │           │
                    ▼           ▼           ▼
              MCP or JSON    Admin page    Paste into
              import         import        editor
```

---

## Layer 1 — Theme Settings Extraction

### Purpose

Extract the source design's colors, typography, spacing scale, and container width
from the `tailwind.config` and map them to GeneratePress `generate_settings` JSON.

### Input

The `tailwind.config` object already extracted by the preprocessor. Contains:

```js
{
  theme: {
    extend: {
      colors: { surface: "#0a0a0a", primary: "#17A57A", seafoam: "#..." },
      fontFamily: { display: ["...", "sans-serif"], mono: ["...", "monospace"] },
      spacing: { "container": "1280px", ... },
      borderRadius: { ... },
      screens: { sm: "640px", lg: "1024px", ... },
    }
  }
}
```

### Process

An LLM pass maps Tailwind config keys → GP settings JSON shape. A prompt with a
human-readable mapping table guides the LLM:

| Tailwind key | GP setting key | Notes |
|---|---|---|
| `theme.extend.colors.*` | `global_colors[].{name,slug,color}` | One entry per color. Slug = key name |
| `theme.extend.fontFamily.display` | `typography[selector=all-headings].fontFamily` | Map display fonts to headings |
| `theme.extend.fontFamily.mono` | `typography[selector=body].fontFamily` (if body) | Mono may be code/caption only |
| Largest `maxWidth` or screen | `container_width` | The design's content width |
| Generic spacing scale | Not set directly — handled by Layer 2 variables | Spacing lives in Global Styles CSS |

### Output

Two delivery channels:

| Channel | Format | Use case |
|---|---|---|
| MCP direct | `generatepress-set-settings` call | One-shot push to a live site |
| JSON fallback | `output/<project>/theme-settings.json` | Manual import via GP export/import flow |

The JSON fallback matches the same format as the user's existing GP export:

```json
{
  "options": {
    "generate_settings": {
      "container_width": 1264,
      "global_colors": [ ... ],
      "typography": [ ... ],
      "background_color": "var(--surface)",
      "link_color": "var(--primary)"
    }
  }
}
```

### Fonts

Fonts are NOT auto-installed. The converter outputs a list of required fonts (family
names + weights). The user installs them via `generatepress-add-font` or the GP Font
Library UI manually.

### Files

| File | Description |
|---|---|
| `output/<project>/theme-settings.json` | GP settings JSON for manual import |
| `src/core/theme-settings-extractor.ts` | New module — LLM-assisted config → GP JSON |
| `src/core/types.ts` | New type: `ThemeSettingsOutput` |

---

## Layer 2 — Global Styles Pipeline

### Purpose

Register CSS classes used by the page as GenerateBlocks Pro Global Styles
(`gblocks_styles` CPT). This makes styles visible in the editor, reusable across
blocks, and eliminates the external Tailwind stylesheet dependency.

### Phase 1: Every Class → Global Style

All Tailwind classes used on the page are registered as Global Styles. No
discrimination between "shared" and "unique" classes. No inline `styles`/`css` on
blocks. This is the simplest path to editor fidelity.

Future phases can add inline-vs-global logic without architectural changes.

### Process

1. **Compile Tailwind CSS** — Already done. The `--resolve-css` flag compiles the
   tailwind.config into a minified CSS file.

2. **Parse compiled CSS** — Extract all rule selectors and their property-value pairs.
   Each selector becomes one Global Style entry.

3. **Map CSS properties to `gb_style_data`** — For each CSS rule, produce a
   best-effort structured representation. Simple properties (background-color, color,
   padding, font-size) map directly. Complex properties (grid-template-columns,
   box-shadow, linear-gradient) go to `gb_style_css` only with empty `gb_style_data`.

4. **Output JSON** — Write `output/<project>/global-styles.json`.

### Output Format

```json
[
  {
    "selector": ".bgc-dark",
    "css": ".bgc-dark{background-color:var(--color-secondary)}",
    "data": { "backgroundColor": "var(--color-secondary)" }
  },
  {
    "selector": ".section-outer__margin__LR",
    "css": ".section-outer__margin__LR{margin-left:var(--padding-m);margin-right:var(--padding-m)}@media (max-width:767px){.section-outer__margin__LR{margin-left:0;margin-right:0}}",
    "data": {}
  },
  {
    "selector": ".btn__size-L",
    "css": ".btn__size-L{display:inline-flex;font-weight:600;color:#fff;border-radius:3rem;padding:20px 40px;transition:0.3s}",
    "data": { "display": "inline-flex", "fontWeight": "600", "color": "#fff" }
  }
]
```

Rules:
- `selector` — CSS selector string, always starts with `.`
- `css` — compiled CSS for that selector (can include `@media` blocks)
- `data` — structured style properties for the GB editor (optional, can be `{}`)

### Delivery: Admin Page Snippet

A single PHP code snippet (deployed via WPCodeBox) that adds a "Style Transfer" page
to the GB Pro admin menu.

**Menu position:** Between Global Styles (position 3) and Conditions/Overlay Panels
(position 4). Registered at `add_action('admin_menu', ..., 9)` with position 4,
so it registers before GB Pro's default-priority hooks at the same position.

**Page structure:**

```
┌──────────────────────────────────────────────────┐
│  Style Transfer                                   │
│                                                   │
│  Status: 48 Global Styles currently registered    │
│                                                   │
│  ┌─ Export ────────────────────────────────────┐ │
│  │  Download all Global Styles as JSON         │ │
│  │  [Download global-styles.json]              │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Import ────────────────────────────────────┐ │
│  │  Paste the contents of global-styles.json. │ │
│  │  All existing styles will be replaced.      │ │
│  │                                             │ │
│  │  ┌──────────────────────────────────────┐   │ │
│  │  │ [large textarea]                     │   │ │
│  │  │                                      │   │ │
│  │  │                                      │   │ │
│  │  └──────────────────────────────────────┘   │ │
│  │  [Paste & Preview]                          │ │
│  │                                             │ │
│  │  ── Preview (after paste) ──                │ │
│  │  48 styles found. 0 errors.                 │ │
│  │  This will DELETE all 48 existing styles    │ │
│  │  and import 48 new ones.                    │ │
│  │                                             │ │
│  │  [Cancel] [Confirm Import]                  │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Three functions:**

1. **Export** — Queries all `gblocks_styles` posts, reads `gb_style_css` and
   `gb_style_data` metas, outputs JSON download.

2. **Import (preview)** — Accepts pasted JSON via a `<textarea>` input. Parses and
   validates JSON. If invalid: returns error messages inline (no DB writes). If
   valid: shows summary with "Confirm Import" button. The JSON is stored in a
   transient for the next step.

3. **Import (commit)** — Reads JSON from transient, deletes all existing
   `gblocks_styles` posts, bulk-inserts new ones via `wp_insert_post` +
   `update_post_meta`, clears `generateblocks_style_css` cache option, deletes
   transient.

**Validation rules (applied during preview):**

| Rule | Error message |
|---|---|
| JSON parse fails | "Invalid JSON: <parse error>" |
| Not an array | "Root must be a JSON array" |
| Entry missing `selector` | "Entry #3: missing required field 'selector'" |
| Entry missing `css` | "Entry #3: missing required field 'css'" |
| `selector` doesn't start with `.` | "Entry #3: selector must start with '.'" |
| `css` is empty string | "Entry #3: 'css' must not be empty" |
| Duplicate selector | "Entry #3 and #7: duplicate selector '.bgc-dark'" |
| `data` present but not an object | "Entry #3: 'data' must be an object if present" |

All validations run before any error is shown. If any rule fails, the entire import
is blocked — no partial writes.

### Files

| File | Description |
|---|---|
| `output/<project>/global-styles.json` | JSON payload for import |
| `src/core/global-styles-generator.ts` | New module — Tailwind CSS → JSON |
| `snippets/gb-style-transfer.php` | WPCodeBox snippet for the admin page |

---

## Layer 3 — Block Markup

### Purpose

Convert HTML structure to GenerateBlocks block markup. References to CSS classes via
`globalClasses[]`. No inline `styles` or `css` (Phase 1 of Layer 2).

### Status

ALREADY IMPLEMENTED AND VERIFIED. The fidelity-first converter in
`src/core/dom-walker.ts` + `src/core/serializer.ts` produces correct block markup
with `globalClasses` preservation. All 11 fixtures pass.

### Change for this design

After Layer 2 Phase 1, blocks keep `globalClasses: ["pt-32", "bgc-dark", ...]` and
still have `"styles":{}` and `"css":""`. No change to the block markup itself.

The only change is the output file path (see below).

---

## Output Folder Structure

### Current (flat)

```
output/index.html
output/index.report.json
output/index-tailwind.css
output/index-global-styles.json
```

### New (project-based)

```
inputs/mino/
  index.html              →  output/mino/index.html
  about.html              →  output/mino/about.html
  services/
    overview.html         →  output/mino/services/overview.html
    pricing.html          →  output/mino/services/pricing.html

output/mino/
  index.html              (GB block markup)
  about.html              (GB block markup)
  services/overview.html
  services/pricing.html
  index.report.json       (conversion report)
  theme-settings.json     (Layer 1)
  global-styles.json      (Layer 2 — NEW format)
  tailwind.css            (compiled, shared across all pages in project)
```

### CLI Changes

The `convert` command derives the project name from the input path:

```
npx tsx src/cli/index.ts convert inputs/mino/index.html --resolve-css
→ output/mino/index.html
→ output/mino/theme-settings.json
→ output/mino/global-styles.json
→ output/mino/tailwind.css
```

Path logic: strip `inputs/` prefix, use the remainder as output path. The project
name is the first directory segment after `inputs/`.

The tailwind.css is written once per project (not per page) since all pages in a
project share the same tailwind.config.

### Files Changed

| File | Change |
|---|---|
| `src/cli/index.ts` | Project subfolder path logic for `convert` command |
| `src/core/orchestrator.ts` | Accept project path, write to subfolder, Layer 1 + 2 outputs |
| `src/core/types.ts` | New types: `ThemeSettingsOutput`, `GlobalStyleEntry` |

---

## Data Flow

```
┌─────────────────┐
│  inputs/<proj>/ │
│    page.html     │
└────────┬────────┘
         │ read
         ▼
┌─────────────────┐
│   Preprocessor  │  extracts: tailwind.config, custom CSS,
│                 │  nav/footer stripping, <script>/<style> removal
└────────┬────────┘
         │ preprocessed HTML + config
         ▼
┌─────────────────┐     ┌──────────────────────┐
│   DOM Walker    │     │  Tailwind Resolver   │
│   (fidelity)    │     │  (compile CSS)       │
└────────┬────────┘     └──────────┬───────────┘
         │ blocks                   │ compiled CSS
         ▼                          ▼
┌─────────────────┐     ┌──────────────────────┐
│   Serializer    │     │ Theme Settings       │  LLM pass
│   → gb-blocks   │     │ Extractor            │──────────▶ theme-settings.json
└────────┬────────┘     │ ← tailwind.config    │
         │              └──────────────────────┘
         ▼
┌─────────────────┐     ┌──────────────────────┐
│   Validator     │     │ Global Styles Gen    │  CSS parser
└────────┬────────┘     │ ← compiled CSS       │──────────▶ global-styles.json
         │              └──────────────────────┘
         ▼
┌─────────────────────────────────────────────┐
│              output/<project>/               │
│  index.html         (gb blocks)             │
│  index.report.json  (validation report)     │
│  theme-settings.json (Layer 1 - GP settings)│
│  global-styles.json  (Layer 2 - GB styles)  │
│  tailwind.css        (compiled, shared)     │
└─────────────────────────────────────────────┘
```

---

## Scope Boundaries

**In scope:**
- Layer 1: LLM-assisted theme settings extraction → JSON output
- Layer 2: Tailwind CSS → Global Styles JSON + admin page snippet
- Layer 3: Unchanged block markup (fidelity-first converter)
- Output folder restructuring (project subfolders)
- Admin page with export, preview, and import functions

**Out of scope:**
- Inline style resolution on individual blocks (Phase 2 of Layer 2, future)
- Font auto-installation (manual via GP UI)
- Automatic MCP push of theme settings (user manages delivery)
- Multi-page batch processing (convert one page at a time)
- Tailwind class deduplication logic (Phase 1 puts every class in Global Styles)
- Migrating old `gblocks_global_style` CPT entries

---

## Error Handling

### Layer 1 — Theme Settings

| Scenario | Behavior |
|---|---|
| No tailwind.config found in HTML | Skip theme-settings.json output; log warning |
| LLM fails to parse config | Output raw config + error log; user reviews manually |
| Config has colors but no font families | Output colors only; typography section omitted |

### Layer 2 — Global Styles Generation

| Scenario | Behavior |
|---|---|
| No compiled Tailwind CSS available | Skip global-styles.json output; log warning |
| CSS rule has no selector (e.g., bare `@media`) | Skip that rule; continue processing |
| CSS property is not mappable to structured data | Put value in `css` only; leave `data` empty |
| Empty rules (selector with no properties) | Skip that rule; warn |

### Layer 2 — Admin Page Import

| Scenario | Behavior |
|---|---|
| Textarea is empty | "Please paste JSON content" |
| JSON parse error | "Invalid JSON: <error message at line X>" |
| Structural validation fails | List all errors; no writes made |
| Pasted JSON too large (>500KB) | "Content too large. Max 500KB." |
| DB insert fails on commit | Roll back any inserted posts; "Import failed: <error>" |

### CLI

| Scenario | Behavior |
|---|---|
| Input path outside `inputs/` | Error: "Input must be inside inputs/ directory" |
| Input file not found | Error: "File not found: <path>" |
| Output directory creation fails | Error: "Cannot create output directory: <path>" |

---

## Self-Review

1. **Placeholder scan:** No TBD, TODO, or incomplete sections found.
2. **Internal consistency:** Layer 1 output format matches GP import format. Layer 2
   output format matches `gblocks_styles` CPT structure (verified against live DB and
   `class-styles.php`). Layer 3 is unchanged from working code. Admin page menu
   position (4, priority 9) confirmed against GB Pro source.
3. **Scope:** Focused on three-layer style transfer. No unrelated refactoring. Phase 1
   of Layer 2 defers inline resolution to future work.
4. **Ambiguity:** All error scenarios have explicit behavior. JSON format has field
   definitions with types. Import flow has two-step commit.

---

## References

- `/docs/superpowers/CONTINUATION.md` — Previous session's verified state
- `/docs/superpowers/REMARK-section-wrapper-pattern.md` — GB section wrapper conventions
- `/plugin/generateblocks-pro/includes/styles/class-styles.php` — GB Pro Global Styles
  PHP class (menu registration, CPT queries, CSS generation)
- `/plugin/generateblocks-pro/includes/styles/class-styles-post-type.php` —
  `gblocks_styles` CPT registration
- `/plugin/generateblocks-pro/includes/class-global-styles.php` — Deprecated legacy
  Global Styles (`gblocks_global_style` CPT)
- `/src/core/orchestrator.ts` — Current conversion pipeline
- `/src/cli/index.ts` — CLI entry point
