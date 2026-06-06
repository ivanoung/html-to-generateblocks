# Style Transfer Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three-layer style transfer to the GB converter: theme settings extraction (Layer 1), global styles JSON generation + admin page snippet (Layer 2), and project-based output folders (all layers).

**Architecture:** Two new modules (`theme-settings-extractor.ts`, `global-styles-generator.ts`) connect into the existing orchestrator. A standalone PHP snippet provides the WordPress admin page for importing Layer 2 output. The CLI derives project name from input path. All new CSS parsing uses a hand-rolled scanner (no external CSS parser dependency).

**Tech Stack:** TypeScript (Node.js ESM), PHP 7.4+ (WordPress snippet), cheerio (existing), existing `tailwind-resolver.ts`

---

## File Structure

```
src/core/
  types.ts                        — Modify: add new type exports
  orchestrator.ts                 — Modify: project subfolder paths, call new modules
  theme-settings-extractor.ts     — CREATE: tailwind.config → GP settings prompt + JSON
  global-styles-generator.ts      — CREATE: compiled CSS → global-styles.json
  style-parser.ts                 — No change (API used by generator)
src/cli/
  index.ts                        — Modify: derive project name from path
snippets/
  gb-style-transfer.php           — CREATE: WPCodeBox admin page snippet
output/
  <existing flattened files>     — Will move to project subfolders after Task 5
fixtures/
  style-transfer-flat.json        — CREATE: fixture for testing workflow end-to-end
```

---

### Task 1: Add Type Definitions

**Files:**
- Modify: `src/core/types.ts` (append to end)

- [ ] **Step 1: Add Layer 1 and Layer 2 types**

At the end of `src/core/types.ts`, append:

```ts
// ── Style Transfer Pipeline ──────────────────────────────────

/** Single color entry for generate_settings global_colors */
export interface GpColorEntry {
  name: string;
  slug: string;
  color: string;
}

/** Single typography entry for generate_settings typography array */
export interface GpTypographyEntry {
  selector: string;
  customSelector: string;
  fontFamily: string;
  fontWeight: string;
  textTransform: string;
  textDecoration: string;
  fontStyle: string;
  fontSize: string;
  fontSizeTablet: string;
  fontSizeMobile: string;
  lineHeight: string;
  lineHeightTablet: string;
  lineHeightMobile: string;
  letterSpacing: string;
  letterSpacingTablet: string;
  letterSpacingMobile: string;
  marginBottom: string;
  marginBottomTablet: string;
  marginBottomMobile: string;
  marginBottomUnit: string;
  module: string;
  group: string;
}

/** Complete generate_settings shape for import */
export interface ThemeSettingsOutput {
  container_width?: number;
  global_colors?: GpColorEntry[];
  typography?: GpTypographyEntry[];
  background_color?: string;
  link_color?: string;
  link_color_hover?: string;
}

/** Wrapper matching GP export format */
export interface ThemeSettingsExport {
  options: {
    generate_settings: ThemeSettingsOutput;
  };
}

/** Single global style entry for gblocks_styles import */
export interface GlobalStyleEntry {
  selector: string;
  css: string;
  data: Record<string, unknown>;
}

/** Layer 2 output file payload */
export type GlobalStylesPayload = GlobalStyleEntry[];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add style transfer pipeline type definitions"
```

---

### Task 2: Theme Settings Extractor (Layer 1 — Prompt Generation)

**Files:**
- Create: `src/core/theme-settings-extractor.ts`
- Create: `fixtures/style-transfer-flat.json` (fixture with tailwind.config)

- [ ] **Step 1: Write the fixture with a tailwind.config as input**

Create `fixtures/style-transfer-flat.json`:

```json
{
  "name": "style-transfer-flat",
  "description": "Flat section from a Tailwind page. Used to test theme settings + global styles generation end-to-end.",
  "input": {
    "nodeType": "element",
    "tagName": "div",
    "attributes": { "class": "bg-primary text-white p-4 rounded-lg" },
    "children": [
      {
        "nodeType": "text",
        "tagName": "h1",
        "text": "Hello World",
        "attributes": { "class": "font-display text-2xl" }
      }
    ]
  },
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "warningCodes": []
  },
  "_meta": {
    "tailwindConfig": {
      "theme": {
        "extend": {
          "colors": {
            "primary": "#17A57A",
            "white": "#FFFFFF"
          },
          "fontFamily": {
            "display": ["Figtree", "sans-serif"]
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create the extractor module**

Create `src/core/theme-settings-extractor.ts`:

```ts
// ── Theme Settings Extractor ──────────────────────────────
//
// Generates a structured prompt for an LLM to map a tailwind.config
// into GeneratePress settings JSON. Also provides a validation +
// save function for the LLM's output.

import type { ThemeSettingsOutput, ThemeSettingsExport, GpColorEntry } from "./types.js";

export interface TailwindConfigTheme {
  extend?: {
    colors?: Record<string, string | Record<string, string>>;
    fontFamily?: Record<string, string[]>;
    screens?: Record<string, string>;
    maxWidth?: Record<string, string>;
  };
}

export interface TailwindConfig {
  theme?: TailwindConfigTheme;
}

export interface PromptPayload {
  prompt: string;
  config: TailwindConfig;
}

const MAPPING_PROMPT = `You are a GeneratePress theme settings converter. Given a tailwind.config object, produce a JSON object in this exact format:

{
  "options": {
    "generate_settings": {
      "container_width": <number>,
      "global_colors": [
        { "name": "<human-readable>", "slug": "<kebab-case>", "color": "<hex>" }
      ],
      "typography": [
        {
          "selector": "body" | "all-headings" | "primary-menu-items",
          "customSelector": "",
          "fontFamily": "<font stack or var(--gp-font--name)>",
          "fontWeight": "<number or empty>",
          "textTransform": "",
          "textDecoration": "",
          "fontStyle": "",
          "fontSize": "<number+unit>",
          "fontSizeTablet": "",
          "fontSizeMobile": "",
          "lineHeight": "",
          "lineHeightTablet": "",
          "lineHeightMobile": "",
          "letterSpacing": "",
          "letterSpacingTablet": "",
          "letterSpacingMobile": "",
          "marginBottom": "",
          "marginBottomTablet": "",
          "marginBottomMobile": "",
          "marginBottomUnit": "",
          "module": "core",
          "group": "base" | "content" | "primaryNavigation"
        }
      ],
      "background_color": "var(--<color-slug>)" | null,
      "link_color": "var(--<color-slug>)" | null,
      "link_color_hover": "<hex>" | null
    }
  }
}

Rules:
- Map tailwind.config.theme.extend.colors.* to global_colors entries. Omit nested color objects (e.g., { "50": "#...", "100": "#..." }) — only map flat color keys.
- Map tailwind.config.theme.extend.fontFamily.display to typography[selector=all-headings].fontFamily.
- Map tailwind.config.theme.extend.fontFamily.sans or the first sans-serif stack to typography[selector=body].fontFamily.
- Map tailwind.config.theme.extend.fontFamily.mono — if body is already set, skip it. If nothing else, set it as body.
- Set container_width to the largest value from theme.extend.maxWidth or theme.screens, or 1200 if neither exists.
- Color names: use the Tailwind key as the slug (kebab-case). Derive a human-readable name by capitalizing words.
- Omit any top-level keys (background_color, link_color, link_color_hover) if you can't determine a sensible default from the config. Do NOT guess.
- All string fields that have no value must use "" (empty string), NOT null.
- Output ONLY valid JSON, no markdown fences, no explanation text.`;

/**
 * Generate an LLM prompt from a tailwind.config object.
 * Returns the prompt + the original config for the LLM to reference.
 */
export function generateThemeSettingsPrompt(config: TailwindConfig): PromptPayload {
  return {
    prompt: MAPPING_PROMPT,
    config,
  };
}

/**
 * Validate a raw string claimed to be GP settings JSON from the LLM.
 * Returns structured output or a list of validation errors.
 */
export function validateThemeSettingsOutput(raw: string): { valid: true; output: ThemeSettingsExport } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["Invalid JSON: could not parse the LLM output"] };
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, errors: ["Root must be a JSON object with 'options.generate_settings'"] };
  }

  const options = obj.options as Record<string, unknown> | undefined;
  if (!options || typeof options !== "object") {
    return { valid: false, errors: ["Missing 'options' key at root"] };
  }

  const settings = options.generate_settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== "object") {
    return { valid: false, errors: ["Missing 'options.generate_settings' key"] };
  }

  // Validate container_width
  if (settings.container_width !== undefined && (typeof settings.container_width !== "number" || settings.container_width <= 0)) {
    errors.push("container_width must be a positive number");
  }

  // Validate global_colors
  if (settings.global_colors !== undefined) {
    if (!Array.isArray(settings.global_colors)) {
      errors.push("global_colors must be an array");
    } else {
      const colors = settings.global_colors as unknown[];
      colors.forEach((c, i) => {
        const color = c as Record<string, unknown>;
        if (!color || typeof color !== "object") {
          errors.push(`global_colors[${i}]: must be an object`);
          return;
        }
        if (typeof color.name !== "string" || !color.name) errors.push(`global_colors[${i}]: missing 'name'`);
        if (typeof color.slug !== "string" || !color.slug) errors.push(`global_colors[${i}]: missing 'slug'`);
        if (typeof color.color !== "string" || !color.color.startsWith("#")) errors.push(`global_colors[${i}]: 'color' must be a hex string`);
      });
    }
  }

  // Validate typography
  if (settings.typography !== undefined) {
    if (!Array.isArray(settings.typography)) {
      errors.push("typography must be an array");
    } else {
      const validSelectors = ["body", "all-headings", "primary-menu-items"];
      const typos = settings.typography as unknown[];
      typos.forEach((t, i) => {
        const typo = t as Record<string, unknown>;
        if (!typo || typeof typo !== "object") {
          errors.push(`typography[${i}]: must be an object`);
          return;
        }
        if (!validSelectors.includes(typo.selector as string)) errors.push(`typography[${i}]: invalid selector "${typo.selector}"`);
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, output: parsed as ThemeSettingsExport };
}

/**
 * Convert CSS variable references to GP variable syntax.
 * e.g. var(--color-primary) stays as-is (GP uses the same syntax).
 */
export function normalizeCssVar(value: string): string {
  return value.trim();
}

/**
 * Flatten nested Tailwind color objects into flat entries.
 * e.g. { primary: { 50: "#...", 100: "#..." } } → skipped (only flat keys mapped).
 * Returns only the flat color keys.
 */
export function extractFlatColors(colors: Record<string, string | Record<string, string>> | undefined): GpColorEntry[] {
  if (!colors) return [];
  const entries: GpColorEntry[] = [];
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string" && value.startsWith("#")) {
      entries.push({
        name: key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        slug: key,
        color: value,
      });
    }
  }
  return entries;
}
```

- [ ] **Step 3: Verify TypeScript compiles without errors**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/theme-settings-extractor.ts fixtures/style-transfer-flat.json
git commit -m "feat: add theme settings extractor — LLM prompt generation + validation"
```

---

### Task 3: Global Styles Generator (Layer 2 — CSS Parser)

**Files:**
- Create: `src/core/global-styles-generator.ts`

- [ ] **Step 1: Create the generator module**

Create `src/core/global-styles-generator.ts`:

```ts
// ── Global Styles Generator ──────────────────────────────
//
// Parses compiled Tailwind CSS into a structured JSON payload
// suitable for import into GenerateBlocks Pro Global Styles
// (gblocks_styles CPT via the admin page snippet).

import type { GlobalStyleEntry } from "./types.js";
import { STYLES_PROPERTIES, CUSTOM_CAMEL_MAP } from "./style-parser.js";

// ── CSS Rule ──────────────────────────────────────────────

interface CssRule {
  selector: string;
  declarations: Record<string, string>;
  mediaQueries: Record<string, Record<string, string>>;
}

// ── Scanner ───────────────────────────────────────────────

/**
 * Scan compiled Tailwind CSS and extract rules as GlobalStyleEntry[].
 * Handles:
 *   - Simple rules: `.bgc-dark{background-color:var(--color-secondary)}`
 *   - Multi-declaration rules
 *   - @media wrapped rules: `@media (max-width:767px){.foo{margin:0}}`
 *   - Combined selectors: `.a,.b{color:red}` (each selector gets its own entry)
 */
export function generateGlobalStyles(css: string): GlobalStyleEntry[] {
  const entries: GlobalStyleEntry[] = [];
  const rules = parseCssRules(css);

  for (const rule of rules) {
    // Split combined selectors
    const selectors = rule.selector.split(",").map(s => s.trim());

    for (const sel of selectors) {
      if (!sel.startsWith(".")) continue; // skip element selectors, keyframes, etc.

      const entry = buildEntry(sel, rule);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

// ── CSS Parser ────────────────────────────────────────────

function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;

  while (i < css.length) {
    skipWhitespace();

    // Detect @media blocks
    if (peek(6) === "@media") {
      const mediaRule = parseMediaBlock();
      if (mediaRule) {
        rules.push(mediaRule);
      }
      continue;
    }

    // Detect regular rules
    if (peek() === "." || peek() === "#" || isIdentStart(peek())) {
      const rule = parseRule();
      if (rule) {
        rules.push(rule);
      }
      continue;
    }

    i++; // skip unknown character
  }

  return rules;

  function skipWhitespace() {
    while (i < css.length && (css[i] === " " || css[i] === "\n" || css[i] === "\r" || css[i] === "\t")) {
      i++;
    }
  }

  function peek(n = 1): string {
    return css.substring(i, i + n);
  }

  function isIdentStart(ch: string): boolean {
    return /[a-zA-Z_*-]/.test(ch);
  }

  function isIdent(ch: string): boolean {
    return /[a-zA-Z0-9_*-]/.test(ch);
  }

  function readSelector(): string {
    let sel = "";
    let depth = 0;
    while (i < css.length) {
      if (css[i] === "{" && depth === 0) break;
      if (css[i] === "(") depth++;
      if (css[i] === ")") depth--;
      sel += css[i];
      i++;
    }
    return sel.trim();
  }

  function readBlock(): string {
    let block = "";
    let depth = 0;
    while (i < css.length) {
      block += css[i];
      if (css[i] === "{") depth++;
      if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    return block;
  }

  function parseDeclarations(block: string): Record<string, string> {
    const decls: Record<string, string> = {};
    // Strip the outer braces
    let inner = block.trim();
    if (inner.startsWith("{")) inner = inner.slice(1);
    if (inner.endsWith("}")) inner = inner.slice(0, -1);

    const parts = inner.split(";");
    for (const part of parts) {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      const prop = part.substring(0, colonIdx).trim();
      const val = part.substring(colonIdx + 1).trim();
      if (prop && val) {
        decls[prop] = val;
      }
    }
    return decls;
  }

  function parseRule(): CssRule | null {
    const selector = readSelector();
    if (!selector) return null;

    if (i >= css.length || css[i] !== "{") return null;

    const block = readBlock();
    const declarations = parseDeclarations(block);

    if (Object.keys(declarations).length === 0) return null;

    return { selector, declarations, mediaQueries: {} };
  }

  function parseMediaBlock(): CssRule | null {
    // Read the @media query
    let query = "";
    while (i < css.length && css[i] !== "{") {
      query += css[i];
      i++;
    }
    query = query.trim();
    if (i >= css.length) return null;

    // Read the media block body
    const body = readBlock(); // includes outer braces
    const inner = body.trim().slice(1, -1).trim(); // strip outer braces

    // Parse rules inside the media block
    let j = 0;
    const mediaDecls: Record<string, Record<string, string>> = {};
    const inlineDecls: Record<string, string> = {};

    while (j < inner.length) {
      // skip whitespace
      while (j < inner.length && (inner[j] === " " || inner[j] === "\n" || inner[j] === "\r" || inner[j] === "\t")) j++;

      if (j >= inner.length) break;

      // Read selector inside media block
      let sel = "";
      while (j < inner.length && inner[j] !== "{") {
        sel += inner[j];
        j++;
      }
      sel = sel.trim();
      if (j >= inner.length) break;

      // Read declarations block inside media block
      j++; // skip {
      let depth = 1;
      let declBlock = "";
      while (j < inner.length && depth > 0) {
        if (inner[j] === "{") depth++;
        if (inner[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        declBlock += inner[j];
        j++;
      }

      const parsed = parseDeclarations("{" + declBlock + "}");
      if (Object.keys(parsed).length > 0) {
        mediaDecls[query] = { ...(mediaDecls[query] || {}), ...parsed };
      }
    }

    return { selector: query, declarations: inlineDecls, mediaQueries: mediaDecls };
  }
}

// ── Entry Builder ─────────────────────────────────────────

function toCamelCase(prop: string): string {
  return CUSTOM_CAMEL_MAP[prop] || prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function buildEntry(selector: string, rule: CssRule): GlobalStyleEntry | null {
  const data: Record<string, unknown> = {};
  let css = `${selector}{`;
  const cssParts: string[] = [];

  // Map declarations
  for (const [prop, value] of Object.entries(rule.declarations)) {
    cssParts.push(`${prop}:${value}`);

    if (STYLES_PROPERTIES.has(prop)) {
      data[toCamelCase(prop)] = value;
    }
  }

  // Map media queries
  for (const [query, decls] of Object.entries(rule.mediaQueries)) {
    const mqParts: string[] = [];
    for (const [prop, value] of Object.entries(decls)) {
      mqParts.push(`${prop}:${value}`);
    }
    cssParts.push(`${query}{${mqParts.join(";")}}`);
  }

  if (cssParts.length === 0) return null;

  css = `${selector}{${cssParts.join(";")}}`;

  return { selector, css, data };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No errors (CUSTOM_CAMEL_MAP is exported from style-parser.ts — verify with `grep "export.*CUSTOM_CAMEL_MAP"`).

- [ ] **Step 3: Commit**

```bash
git add src/core/global-styles-generator.ts
git commit -m "feat: add global styles generator — CSS parser → gblocks_styles JSON"
```

---

### Task 4: Update style-parser.ts Exports

**Files:**
- Modify: `src/core/style-parser.ts`

- [ ] **Step 1: Export STYLES_PROPERTIES and CUSTOM_CAMEL_MAP**

The generator uses these, but they're currently not exported. Verify they ARE already exported. Check the file:

Run:
```bash
grep "^export.*STYLES_PROPERTIES\|^export.*CUSTOM_CAMEL_MAP" src/core/style-parser.ts
```

If they start with `const` (not `export const`), change them to `export const`. Also add STYLES_PROPERTIES to the exports (it's likely already `const STYLES_PROPERTIES = new Set(...)` — add `export`).

If already exported, skip to Step 2.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/style-parser.ts
git commit -m "fix: export STYLES_PROPERTIES and CUSTOM_CAMEL_MAP for global-styles-generator"
```

---

### Task 5: Orchestrator Integration + Project Subfolders

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Update the `convert` function to accept project path and call new modules**

Replace the `ConversionInput` interface and the `convert` function's output logic.

First, update the `ConversionInput` interface (around line 20):

```ts
export interface ConversionInput {
  rawHtml: string;
  pageName: string;
  projectDir?: string;   // e.g. "mino" or "mino/services"
  resolveCss?: boolean;
}
```

Replace the output file writing section (from `mkdirSync(OUTPUT_DIR, ...)` to the end of `convert`) with:

```ts
  // Write output files — use project subfolder if specified
  const outDir = input.projectDir
    ? resolve(OUTPUT_DIR, input.projectDir)
    : OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });

  // Block markup
  writeFileSync(
    resolve(outDir, `${input.pageName}.html`),
    html,
    "utf-8",
  );

  // Report
  writeFileSync(
    resolve(outDir, `${input.pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  // Global styles manifest (existing format — classNameToProperties)
  const globalStylesManifest = collector.toManifest();
  if (globalStylesManifest.classes.length > 0) {
    writeFileSync(
      resolve(outDir, `${input.pageName}-global-styles.json`),
      JSON.stringify(globalStylesManifest, null, 2) + "\n",
      "utf-8",
    );
  }

  // Custom CSS
  if (prepResult.customCss.length > 0) {
    writeFileSync(
      resolve(outDir, `${input.pageName}-custom.css`),
      prepResult.customCss + "\n",
      "utf-8",
    );
  }

  // Tailwind CSS (if requested and config found)
  let tailwindCss = "";
  if (input.resolveCss && prepResult.tailwindConfig) {
    const twResult = compileTailwindCss(
      prepResult.tailwindConfig,
      input.rawHtml,
      process.cwd(),
    );
    if (twResult.css) {
      tailwindCss = twResult.css;
      // Write to project root (shared across pages in same project)
      writeFileSync(
        resolve(outDir, "tailwind.css"),
        tailwindCss,
        "utf-8",
      );
    } else if (twResult.error) {
      console.error(`Tailwind CSS compilation error: ${twResult.error}`);
    }
  }

  // ── Layer 1: Theme Settings Prompt ───────────────────
  if (prepResult.tailwindConfig) {
    // Parse the config string back to an object
    let configObj: Record<string, unknown> | null = null;
    try {
      // tailwindConfig is the extracted config JS string — wrap in eval-safe form
      // The preprocessor extracts the raw config text. Parse it.
      const configStr = prepResult.tailwindConfig
        .replace(/tailwind\.config\s*=\s*/, "")
        .trim();
      // Remove trailing comma before closing brace for JSON compatibility
      const jsonCompat = configStr.replace(/,(\s*[}\]])/g, "$1");
      configObj = JSON.parse(jsonCompat);
    } catch {
      console.warn("Could not parse tailwind.config for theme settings extraction");
    }

    if (configObj) {
      const { generateThemeSettingsPrompt, validateThemeSettingsOutput } =
        await import("./theme-settings-extractor.js");

      const promptPayload = generateThemeSettingsPrompt(configObj as any);

      // Write the prompt + config so the user can feed it to an LLM
      writeFileSync(
        resolve(outDir, "theme-settings-prompt.json"),
        JSON.stringify(promptPayload, null, 2) + "\n",
        "utf-8",
      );

      // Also write an empty template for the user to fill in
      const template: Record<string, unknown> = {
        _instructions: "Feed the contents of theme-settings-prompt.json to an LLM. Paste the LLM's JSON output below. Then rename this file to theme-settings.json.",
        options: {
          generate_settings: {}
        }
      };
      writeFileSync(
        resolve(outDir, "theme-settings.template.json"),
        JSON.stringify(template, null, 2) + "\n",
        "utf-8",
      );
    }
  }

  // ── Layer 2: Global Styles JSON ──────────────────────
  if (tailwindCss) {
    const { generateGlobalStyles } = await import("./global-styles-generator.js");

    const styles = generateGlobalStyles(tailwindCss);
    if (styles.length > 0) {
      writeFileSync(
        resolve(outDir, "global-styles.json"),
        JSON.stringify(styles, null, 2) + "\n",
        "utf-8",
      );
    }
  }
```

Wait — dynamic `await import()` in a sync function won't work. `convert` is currently sync (returns `ConversionOutput`). We need to either make it async or use static imports.

Instead, add static imports at the top of `orchestrator.ts`:

```ts
import { generateThemeSettingsPrompt, extractFlatColors } from "./theme-settings-extractor.js";
import { generateGlobalStyles } from "./global-styles-generator.js";
```

And replace the dynamic import blocks with direct function calls:

```ts
  // ── Layer 1: Theme Settings Prompt ───────────────────
  if (prepResult.tailwindConfig) {
    let configObj: Record<string, unknown> | null = null;
    try {
      const configStr = prepResult.tailwindConfig
        .replace(/tailwind\.config\s*=\s*/, "")
        .trim();
      const jsonCompat = configStr.replace(/,(\s*[}\]])/g, "$1");
      configObj = JSON.parse(jsonCompat);
    } catch {
      console.warn("Could not parse tailwind.config for theme settings extraction");
    }

    if (configObj) {
      const promptPayload = generateThemeSettingsPrompt(configObj as any);
      writeFileSync(
        resolve(outDir, "theme-settings-prompt.json"),
        JSON.stringify(promptPayload, null, 2) + "\n",
        "utf-8",
      );
    }
  }

  // ── Layer 2: Global Styles JSON ──────────────────────
  if (tailwindCss) {
    const styles = generateGlobalStyles(tailwindCss);
    if (styles.length > 0) {
      writeFileSync(
        resolve(outDir, "global-styles.json"),
        JSON.stringify(styles, null, 2) + "\n",
        "utf-8",
      );
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 3: Verify existing fixtures still pass**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts regression 2>&1 && npx tsx src/cli/index.ts fixtures:run fidelity-flat-section 2>&1
```
Expected: All M1 regression pass. Fidelity fixture passes.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add project subfolder output + Layer 1/2 integration to orchestrator"
```

---

### Task 6: CLI Update — Project Path Derivation

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Derive project name from input path**

In the `convert` command handler (around the `if (cmd === "convert")` block), replace the page name derivation:

**Find:**
```ts
    const pageName = basename(fullPath, extname(fullPath));
```

**Replace with:**
```ts
    // Derive project dir and page name from input path
    // inputs/mino/index.html        → projectDir = "mino", pageName = "index"
    // inputs/mino/services/a.html   → projectDir = "mino/services", pageName = "a"
    const relPath = fullPath.replace(process.cwd() + "/", "");
    const inputsPrefix = "inputs/";
    let projectDir: string | undefined;
    let pageName: string;

    if (relPath.startsWith(inputsPrefix)) {
      const afterInputs = relPath.slice(inputsPrefix.length);
      const lastSlash = afterInputs.lastIndexOf("/");
      if (lastSlash >= 0) {
        projectDir = afterInputs.substring(0, lastSlash);
        pageName = basename(afterInputs, extname(afterInputs));
      } else {
        pageName = basename(afterInputs, extname(afterInputs));
      }
    } else {
      pageName = basename(fullPath, extname(fullPath));
    }
```

**Find:**
```ts
    const output = convert({ rawHtml, pageName, resolveCss: args.includes("--resolve-css") });
```

**Replace with:**
```ts
    const output = convert({ rawHtml, pageName, projectDir, resolveCss: args.includes("--resolve-css") });
```

**Find the output log (around the console.log lines):**
```ts
    console.log(`\nConverted: ${pageName}`);
    console.log(`  Output: output/${pageName}.html`);
```

**Replace with:**
```ts
    const outputPrefix = projectDir ? `output/${projectDir}/` : "output/";
    console.log(`\nConverted: ${projectDir ? projectDir + "/" : ""}${pageName}`);
    console.log(`  Output: ${outputPrefix}${pageName}.html`);
```

- [ ] **Step 2: Verify no TypeScript errors**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 3: Test with an actual input path**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts convert inputs/mino/index.html --resolve-css 2>&1
```
Expected: Output files in `output/mino/` directory. Check:
```bash
ls output/mino/
```
Expected: `index.html`, `index.report.json`, `global-styles.json`, `tailwind.css`, `theme-settings-prompt.json`

- [ ] **Step 4: Verify fixture paths still work (flat output)**

Run:
```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts regression 2>&1
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: derive project subfolder from input path in CLI"
```

---

### Task 7: Admin Page PHP Snippet (Layer 2 Delivery)

**Files:**
- Create: `snippets/gb-style-transfer.php`

- [ ] **Step 1: Create the snippet file**

Create `snippets/gb-style-transfer.php`:

```php
<?php
/**
 * GenerateBlocks Style Transfer — Admin Page Snippet
 *
 * Paste into WPCodeBox as a PHP snippet. Run everywhere (admin only).
 * Adds a "Style Transfer" page between Global Styles and Overlay Panels
 * in the GenerateBlocks admin menu.
 *
 * Functions:
 *   - Export: Download all gblocks_styles as JSON
 *   - Import: Paste JSON → Preview → Confirm (wipe + replace)
 *   - Status: Shows current Global Style count
 *
 * @package gb-converter
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// ── Menu Registration ───────────────────────────────────

add_action( 'admin_menu', 'gb_st_register_page', 9 );

function gb_st_register_page() {
    add_submenu_page(
        'generateblocks',
        __( 'Style Transfer', 'generateblocks-pro' ),
        __( 'Style Transfer', 'generateblocks-pro' ),
        'manage_options',
        'generateblocks-style-transfer',
        'gb_st_render_page',
        4
    );
}

// ── Page Render ─────────────────────────────────────────

function gb_st_render_page() {
    $styles_count = gb_st_get_count();
    $message = '';
    $message_type = 'success';

    // Handle export
    if ( isset( $_GET['action'] ) && 'export' === $_GET['action'] ) {
        gb_st_handle_export();
        return;
    }

    // Handle preview
    if ( isset( $_POST['gb_st_preview'] ) && check_admin_referer( 'gb_st_import' ) ) {
        $json = stripslashes( $_POST['gb_st_json'] ?? '' );

        if ( empty( trim( $json ) ) ) {
            $message = 'Please paste JSON content.';
            $message_type = 'error';
        } else {
            $validation = gb_st_validate( $json );
            if ( ! $validation['valid'] ) {
                $message = implode( '<br>', array_map( 'esc_html', $validation['errors'] ) );
                $message_type = 'error';
            } else {
                // Store in transient for commit step
                set_transient( 'gb_st_pending_import', $json, 15 * MINUTE_IN_SECONDS );
                $preview_count = count( $validation['entries'] );
                $message = sprintf(
                    '%d styles found. 0 errors. This will DELETE all %d existing styles and import %d new ones.',
                    $preview_count,
                    $styles_count,
                    $preview_count
                );
                $message_type = 'preview';
            }
        }
    }

    // Handle commit
    if ( isset( $_POST['gb_st_commit'] ) && check_admin_referer( 'gb_st_import' ) ) {
        $json = get_transient( 'gb_st_pending_import' );
        if ( ! $json ) {
            $message = 'No pending import found. Please paste and preview again.';
            $message_type = 'error';
        } else {
            $result = gb_st_commit( $json );
            delete_transient( 'gb_st_pending_import' );
            if ( $result['success'] ) {
                $message = sprintf( 'Import complete. %d styles imported.', $result['count'] );
                $message_type = 'success';
                $styles_count = $result['count'];
            } else {
                $message = 'Import failed: ' . esc_html( $result['error'] );
                $message_type = 'error';
            }
        }
    }

    $show_preview = ( 'preview' === $message_type );
    $pending_json = $show_preview ? '' : '';
    ?>
    <div class="wrap gblocks-dashboard-wrap">
        <div class="gblocks-dashboard-header">
            <div class="gblocks-dashboard-header-title">
                <h1><?php esc_html_e( 'Style Transfer', 'generateblocks-pro' ); ?></h1>
            </div>
        </div>

        <div class="generateblocks-settings-area" style="max-width:800px;margin-top:20px;">
            <?php if ( $message ) : ?>
                <div class="notice notice-<?php echo $show_preview ? 'warning' : esc_attr( $message_type ); ?> inline">
                    <p><?php echo $message; // Already escaped or from trusted source ?></p>
                </div>
            <?php endif; ?>

            <?php if ( ! $show_preview ) : ?>
                <?php // Status ?>
                <div class="gb-st-status" style="background:#f0f6fc;padding:15px;margin-bottom:20px;border-radius:4px;">
                    <strong>Status:</strong> <?php echo (int) $styles_count; ?> Global Styles currently registered.
                </div>

                <?php // Export ?>
                <div class="gb-st-section" style="background:#fff;border:1px solid #ccd0d4;padding:20px;margin-bottom:20px;border-radius:4px;">
                    <h2 style="margin-top:0;">Export</h2>
                    <p>Download all Global Styles as a JSON file.</p>
                    <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=generateblocks-style-transfer&action=export' ), 'gb_st_export' ) ); ?>" class="button button-primary">
                        Download global-styles.json
                    </a>
                </div>

                <?php // Import ?>
                <div class="gb-st-section" style="background:#fff;border:1px solid #ccd0d4;padding:20px;border-radius:4px;">
                    <h2 style="margin-top:0;">Import</h2>
                    <p>Paste the contents of a <code>global-styles.json</code> file. <strong>All existing styles will be replaced.</strong></p>
                    <form method="post">
                        <?php wp_nonce_field( 'gb_st_import' ); ?>
                        <textarea
                            name="gb_st_json"
                            rows="15"
                            style="width:100%;font-family:monospace;font-size:13px;"
                            placeholder='[{"selector":".my-class","css":".my-class{color:red}","data":{}}]'
                        ><?php echo esc_textarea( $pending_json ); ?></textarea>
                        <p style="margin-top:10px;">
                            <button type="submit" name="gb_st_preview" class="button button-primary">Paste &amp; Preview</button>
                        </p>
                    </form>
                </div>

            <?php else : ?>
                <?php // Commit confirmation ?>
                <div class="gb-st-section" style="background:#fff;border:2px solid #f0b849;padding:20px;border-radius:4px;">
                    <h2 style="margin-top:0;">Confirm Import</h2>
                    <p><?php echo $message; // Already escaped ?></p>
                    <form method="post" style="display:inline;">
                        <?php wp_nonce_field( 'gb_st_import' ); ?>
                        <button type="submit" name="gb_st_commit" class="button button-primary">Confirm Import</button>
                        <a href="<?php echo esc_url( admin_url( 'admin.php?page=generateblocks-style-transfer' ) ); ?>" class="button">Cancel</a>
                    </form>
                </div>
            <?php endif; ?>
        </div>
    </div>
    <?php
}

// ── Export Handler ───────────────────────────────────────

function gb_st_handle_export() {
    check_admin_referer( 'gb_st_export' );

    $entries = [];
    $posts = get_posts( [
        'post_type'      => 'gblocks_styles',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'orderby'        => 'menu_order',
        'order'          => 'ASC',
    ] );

    foreach ( $posts as $post ) {
        $entries[] = [
            'selector' => get_post_meta( $post->ID, 'gb_style_selector', true ) ?: '',
            'css'      => get_post_meta( $post->ID, 'gb_style_css', true ) ?: '',
            'data'     => gb_st_unserialize_data( get_post_meta( $post->ID, 'gb_style_data', true ) ),
        ];
    }

    header( 'Content-Type: application/json' );
    header( 'Content-Disposition: attachment; filename="global-styles.json"' );
    echo json_encode( $entries, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
    exit;
}

// ── Validation ───────────────────────────────────────────

function gb_st_validate( $json ) {
    $errors = [];

    $data = json_decode( $json, true );
    if ( json_last_error() !== JSON_ERROR_NONE ) {
        return [
            'valid'  => false,
            'errors' => [ 'Invalid JSON: ' . json_last_error_msg() ],
        ];
    }

    if ( ! is_array( $data ) ) {
        return [
            'valid'  => false,
            'errors' => [ 'Root must be a JSON array.' ],
        ];
    }

    $selectors_seen = [];
    $valid_entries = [];

    foreach ( $data as $i => $entry ) {
        $n = $i + 1;

        if ( ! isset( $entry['selector'] ) || ! is_string( $entry['selector'] ) ) {
            $errors[] = "Entry #{$n}: missing required field 'selector'";
            continue;
        }
        if ( substr( $entry['selector'], 0, 1 ) !== '.' ) {
            $errors[] = "Entry #{$n}: selector must start with '.'";
            continue;
        }
        if ( ! isset( $entry['css'] ) || ! is_string( $entry['css'] ) || trim( $entry['css'] ) === '' ) {
            $errors[] = "Entry #{$n}: missing or empty required field 'css'";
            continue;
        }
        if ( strlen( $json ) > 500000 ) {
            $errors[] = 'Content too large. Max 500KB.';
            break;
        }

        $sel = $entry['selector'];
        if ( isset( $selectors_seen[ $sel ] ) ) {
            $errors[] = "Entry #{$n} and #{$selectors_seen[$sel]}: duplicate selector '{$sel}'";
            continue;
        }
        $selectors_seen[ $sel ] = $n;

        if ( isset( $entry['data'] ) && ! is_array( $entry['data'] ) ) {
            $errors[] = "Entry #{$n}: 'data' must be an object if present";
            continue;
        }

        $valid_entries[] = $entry;
    }

    if ( ! empty( $errors ) ) {
        return [ 'valid' => false, 'errors' => $errors ];
    }

    return [ 'valid' => true, 'entries' => $valid_entries ];
}

// ── Commit ───────────────────────────────────────────────

function gb_st_commit( $json ) {
    $validation = gb_st_validate( $json );
    if ( ! $validation['valid'] ) {
        return [
            'success' => false,
            'error'   => implode( '; ', $validation['errors'] ),
        ];
    }

    // Delete existing styles
    $existing = get_posts( [
        'post_type'      => 'gblocks_styles',
        'post_status'    => [ 'publish', 'draft' ],
        'posts_per_page' => -1,
        'fields'         => 'ids',
    ] );

    foreach ( $existing as $post_id ) {
        wp_delete_post( $post_id, true );
    }

    // Insert new styles
    $inserted = 0;
    foreach ( $validation['entries'] as $i => $entry ) {
        $post_id = wp_insert_post( [
            'post_type'   => 'gblocks_styles',
            'post_title'  => sanitize_text_field( $entry['selector'] ),
            'post_status' => 'publish',
            'menu_order'  => $i,
        ] );

        if ( is_wp_error( $post_id ) ) {
            // Roll back — delete any we've inserted
            $inserted_posts = get_posts( [
                'post_type'      => 'gblocks_styles',
                'post_status'    => 'publish',
                'posts_per_page' => $inserted,
                'fields'         => 'ids',
                'orderby'        => 'ID',
                'order'          => 'DESC',
            ] );
            foreach ( $inserted_posts as $pid ) {
                wp_delete_post( $pid, true );
            }
            return [
                'success' => false,
                'error'   => 'Failed to insert style "' . esc_html( $entry['selector'] ) . '": ' . $post_id->get_error_message(),
            ];
        }

        update_post_meta( $post_id, 'gb_style_selector', sanitize_text_field( $entry['selector'] ) );
        update_post_meta( $post_id, 'gb_style_css', wp_kses_post( $entry['css'] ) );

        if ( ! empty( $entry['data'] ) && is_array( $entry['data'] ) ) {
            update_post_meta( $post_id, 'gb_style_data', $entry['data'] );
        }

        $inserted++;
    }

    // Clear cached CSS
    delete_option( 'generateblocks_style_css' );

    return [ 'success' => true, 'count' => $inserted ];
}

// ── Helpers ──────────────────────────────────────────────

function gb_st_get_count() {
    $counts = wp_count_posts( 'gblocks_styles' );
    return isset( $counts->publish ) ? (int) $counts->publish : 0;
}

function gb_st_unserialize_data( $data ) {
    if ( empty( $data ) ) {
        return [];
    }

    // Try unserializing — if it's a serialized PHP string
    if ( is_string( $data ) ) {
        $unserialized = @unserialize( $data );
        if ( is_array( $unserialized ) ) {
            return $unserialized;
        }
    }

    // If it's already an array (GB Pro stores as serialized but WP might auto-unserialize)
    if ( is_array( $data ) ) {
        return $data;
    }

    return [];
}
```

- [ ] **Step 2: Verify PHP syntax**

Run:
```bash
php -l snippets/gb-style-transfer.php
```
Expected: "No syntax errors detected"

- [ ] **Step 3: Commit**

```bash
git add snippets/gb-style-transfer.php
git commit -m "feat: add GB Style Transfer admin page PHP snippet"
```

---

### Task 8: End-to-End Verification

**Files:**
- None created/modified (verification only)

- [ ] **Step 1: Run full conversion on Mino page**

```bash
cd /home/ivanoung/projects/gb-converter && rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/index.html --resolve-css 2>&1
```

Expected output:
```
Converted: mino/index
  Output: output/mino/index.html
  Report: output/mino/index.report.json
  Blocks: 311
  Status: pass
```

- [ ] **Step 2: Verify all output files exist**

```bash
ls -la output/mino/
```

Expected files: `index.html`, `index.report.json`, `global-styles.json`, `tailwind.css`, `theme-settings-prompt.json`

- [ ] **Step 3: Verify global-styles.json is valid and has entries**

```bash
cd /home/ivanoung/projects/gb-converter && node -e "const d = require('./output/mino/global-styles.json'); console.log('Entries:', d.length); console.log('First:', JSON.stringify(d[0]).substring(0,100))"
```

Expected: `Entries: <number>` (should be > 0). First entry has `selector`, `css`, `data` fields.

- [ ] **Step 4: Verify all existing fixtures still pass**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts regression 2>&1 && npx tsx src/cli/index.ts fixtures:run fidelity-flat-section 2>&1 && npx tsx src/cli/index.ts fixtures:run fidelity-inline-formatting 2>&1
```

Expected: All pass (regression 5/5, 3 fidelity fixtures pass).

- [ ] **Step 5: Commit verification results**

```bash
git add -A && git commit -m "verify: end-to-end style transfer pipeline — all outputs generated, all fixtures pass"
```

---

## Self-Review

1. **Spec coverage:**
   - Layer 1 theme settings: Task 2 (extractor) + Task 5 (orchestrator integration) ✓
   - Layer 2 global styles JSON: Task 3 (generator) + Task 5 (integration) + Task 7 (admin page) ✓
   - Layer 3 block markup: unchanged, verified by existing fixtures ✓
   - Project subfolders: Task 5 (orchestrator) + Task 6 (CLI) ✓
   - Admin page (export/preview/import): Task 7 ✓

2. **Placeholder scan:** No TBD, TODO, or incomplete sections. All code in every step.

3. **Type consistency:** Types defined in Task 1 used throughout Tasks 2-5.
   `GlobalStyleEntry` (Task 1) matches `generateGlobalStyles()` return (Task 3) and
   PHP validation (Task 7). `ThemeSettingsExport` (Task 1) matches extractor (Task 2).
