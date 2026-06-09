# JS Preservation + Nav/Footer Isolation + Pages Folder

> **Status:** Design approved — ready for implementation plan

**Goal:** Preserve all JavaScript from source pages into a single `setup/global.js`, isolate nav/footer from the index page into fully-converted components, and reorganize output into `setup/`, `components/`, `pages/`.

**Architecture:** A new `script-extractor.ts` module extracts all `<script>` tags before the preprocessor strips them and writes them to `setup/global.js`. The nav/footer are captured from the DOM before stripping and run through the full conversion pipeline. The CLI orchestrates the new folder structure.

**Key decision:** All JS goes to one file — no per-page split, no nav/footer JS isolation. This avoids animation breakage from script classification errors, load-order issues, and GB wrapper DOM changes. Load `global.js` on every page unconditionally.

**Tech Stack:** TypeScript, cheerio (existing), Node.js fs

---

## Output Structure

```
output/mino/
  setup/
    global.js                 ← ALL scripts (external refs + inline content from every page, deduplicated)
    global-styles.json        ← class-based rules for GB import
    styles-unique.css         ← non-class CSS (keyframes, media queries, etc.)
    customizer-import.json    ← GeneratePress customizer settings
    manual-steps.txt          ← post-conversion checklist
  components/
    nav/
      nav.html                ← nav as GB blocks (full pipeline)
      nav.report.json
    footer/
      footer.html             ← footer as GB blocks (full pipeline)
      footer.report.json
  pages/
    styles.css                ← master CSS (complete fallback)
    index.html                ← page GB blocks
    index.report.json
    blog.html
    blog.report.json
    ...
```

---

## JS Preservation

### Extraction

All `<script>` tags are collected from every source page before the preprocessor strips them. Both external (`<script src="...">`) and inline (`<script>...</script>`) are captured.

The minimum viable extractor — no classification, no per-page files:

1. Walk every source page
2. Collect all `<script>` tags (external by `src`, inline by `textContent`)
3. Deduplicate: same `src` URL → skip duplicate; same inline content → skip duplicate
4. Write all to `setup/global.js`

### JS File Format

```javascript
// === External Scripts ===
// Enqueue in functions.php or add via WPCode snippet plugin:
//
//   <script src="https://cdn.tailwindcss.com"></script>
//   wp_enqueue_script('tailwind-cdn', 'https://cdn.tailwindcss.com', [], null, true);
//
//   <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
//   wp_enqueue_script('iconify', 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js', [], '1.0.7', true);

// === Inline Scripts ===

// -- From index.html --
document.addEventListener('DOMContentLoaded', function() {
  // preserved inline content
});

// -- From fast-seo.html --
new Splide('.splide', { ... }).mount();
```

- External: comment block with original tag + `wp_enqueue_script` suggestion
- Inline: content as-is, preceded by source page comment
- Deduplication: by normalized content (trimmed) for inline, by `src` URL for external

### Nav/Footer JS

Scripts inside `<nav>` or `<footer>` are included in `global.js` along with everything else. No separate component JS files. This avoids breaking scroll-triggered animations and other cross-element JS that spans nav + page content.

---

## Nav/Footer Isolation

### Source

Extracted from the **index/home page** only. Assumed representative for the entire site.

### Extraction

Before the preprocessor's `STRIP_TAGS` logic removes `<nav>` and `<footer>`, their inner HTML is captured using cheerio. The original `<nav>`/`<footer>` wrapper is preserved in the captured HTML.

### Processing

Each component runs through the full conversion pipeline independently:

1. **Preprocess** — strip scripts/links, resolve iconify, scan styles
2. **DOM walk** — convert HTML elements to GB blocks
3. **Serialize** — produce block markup
4. **Validate** — check for issues

The shared `styles.css` / `global-styles.json` / `global.js` already provide CSS and JS — components just reference them.

### Output

```
components/
  nav/
    nav.html          ← GB block markup
    nav.report.json   ← conversion report
  footer/
    footer.html
    footer.report.json
```

No `.js` files for components — all JS in `setup/global.js`.

---

## Pages Folder

All page-level outputs move from `output/mino/` root into `output/mino/pages/`:

| File | Old Path | New Path |
|---|---|---|
| `index.html` | `output/mino/index.html` | `output/mino/pages/index.html` |
| `index.report.json` | `output/mino/index.report.json` | `output/mino/pages/index.report.json` |
| `styles.css` | `output/mino/styles.css` | `output/mino/pages/styles.css` |

---

## Implementation Files

### New: `src/core/script-extractor.ts`

```typescript
export interface ScriptEntry {
  type: 'external' | 'inline';
  src?: string;        // external only
  content: string;     // inline: the script text; external: the src URL
  sourcePage: string;  // which page it came from
}

export function extractScripts(html: string, pageName: string): ScriptEntry[];
export function deduplicateScripts(allScripts: ScriptEntry[]): ScriptEntry[];
export function formatGlobalJs(scripts: ScriptEntry[]): string;
```

### Modify: `src/core/preprocessor.ts`

- Before stripping nav/footer, extract their HTML
- New fields in `PreprocessResult`:
  ```typescript
  navHtml: string | null;
  footerHtml: string | null;
  ```

### Modify: `src/core/orchestrator.ts`

- Writing paths use `pages/` subfolder for page outputs
- `styles.css` writes to `pages/` instead of project root

### Modify: `src/cli/index.ts`

- Project mode:
  1. Extract all scripts from all pages → deduplicate → write `setup/global.js`
  2. Extract nav/footer from first page → run `convert()` → write to `components/`
  3. Convert each page → write to `pages/`
- Update all console output messages
- Single-page mode also writes to `pages/` (consistent structure)

### Modify: `src/core/manual-steps.ts`

- Step for `components/nav/nav.html` and `components/footer/footer.html`
- Step for `setup/global.js` — enqueue or use WPCode
- Remove old "rebuild nav/footer manually" steps

---

## Error Handling

- Page with no scripts → skip script extraction for that page, global.js still generated from remaining pages
- Nav/footer not present in source → skip component folder, no error
- Single page in project → no deduplication needed, all scripts go to global.js
- Empty global.js → skip file creation (don't write empty file)

## Testing

- Unit test: `extractScripts` with inline + external scripts
- Unit test: `deduplicateScripts` with duplicate inline + external entries
- Unit test: `formatGlobalJs` output format
- Fixture regression: `fixtures:run-all` — output paths changed, update snapshot expectations
- Manual: `convert inputs/mino/` → verify folder structure

## Scope Boundaries

**In scope:**
- Script extraction + deduplication → `setup/global.js`
- Nav/footer isolation → `components/` with full pipeline conversion
- Pages folder reorganization

**Out of scope:**
- Per-page JS files
- Component-specific JS files
- Auto-enqueueing in WordPress
- Nav/footer smart detection across pages
