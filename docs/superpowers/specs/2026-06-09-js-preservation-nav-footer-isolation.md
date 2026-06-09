# JS Preservation + Nav/Footer Isolation + Pages Folder

> **Status:** Design approved — ready for implementation plan

**Goal:** Preserve all JavaScript from source pages (external references + inline content), isolate nav/footer from the index page into separate fully-converted components, and reorganize output into a three-folder structure: `setup/`, `components/`, `pages/`.

**Architecture:** A new `script-extractor.ts` module extracts and classifies `<script>` tags before the preprocessor strips them. The nav/footer are captured from the DOM before stripping and run through the full conversion pipeline. The CLI orchestrates the new folder structure and wires everything together.

**Tech Stack:** TypeScript, cheerio (existing), Node.js fs/fetch

---

## Output Structure

```
output/mino/
  setup/
    global.js                 ← scripts shared across ALL pages
    global-styles.json        ← class-based rules for GB import
    styles-unique.css         ← non-class CSS (keyframes, media queries, etc.)
    customizer-import.json    ← GeneratePress customizer settings
    manual-steps.txt          ← post-conversion checklist
  components/
    nav/
      nav.html                ← nav as GB blocks (full pipeline)
      nav.report.json
      nav.js                  ← nav-specific scripts (if any)
    footer/
      footer.html
      footer.report.json
      footer.js
  pages/
    styles.css                ← master CSS (complete fallback)
    index.html                ← page GB blocks
    index.js                  ← page-specific scripts
    index.report.json
    blog.html
    blog.js
    blog.report.json
    ...
```

---

## JS Preservation

### Extraction

All `<script>` tags are collected from each source page before the preprocessor strips them. Both external (`<script src="...">`) and inline (`<script>...</script>`) are captured.

### Classification (cross-page comparison)

| Condition | Destination |
|---|---|
| Script appears on ALL pages | `setup/global.js` |
| Script appears on some pages only | `pages/{pagename}.js` |

- **Inline scripts:** compared by content after trimming whitespace
- **External scripts:** compared by `src` URL (exact match)
- Scripts are output in source order

### JS File Format

```javascript
// === External Scripts ===
// Enqueue in functions.php or add via WPCode snippet plugin:
//   Original: <script src="https://cdn.tailwindcss.com"></script>
//   WP: wp_enqueue_script('tailwind-cdn', 'https://cdn.tailwindcss.com', [], null, true);
//
//   Original: <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
//   WP: wp_enqueue_script('iconify', 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js', [], '1.0.7', true);

// === Inline Scripts ===

// -- From index.html (shared) --
(function() {
  // preserved inline content
})();
```

- External scripts: comment with original tag + `wp_enqueue_script` suggestion
- Inline scripts: content preserved as-is, preceded by source comment
- Handle: `src` attribute for `script` named `iconify-icon` (don't enqueue twice if already in manual-steps)

### Nav/Footer JS

Scripts found inside `<nav>` or `<footer>` HTML during extraction are treated as component-specific:
- `<script>` tags inside nav → `components/nav/nav.js`
- `<script>` tags inside footer → `components/footer/footer.js`
- These are NOT included in page-level or global JS (they belong to the component)

---

## Nav/Footer Isolation

### Source

Extracted from the **index/home page** only (first page in project, assumed representative).

### Extraction

Before the preprocessor's `STRIP_TAGS` logic removes `<nav>` and `<footer>`, their inner HTML is captured using cheerio. The full HTML snippet (including the tag itself) is saved for pipeline processing.

### Processing

Each component runs through the full pipeline independently:

1. **Preprocess** — strip scripts/links, resolve iconify, scan styles
2. **DOM walk** — convert HTML elements to GB blocks
3. **Serialize** — produce block markup
4. **Validate** — check for issues

The component is treated as a standalone page for conversion purposes. The Tailwind and custom CSS are already handled by the shared `styles.css` / `global-styles.json` — components just reference those.

### Scripts

Any `<script>` tags inside the nav/footer HTML are extracted and output to the component's `.js` file. These are NOT included in global or page-level JS.

### Manual Steps

Updated to reference `components/nav/nav.html` and `components/footer/footer.html` instead of "rebuild manually."

---

## Pages Folder

All page-level outputs move from `output/mino/` root into `output/mino/pages/`:

| File | Old Path | New Path |
|---|---|---|
| `index.html` | `output/mino/index.html` | `output/mino/pages/index.html` |
| `index.report.json` | `output/mino/index.report.json` | `output/mino/pages/index.report.json` |
| `styles.css` | `output/mino/styles.css` | `output/mino/pages/styles.css` |
| Page JS files | (new) | `output/mino/pages/{name}.js` |

---

## Implementation Files

### New: `src/core/script-extractor.ts`

- `extractScripts(html: string): ScriptEntry[]` — parse all `<script>` from HTML
- `classifyScripts(allPages: Map<string, ScriptEntry[]>): { global: ScriptEntry[], perPage: Map<string, ScriptEntry[]> }` — cross-page comparison
- `formatJsFile(scripts: ScriptEntry[]): string` — produce .js file content
- `ScriptEntry` type: `{ type: 'external' | 'inline', src?: string, content: string, sourcePage: string }`

### Modify: `src/core/preprocessor.ts`

- Before stripping nav/footer, extract and return their HTML
- New fields in `PreprocessResult`:
  - `navHtml: string | null`
  - `footerHtml: string | null`

### Modify: `src/core/orchestrator.ts`

- `ConversionInput` gains optional `scripts: ScriptEntry[]` and `outputJsPath: string`
- Write `.js` file alongside `.html` for each page
- `styles.css` writes to `pages/` subfolder

### Modify: `src/cli/index.ts`

- Project mode: extract all scripts → classify → write `setup/global.js`
- Per-page: extract page scripts → write `pages/{name}.js`
- Extract nav/footer from index page → run full `convert()` → write to `components/`
- Update all output paths to `pages/` subfolder
- Update console output messages

### Modify: `src/core/manual-steps.ts`

- Reference `components/nav/nav.html` and `components/footer/footer.html`
- Add step about `setup/global.js` and page `.js` files
- Add WPCode/plugin suggestion for JS

---

## Error Handling

- Page with no scripts → skip .js file creation (no empty file)
- Nav/footer not present in source → skip component folder creation
- Single page in project → all scripts go to `setup/global.js` (no per-page comparison needed)

## Testing

- Unit test: `script-extractor` with sample HTML containing inline and external scripts
- Unit test: cross-page classification logic
- Fixture regression: `fixtures:run-all` — confirm no existing output breaks
- Manual: run `convert inputs/mino/` and verify new folder structure

## Scope Boundaries

**In scope:**
- Script extraction, classification, and .js file generation
- Nav/footer isolation with full pipeline conversion
- Pages folder reorganization

**Out of scope:**
- Auto-enqueueing scripts in WordPress (manual step)
- Smart detection of which page's nav/footer to use (always index page)
- Combining nav/footer into a single template part (separate feature)
