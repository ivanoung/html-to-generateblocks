# Project-Level Tailwind Compilation + Content-Loss Verification

2026-06-07 | Status: accepted

## Problem

`styles.css` is compiled from the first converted page's Tailwind classes only.
Subsequent pages reuse it via `--skip-shared`, so arbitrary value classes unique
to pages 2+ (e.g. `bg-[#4C4656]`, `text-[#F8F7FA]`) have no CSS rules and
render as browser defaults. This produces silently broken output — wrong colors,
missing backgrounds, incorrect text sizes — with no warning.

Additionally, there is no verification that the conversion preserved the source
content. Silent data loss (empty core/html blocks, dropped inline elements) goes
undetected until someone views the page in WordPress.

## Design

### 1. CLI surface

Two invocation modes, auto-detected:

```
npx tsx src/cli/index.ts convert inputs/mino/           # project mode (directory)
npx tsx src/cli/index.ts convert inputs/mino/index.html  # single-page (unchanged)
```

Project mode: the path ends with `/` or is a directory → process all `.html`
files inside. Single-page mode: the path is a `.html` file → as before.

### 2. Shared compilation pass (project mode only)

New internal function `compileProjectShared(projectDir)`:

1. Read all `.html` files from the input directory
2. Concatenate them into one HTML string (each page wrapped in a container to
   keep Tailwind's content scanner happy)
3. Run the Tailwind inliner once on the combined content — produces a single
   `compiledCss` containing ALL Tailwind classes from ALL pages
4. Run the iconify resolver on the combined content
5. Extract custom CSS from `<style>` blocks on EACH page individually, merge
   into one `customCss` string (deduplicating identical rules)
6. Run `analyzeSource` on the combined content for consolidated manual-steps
7. Run `generateCustomizerSettings` from the first page's Tailwind config
8. Write shared output files once:
   - `output/<project>/styles.css`
   - `output/<project>/customizer-import.json`
   - `output/<project>/manual-steps.txt`

Then for each individual page:
- Run the full pipeline (preprocess → walk → serialize → validate), but
  **skip** the Tailwind inliner (CSS already compiled) and **skip** shared
  file writes
- Write `output/<project>/<pageName>.html` and `output/<project>/<pageName>.report.json`

The `--skip-shared` flag becomes a no-op in project mode and remains
functional for single-page mode.

### 3. Content-loss verification

After each page converts, compare source vs output to detect silent loss:

1. Strip known-removable elements from source: nav, footer, script, link,
   style, head, HTML comments
2. Count text content length of the stripped source (`sourceLen`)
3. Count text content length of the output blocks **excluding** GB metadata
   delimiters (`<!-- wp:... -->`, `<!-- /wp:... -->`) — count only block
   body content (`outputLen`)
4. If `outputLen < sourceLen * 0.95` (>5% loss): emit a prominent warning in
   the report and CLI output:
   `[LOSS] Page lost ~X% of text content during conversion — check for missing elements`

This is a **warning**, not a hard fail. The output is still valid GB markup.
But the warning tells the user "something vanished — investigate before
pasting into WordPress."

Some loss is expected (nav, footer text removed), but >5% indicates a
converter bug (empty core/html, dropped inline children, etc.).

## Scope

What this changes:
- `src/cli/index.ts` — detect directory vs file, fork to project mode
- `src/core/orchestrator.ts` — new `convertProject()` function doing shared
  pass + per-page loop
- `src/core/types.ts` — `ConversionInput` gains new fields (skipInliner flag)
- New `src/core/content-verifier.ts` — content-loss comparison logic

What this does NOT change:
- Fixture pipeline (unaffected)
- Single-page mode behavior (unchanged, `--skip-shared` still works)
- Validator (unchanged — loss check is a new concern, not a validation rule)
- Tailwind inliner internals (unchanged — just called differently)

## Verification

- All 20 fixtures pass unchanged
- M1 regression snapshots match
- `convert inputs/mino/` produces styles.css containing fast-seo's
  classes (`bg-[#4C4656]`, `text-[#F8F7FA]`)
- Content-loss check: flag the fast-seo conversion if it were run with
  the old broken pipeline (dotted background vanishing = significant loss)
