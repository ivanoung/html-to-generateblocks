# CSS Split & Global Styles Export

> **Status:** Design approved — ready for implementation plan

**Goal:** Split the compiled `styles.css` into two outputs: a `global-styles.json` containing single-class CSS rules importable into GenerateBlocks Global Styles, and a `styles-unique.css` containing everything else (preflight, element selectors, keyframes, pseudo-elements). Place these plus existing shared assets into a `setup/` subfolder within the project output directory.

**Architecture:** A new `css-splitter.ts` module parses the final compiled CSS using the `css` npm package (already a dependency). It classifies each rule by selector type. The orchestrator calls it after building `combinedCss` and writes the additional output files. `styles.css` remains unchanged as the master fallback.

**Tech Stack:** TypeScript, `css` npm package (v3.0.0), Node.js fs

---

## Output Structure

```
output/mino/
  setup/                         ← new folder
    manual-steps.txt             ← moved from output/mino/
    customizer-import.json       ← moved from output/mino/
    global-styles.json           ← class-based rules for GB import
    styles-unique.css            ← non-class CSS (preflight, keyframes, etc.)
  index.html                     ← unchanged
  blog.html                      ← unchanged
  ...
  styles.css                     ← unchanged (master, always the complete fallback)
```

---

## Classification Rules

A CSS rule goes to **global-styles.json** if and only if its selector is a single class selector:

| Selector | Destination | Reason |
|---|---|---|
| `.pt-32` | global-styles.json | Single class |
| `.md\:text-7xl` (inside `@media`) | global-styles.json | Single class, `@media` wrapper preserved in CSS |
| `.hover\:bg-seafoam:hover` | global-styles.json | Single class with pseudo-class |
| `body` | styles-unique.css | Element selector |
| `*, :after, :before` | styles-unique.css | Multiple/complex selector |
| `@keyframes spin` | styles-unique.css | Keyframe, not a class rule |
| `.no-scrollbar::-webkit-scrollbar` | styles-unique.css | Pseudo-element |
| `h1, h2, h3, h4, h5, h6` | styles-unique.css | Element selectors |

**Rule for `@media` blocks:** If a `@media` block contains only single-class rules, each class rule becomes its own global-styles entry with the `@media` wrapper preserved in the CSS. The `@media` block itself is not a separate entry.

---

## global-styles.json Format

Each entry maps to one GenerateBlocks Global Style (`gblocks_styles` custom post type):

```json
[
  {
    "name": "Pt 32",
    "selector": ".pt-32",
    "css": ".pt-32{padding-top:8rem}"
  },
  {
    "name": "Md Text 7xl",
    "selector": ".md\\:text-7xl",
    "css": "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem;line-height:1}}"
  }
]
```

| Field | Description |
|---|---|
| `name` | Human-readable label derived from class name (kebab → Title Case) |
| `selector` | The CSS class selector, backslash-escaped as in CSS (e.g., `\:` for `:`) |
| `css` | Complete CSS rule block. For responsive classes, includes the `@media` wrapper. Minified. |

---

## Files

### New: `src/core/css-splitter.ts`

**Interface:**
```typescript
export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

export function splitCss(compiledCss: string): CssSplitResult;
```

**Logic:**
1. Parse CSS with `css` package into AST
2. Walk all rules (top-level and nested inside `@media`)
3. For each rule: check if selector is a single class (`.class-name` or `.class\:name` or `.class\:name:pseudo`)
   - Yes → create `GlobalStyleEntry`, include any parent `@media` wrapper in `css`
   - No → append rule text to `uniqueCss`
4. Return both

**Single-class detection:** The selector string (after stripping pseudo-classes like `:hover`) must match `/^\.[a-zA-Z_-][\w-]*(\\:[a-zA-Z_-][\w-]*)*$/` and contain no combinators (`>`, `+`, `~`, ` `), no commas, no pseudo-elements (`::`).

### Modify: `src/core/orchestrator.ts`

- Import `splitCss` from `css-splitter.ts`
- After `combinedCss` is built and before writing files:
  - Call `splitCss(combinedCss)`
  - Write `setup/global-styles.json` (JSON array of entries)
  - Write `setup/styles-unique.css` (the unique CSS)
- Change output paths for `customizer-import.json` and `manual-steps.txt` to write into `setup/` subfolder
- `styles.css` write path stays at project root (unchanged)

### Modify: `src/cli/index.ts`

- Update console output messages to show `setup/` paths for the moved files

---

## Error Handling

- If CSS parsing fails (malformed CSS), `splitCss` returns empty `globalStyles` and the original CSS as `uniqueCss` — no data loss
- Empty CSS input → empty results, no error

## Testing

- Unit test: `css-splitter` with sample Tailwind CSS containing classes, media queries, keyframes, and element selectors
- Fixture regression: run `fixtures:run-all` to confirm no existing output breaks
- Manual verification: run `convert inputs/mino/` and check `setup/` folder contents

---

## Scope Boundaries

**In scope:**
- Splitting compiled CSS into global-styles.json + styles-unique.css
- Moving customizer-import.json and manual-steps.txt into setup/
- Updating CLI output messages

**Out of scope:**
- Auto-import into WordPress (the JSON file is for manual or scripted import)
- Changing the GB block markup or globalClasses attributes
- The slate shade auto-expansion (separate deferred item)
- Generating a WP CLI import script
