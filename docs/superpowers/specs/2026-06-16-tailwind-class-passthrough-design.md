# Tailwind Class Passthrough — Design Spec

**Date:** 2026-06-16
**Status:** Draft
**Scope:** Add Tailwind CSS support to the gb-converter pipeline via class passthrough + compiled static CSS + companion WordPress plugin.

---

## Motivation

The old Tailwind pipeline (resolved via Playwright → computed styles → style classifier → GB attribute promotion) was complex, fragile, and lossy. The new strategy is simpler: keep Tailwind classes as real CSS classes on block markup, compile a static `tailwind.css` from the source config, and deliver it to WordPress via a companion plugin.

## Architecture Overview

```
Source HTML
  │
  ├─(1)── Tailwind Config Extractor ──► JS config object
  │                                      │
  │                                   (2) JS → v4 @theme translator
  │                                      │
  │                                   (3) Tailwind CLI compile
  │                                      │
  │                                      ├── tailwind.css
  │                                      └── tailwind-manifest.json (known classes)
  │
  ├─(4)── Preprocessor (existing) ──► classNameToProperties, customCss
  │
  ├─(5)── DOM Walker (modified) ──► blocks with className + GB styles
  │         ◄── classNameToProperties
  │         ◄── tailwindClasses (Set)
  │
  └─(6)── Serializer (existing) ──► GB block markup
```

The pipeline gains one new stage (1–3) before the existing preprocessor. The DOM walker (5) gains one new input (`tailwindClasses`). Everything else stays the same.

## Section 1 — Tailwind Config Extraction

### 1.1 Extraction

The converter intercepts the source HTML before the preprocessor strips `<script>` tags. It locates the `<script>` block containing `tailwind.config = {...}`, extracts the JS config object, and parses it.

Regex pattern to locate the config:
```ts
/tailwind\.config\s*=\s*(\{[\s\S]*?\n\})/
```

**Fallback path:** The regex approach handles most CDN-sourced configs (single-line JS objects). If real-world configs prove too complex (nested objects, comments, template literals), the implementation plan includes a documented contingency to replace extraction with a lightweight JS parser (acorn + estree walk). Fuzz tests must exercise nested objects, trailing commas, and minified formats before considering regex sufficient.

**Manifest generation robustness:** The class-extraction regex scanning `tailwind.css` is sufficient for initial implementation. During integration testing, validate the manifest against a known test fixture to detect false positives/negatives. If issues emerge with complex selectors or escaped variants, the implementation plan notes PostCSS + Tailwind's internal class list as a future upgrade path.

If no config is found → silent skip. Converter produces valid output without Tailwind.

### 1.2 JS → v4 @theme Translation

Tailwind v4 CLI uses CSS-based configuration with `@theme` blocks. The source HTML uses a JavaScript config object. The converter translates between them.

**Mapping table:**

| JS Config | v4 @theme CSS |
|---|---|
| `theme.extend.colors.primary: "#C5FFD6"` | `--color-primary: #C5FFD6;` |
| `theme.extend.fontFamily.display: ['Anybody', 'sans-serif']` | `--font-display: "Anybody", sans-serif;` |
| `theme.extend.maxWidth.container: '1600px'` | `--max-width-container: 1600px;` |

**Keys supported for translation:**
- `theme.extend.colors.*` → `--color-*`
- `theme.extend.fontFamily.*` → `--font-*`
- `theme.extend.fontSize.*` → `--font-size-*`
- `theme.extend.fontWeight.*` → `--font-weight-*`
- `theme.extend.lineHeight.*` → `--line-height-*`
- `theme.extend.letterSpacing.*` → `--letter-spacing-*`
- `theme.extend.spacing.*` → `--spacing-*`
- `theme.extend.maxWidth.*` → `--max-width-*`
- `theme.extend.borderRadius.*` → `--radius-*`
- `theme.extend.boxShadow.*` → `--shadow-*`
- `theme.extend.zIndex.*` → `--z-index-*`
- `theme.extend.opacity.*` → `--opacity-*`
- `theme.extend.screens.*` → `--breakpoint-*`

**Unsupported patterns (warn and skip):**
- Dynamic `theme()` calls (e.g., `theme('colors.red.500')`)
- Nested theme overrides beyond `theme.extend`
- Plugin references
- Array-based values with complex object entries (e.g., `fontSize: { sm: ['0.875rem', { lineHeight: '1.25rem' }] }`) — warn, skip the nested object, use the first array value only

### 1.3 Compilation

Generate a CSS input file for the Tailwind CLI:

```css
@import "tailwindcss";

@theme {
  --color-primary: #C5FFD6;
  --color-surface: #1E293B;
  /* ... translated values ... */
}
```

Run: `npx @tailwindcss/cli -i <input.css> -o <output.css>`

**Build mode:** Full build (no content scanning, no purging). This avoids the class-discoverability problem where GB-wrapped classes wouldn't be in a content glob.

### 1.4 Known-Classes Manifest

After compilation, scan the generated `tailwind.css` for class selectors:

```ts
const classRegex = /\.((?:[a-zA-Z0-9\[\]\/\#\.\:%_-]|\\.)+)/g;
```

This captures standard classes (`.flex`), responsive variants (`.md\:flex`), state variants (`.hover\:bg-primary`), and arbitrary values (`.w-\[42px\]`). Output as `tailwind-manifest.json` — a JSON array of class strings.

## Section 2 — DOM Walker Changes

### 2.1 New Input

`walkElement` gains `tailwindClasses: Set<string>` through `WalkerOptions`:

```ts
interface WalkerOptions {
  classNameToProperties: Map<string, BlockStyles>;
  collector: GlobalStylesCollector;
  warnings: string[];
  hardFails: { code: string; message: string }[];
  inlineStyles?: Record<string, Record<string, string>>;
  tailwindClasses?: Set<string>;  // NEW
}
```

### 2.2 Class Splitting Logic

For each element with a `class` attribute:

1. **Tailwind classes** (present in `tailwindClasses`) → accumulate into tailwindClassList array
2. **Custom CSS classes** (present in `classNameToProperties`) → resolved to block styles (existing behavior)
3. **Unknown classes** → resolved to block styles with a warning (filtered — see §2.4)

**Precedence:** If a class appears in both `tailwindClasses` and `classNameToProperties`, Tailwind wins. It goes to `className`. This is explicit in code with a comment and a test case.

### 2.3 ClassName Output

Tailwind classes land on the block's `className` attribute. Order preserved from source HTML.

Example input: `<div class="flex items-center gap-4 blueprint-bg">`

Output:
```
<!-- wp:generateblocks/element {"uniqueId":"elem001","className":"flex items-center gap-4",...} -->
<div class="gb-element-elem001 flex items-center gap-4">...</div>
<!-- /wp:generateblocks/element -->
```

`blueprint-bg` (custom, from `<style>` blocks) resolves to GB styles as before.

**Dedup guard:** Final className string has no duplicate class tokens.

### 2.4 Warning Filter

Unknown classes (in neither set) trigger a warning only when they match a custom-CSS-like naming pattern — at least one hyphen or underscore, and not on the allowlist. Known-benign classes from WordPress core and common plugins are suppressed to avoid warning-spam.

**Allowlist:** `wp-*`, `has-*`, `is-*`, `align*`, `gb-*`, `iconify-*`, `icon-*`, `js-*`, `no-js`, `screen-reader-text`, `skip-link`, `post-*`, `page-*`, `menu-*`, `widget-*`, `comment-*`, `search-*`, `archive-*`, `author-*`, `category-*`, `tag-*`, `attachment-*`, `sticky`, `bypostauthor`, `admin-bar`, `custom-background`, `custom-logo`, `custom-header`, `wp-caption-*`, `gallery-*`, `blocks-gallery-*`.

**Pattern for warning:** `/^[a-zA-Z][\w-]*(?:--?[\w-]+)+$/` — matches classes like `blueprint-bg`, `hero-section`, `custom-card` while allowing single-word classes like `container`, `wrapper`, `row` to pass silently.

## Section 3 — Companion WordPress Plugin

### 3.1 Scope

Single PHP file (`gb-tw-plugin.php`) generated by the converter. Does exactly three things and nothing more:

1. **Enqueue tailwind.css** — frontend (`wp_enqueue_scripts`) and editor (`enqueue_block_editor_assets`)
2. **Enqueue styles.css** — same hooks, for custom CSS from `<style>` blocks
3. **Register known Tailwind classes** with the block editor — via `block_editor_settings_all` filter, using the serialized `tailwind-manifest.json`

### 3.2 Implementation Template

```php
<?php
/**
 * Plugin Name: GB Tailwind Styles
 * Description: Enqueues Tailwind CSS for GenerateBlocks sites. Auto-generated by gb-converter.
 * Version: 1.0.0
 */

define('GB_TW_DIR', __DIR__);

function gb_tw_enqueue_frontend() {
    $tw_css = GB_TW_DIR . '/tailwind.css';
    $styles_css = GB_TW_DIR . '/pages/styles.css';
    if (file_exists($tw_css)) {
        wp_enqueue_style('gb-tailwind', plugin_dir_url(__FILE__) . 'tailwind.css', [], filemtime($tw_css));
    }
    if (file_exists($styles_css)) {
        wp_enqueue_style('gb-custom', plugin_dir_url(__FILE__) . 'pages/styles.css', [], filemtime($styles_css));
    }
}
add_action('wp_enqueue_scripts', 'gb_tw_enqueue_frontend');

function gb_tw_enqueue_editor() {
    $tw_css = GB_TW_DIR . '/tailwind.css';
    $styles_css = GB_TW_DIR . '/pages/styles.css';
    if (file_exists($tw_css)) {
        wp_enqueue_style('gb-tailwind-editor', plugin_dir_url(__FILE__) . 'tailwind.css', [], filemtime($tw_css));
    }
    if (file_exists($styles_css)) {
        wp_enqueue_style('gb-custom-editor', plugin_dir_url(__FILE__) . 'pages/styles.css', [], filemtime($styles_css));
    }
}
add_action('enqueue_block_editor_assets', 'gb_tw_enqueue_editor');

function gb_tw_safelist_classes($settings) {
    $manifest = GB_TW_DIR . '/tailwind-manifest.json';
    if (!file_exists($manifest)) return $settings;
    $classes = json_decode(file_get_contents($manifest), true);
    if (!is_array($classes)) return $settings;
    // Merge into allowed block classes so Gutenberg doesn't strip them
    $settings['allowedBlockClasses'] = array_merge(
        $settings['allowedBlockClasses'] ?? [],
        $classes
    );
    return $settings;
}
add_filter('block_editor_settings_all', 'gb_tw_safelist_classes');
```

### 3.3 Output Structure

```
output/<project>/
  ├── pages/
  │   ├── index.html              # GB block markup
  │   ├── styles.css              # custom CSS from <style> blocks
  │   └── index.report.json
  ├── tailwind.css                 # compiled Tailwind build
  ├── tailwind-manifest.json       # known classes list (JSON array)
  └── gb-tw-plugin.php             # companion plugin (one file)
```

## Section 4 — Error Handling

| Failure | Behavior |
|---|---|
| No Tailwind config in source | Silent skip — converter works as before, no tailwind.css produced |
| Malformed config (invalid JS, parse failure) | Warn, skip Tailwind compilation, output still valid |
| Tailwind CLI unavailable | Warn, skip compilation, output still valid |
| Tailwind CLI compilation error | Warn with stderr, skip, output still valid |
| Class in both Tailwind manifest AND custom CSS | Tailwind wins → className (documented precedence) |
| Class in neither set | Warn (filtered — see §2.4) |

The converter never fails because of Tailwind. Tailwind is an enhancement, not a dependency.

## Section 5 — Testing Strategy

### 5.1 Unit Tests

**Config extraction:** Feed HTML snippets with valid, malformed, and missing Tailwind configs. Assert correct extraction or graceful skip.

**JS → @theme translation:** Given a known JS config object, assert the generated `@theme` block matches expected CSS.

**Class splitting:** Mock `tailwindClasses` Set + `classNameToProperties` Map. Feed DOM walker elements with mixed class strings. Assert Tailwind classes land on `className`, custom classes resolve to styles, precedence when a class appears in both, unknown class warning behavior.

### 5.2 Integration Tests

**Full pipeline:** Run `convert` on a small HTML fixture with mixed classes (`flex bg-primary blueprint-bg`) with matching `<style>` and Tailwind config. Assert:
- Output `className="flex bg-primary"`
- `blueprint-bg` resolved in block styles
- `tailwind.css`, `tailwind-manifest.json`, `gb-tw-plugin.php` exist

**Manifest coverage:** After a full build, scan `tailwind-manifest.json` and assert it contains responsive variants (`md:flex`), state variants (`hover:bg-primary`), and arbitrary values (`w-[42px]`).

### 5.3 Test Fixture

New fixture: `fixtures/tailwind-passthrough.json` exercising all three class categories (Tailwind utility, custom CSS class, unknown/benign).

## Section 6 — Code Reuse from Archive

Useful code in `src/archive/tailwind/` that can be adapted:

| Module | Reuse |
|---|---|
| `tailwind-resolver.ts` | Config extraction logic (regex-based location of `tailwind.config = {...}`) |
| `tailwind-cleaner.ts` | `BLOCK_TAGS` set, `WALKER_TAGS` list — useful constants, but `data-gb-path` injection is NOT needed (no computed-style promotion) |
| `tailwind-inliner.ts` | Playwright-based computed-style extraction — NOT needed (we're not resolving styles anymore) |
| `style-classifier.ts` | Frequency-based classification — NOT needed (no style promotion) |

## Section 7 — Refinements Incorporated

From multi-model review of each design section:

**DOM Walker (Section 2):**
- Preserve original class order in className output (don't group Tailwind classes together)
- Dedup guard on final className string
- Warning filter for unknown classes to avoid noise from WordPress core classes

**Companion Plugin (Section 3):**
- Also enqueue `styles.css` (not just `tailwind.css`)
- Use `__DIR__` for co-located file paths
- Include standard WordPress plugin headers
- Cache-busting via `filemtime()` on enqueued CSS
- `allowedBlockClasses` safelist to prevent Gutenberg from stripping Tailwind classes

## Section 8 — Deployment Workflow

After running `convert`, the user deploys to WordPress:

1. **Copy the project output folder** (`output/<project>/`) into `wp-content/plugins/gb-tailwind-<project>/`
2. **Activate the plugin** from WordPress Admin → Plugins (look for "GB Tailwind Styles")
3. **Paste block markup** from `pages/*.html` into the WordPress block editor
4. **Verify:** Tailwind-styled blocks should render correctly in both the editor preview and the published frontend
5. **Re-run `convert`** whenever the source HTML changes — copy the new output folder over the old one; `filemtime()` cache-busting ensures browsers pick up the new CSS

The plugin is project-specific. Multiple projects each get their own companion plugin with a unique handle prefix (`gb-tailwind-<project>`) to avoid conflicts.

## Section 9 — Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| Tailwind CLI | v4.3.0+ | Required for `@theme` block compilation |
| WordPress | 5.8+ | Required for `block_editor_settings_all` filter |
| Node.js | Same as project minimum (v22+) | Already a devDependency |

During `convert`, check that `npx @tailwindcss/cli --help` succeeds before attempting compilation. Warn and skip if unavailable.

## Section 10 — Risks and Mitigations

| Risk | Mitigation |
|---|---|
| JS config uses unsupported patterns (dynamic `theme()` calls) | Warn and skip — converter still produces valid output |
| Compiled `tailwind.css` is large (full build, no purging) | Document the trade-off; offer optional purge mode as a future enhancement if file size becomes an issue |
| CSS specificity conflicts between Tailwind utilities and GB inline styles | GB inline styles use `.gb-element-xxx` selector prefix; Tailwind uses bare class selectors. No known conflict, but flag for smoke testing |
| Plugin activation fails on older WordPress versions | Document minimum version (WordPress 5.8+ for `block_editor_settings_all`) |
