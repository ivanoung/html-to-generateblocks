# Customizer Design Token Extraction — V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken regex-based `customizer-generator.ts` with Playwright live-DOM extraction of a "Design Evidence Dossier" plus deterministic heuristics that map to GeneratePress Customizer tokens (colors, body/heading fonts, container width). V1 scope — no LLM, no button/nav/spacing tokens.

**Architecture:** Extraction piggybacks on the existing Playwright session in `tailwind-inliner.ts`. After Tailwind CDN compilation stabilizes, a `page.evaluate()` script scrapes the live DOM: computed colors (with multil-format normalization), font families on semantic elements, CSS custom properties, Google Fonts `<link>` tags, container element computed max-width, and `window.tailwind.config` (with `<script>`-tag fallback). A deterministic `token-mapper.ts` applies priority heuristics (CSS custom properties → computed styles → tailwind.config → defaults) to produce `MappedTokens`. A `config/customizer-overrides.json` file provides a manual escape hatch for designs the heuristics can't handle.

**Tech Stack:** TypeScript, Playwright (already in use), Node.js test runner (already in use).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/design-dossier.ts` | **Create** | Types: `DesignDossier`, `ColorCandidate`, `FontCandidate`, `ContainerCandidate`, extraction result |
| `src/core/design-extractor.ts` | **Create** | `buildExtractionScript()` — stringified IIFE for `page.evaluate()`; `colorToHex()` — full color format normalization |
| `src/core/token-mapper.ts` | **Create** | `mapTokensHeuristic()` — deterministic heuristics from dossier to GP tokens |
| `src/core/customizer-generator.ts` | **Modify** | Delete old regex code; new `generateCustomizerSettings(dossier)` + `buildCustomizerJson(tokens)`; applies override file |
| `src/core/tailwind-inliner.ts` | **Modify** | Add `dossier` to `InlinerResult`; call extraction after CSS stability; poll `window.tailwind` before extraction |
| `src/core/orchestrator.ts` | **Modify** | Capture dossier from inliner; pass to `generateCustomizerSettings()` |
| `src/cli/index.ts` | **Modify** | Pass dossier through single-page and multi-page convert flows |
| `config/customizer-overrides.json` | **Create** | Manual override file — deep-merged with generated tokens |
| `tests/token-mapper.test.ts` | **Create** | Unit tests for heuristic mapping |
| `tests/customizer-generator.test.ts` | **Create** | Integration tests for full generation pipeline |
| `tests/design-extractor.test.ts` | **Create** | Tests for color format normalization (`colorToHex`) |

---

## Phase 0: Spike — Validate window.tailwind.config ✅ COMPLETE

**Result (2025-06-17):** `window.tailwind.config` is `{}` — the Tailwind CDN consumes the user config internally but does not expose it via `window.tailwind.config`. `resolveConfig()` also only returns built-in defaults, not user `extend` values.

**Decision:** The `<script>`-tag JS object parser is the **primary** method for extracting tailwind.config values. It runs on the Node.js side (not in the browser). `extractConfigFromHtml(rawHtml)` in `design-extractor.ts` parses the config from `<script>tailwind.config = {...}</script>` blocks and returns `{colors, fontFamily, maxWidth}`.

✅ Verified on mino: 9 colors, 4 font families, container 1600px — all extracted correctly.
✅ Verified on hkvc: shade objects resolved correctly (slate → #272f31 from shade 800).

- [ ] **Step 1: Write throwaway spike script**

Create `/tmp/spike-tailwind-config.ts`:

```typescript
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { resolve } from "path";

async function spike(inputPath: string) {
  const html = readFileSync(resolve(process.cwd(), inputPath), "utf-8");
  const cdnDoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"></script></head><body>${html}</body></html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(cdnDoc, { waitUntil: "networkidle" });

  // Wait for Tailwind CDN to initialize
  await page.waitForFunction(() => typeof (window as any).tailwind !== "undefined", { timeout: 15000 }).catch(() => {});

  const result = await page.evaluate(() => {
    const tw = (window as any).tailwind;
    if (!tw) return { available: false, error: "window.tailwind is undefined" };

    const cfg = tw.config;
    if (!cfg) return { available: true, hasConfig: false, error: "window.tailwind.config is undefined" };

    const theme = cfg.theme || {};
    return {
      available: true,
      hasConfig: true,
      themeKeys: Object.keys(theme),
      extendKeys: Object.keys(theme.extend || {}),
      colorKeys: Object.keys(theme.colors || theme.extend?.colors || {}),
      fontFamilyKeys: Object.keys(theme.fontFamily || theme.extend?.fontFamily || {}),
      maxWidthKeys: Object.keys(theme.maxWidth || theme.extend?.maxWidth || {}),
      sampleColor: theme.colors?.primary || theme.extend?.colors?.primary || "not found",
      sampleColorType: typeof (theme.colors?.primary || theme.extend?.colors?.primary),
    };
  });

  console.log(`\n=== ${inputPath} ===`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

spike("inputs/mino/index.html").then(() => spike("inputs/hkvc/index.html"));
```

- [ ] **Step 2: Run spike**

```bash
npx tsx /tmp/spike-tailwind-config.ts
```

- [ ] **Step 3: Evaluate results**

Expected:
- `window.tailwind` is available after `networkidle` + brief wait
- `tailwind.config.theme.colors` has the same keys as the original config
- `sampleColorType` is `"string"` for flat values, `"object"` for shade objects
- hkvc's shade objects (`slate: { 800: '#272f31' }`) are accessible

If `window.tailwind` is NOT available: proceed to Task 0b (fallback parser) before Task 2.

- [ ] **Step 4: Implement `<script>`-tag fallback parser (only if spike fails)**

If `window.tailwind` is not available on the CDN, we fall back to parsing the config from the `<script>` tag content using a simple balanced-object parser (not regex). Add to `src/core/design-extractor.ts`:

```typescript
/**
 * Parse a JavaScript object literal string into a Record.
 * Handles unquoted keys, single/double-quoted string values, arrays, nested objects.
 * No eval() — pure character-by-character parsing.
 */
export function parseJsObjectLiteral(raw: string): Record<string, unknown> {
  // Find the opening brace and parse balanced brackets
  let i = raw.indexOf("{");
  if (i === -1) return {};

  // Walk characters tracking depth for {}, [], string quotes, and escapes
  function parseValue(start: number): { value: unknown; next: number } {
    // Skip whitespace
    while (start < raw.length && /\s/.test(raw[start])) start++;
    if (start >= raw.length) return { value: undefined, next: start };

    const ch = raw[start];

    // String (single or double quoted)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = start + 1;
      while (j < raw.length) {
        if (raw[j] === "\\") { j += 2; continue; }
        if (raw[j] === quote) return { value: raw.slice(start + 1, j), next: j + 1 };
        j++;
      }
      return { value: raw.slice(start + 1), next: raw.length };
    }

    // Object
    if (ch === "{") {
      const obj: Record<string, unknown> = {};
      let j = start + 1;
      while (j < raw.length) {
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === "}") return { value: obj, next: j + 1 };
        if (raw[j] === ",") { j++; continue; }

        // Parse key (unquoted identifier or quoted string)
        let key: string;
        if (raw[j] === '"' || raw[j] === "'") {
          const r = parseValue(j);
          key = String(r.value);
          j = r.next;
        } else {
          const m = raw.slice(j).match(/^(\w+)/);
          if (!m) break;
          key = m[1];
          j += m[0].length;
        }

        // Skip colon
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === ":") j++;

        // Parse value
        const r = parseValue(j);
        obj[key] = r.value;
        j = r.next;
      }
      return { value: obj, next: j };
    }

    // Array
    if (ch === "[") {
      const arr: unknown[] = [];
      let j = start + 1;
      while (j < raw.length) {
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === "]") return { value: arr, next: j + 1 };
        if (raw[j] === ",") { j++; continue; }
        const r = parseValue(j);
        arr.push(r.value);
        j = r.next;
      }
      return { value: arr, next: j };
    }

    // Number
    const numMatch = raw.slice(start).match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (numMatch) {
      return { value: parseFloat(numMatch[1]), next: start + numMatch[0].length };
    }

    // Unquoted identifier (true, false, null, undefined, or color name)
    const idMatch = raw.slice(start).match(/^(\w+)/);
    if (idMatch) {
      const word = idMatch[1];
      if (word === "true") return { value: true, next: start + 4 };
      if (word === "false") return { value: false, next: start + 5 };
      if (word === "null") return { value: null, next: start + 4 };
      if (word === "undefined") return { value: undefined, next: start + 9 };
      return { value: word, next: start + word.length };
    }

    return { value: undefined, next: start + 1 };
  }

  const result = parseValue(i);
  return (result.value as Record<string, unknown>) || {};
}

/**
 * Extract tailwind.config values from raw HTML <script> tags.
 * Used as fallback when window.tailwind is not available via CDN.
 */
export function extractConfigFromHtml(rawHtml: string): {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  maxWidth: Record<string, string>;
} | null {
  // Find tailwind.config = {...} in script tags
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(rawHtml)) !== null) {
    const content = match[1];
    const configIdx = content.indexOf("tailwind.config");
    if (configIdx === -1) continue;

    // Find the config object starting from tailwind.config
    const afterAssign = content.indexOf("=", configIdx);
    if (afterAssign === -1) continue;

    const parsed = parseJsObjectLiteral(content.slice(afterAssign + 1));

    // Navigate: theme → extend → colors/fontFamily/maxWidth
    const theme = (parsed.theme || parsed) as Record<string, unknown>;
    const extend = (theme.extend || theme) as Record<string, unknown>;

    const result: { colors: Record<string, string>; fontFamily: Record<string, string[]>; maxWidth: Record<string, string> } = {
      colors: {},
      fontFamily: {},
      maxWidth: {},
    };

    // Colors
    const colors = (theme.colors || extend.colors || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(colors)) {
      if (typeof v === "string") result.colors[k] = v;
      else if (typeof v === "object" && v !== null) {
        // Shade object — pick DEFAULT or 500
        const shadeObj = v as Record<string, unknown>;
        const shade = shadeObj.DEFAULT || shadeObj["500"];
        if (typeof shade === "string") result.colors[k] = shade;
      }
    }

    // Font families
    const fonts = (theme.fontFamily || extend.fontFamily || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(fonts)) {
      if (Array.isArray(v)) result.fontFamily[k] = v as string[];
    }

    // Max widths
    const mw = (theme.maxWidth || extend.maxWidth || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(mw)) {
      if (typeof v === "string") result.maxWidth[k] = v;
    }

    return result;
  }

  return null;
}
```

---

## Phase 1: Design Dossier Types

### Task 1: Define the DesignDossier types

**Files:**
- Create: `src/core/design-dossier.ts`

```typescript
// ── Design Evidence Dossier ────────────────────────────────
//
// Structured summary of a rendered page's visual design tokens,
// extracted from the live DOM via Playwright after Tailwind CDN
// compilation. Every value here is observed, not inferred.
//
// V1 scope: colors, body/heading fonts, container width.
// Known gaps (logged as warnings):
//   - :hover/:focus/:active colors are invisible to getComputedStyle
//   - dark: variant colors only visible if viewport matches
//   - Responsive font sizes captured at one viewport width only
//   - Button styles, nav typography, spacing/border-radius not captured

export interface ColorCandidate {
  hex: string;
  usageCount: number;
  roles: string[];
  examples: string[];
  cssVar?: string;
  configName?: string;
}

export interface FontCandidate {
  fontFamily: string;
  roles: string[];
  configName?: string;
  sampleSize?: string;
  sampleWeight?: string;
}

export interface ContainerCandidate {
  px: number;
  source: "config" | "computed" | "viewport";
  selector?: string;
}

export interface CssCustomProperty {
  name: string;
  value: string;
  context: string;
}

export interface GoogleFontEntry {
  family: string;
  variants: string[];
  href: string;
}

export interface TypographySample {
  selector: string;
  tagName: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  fontFamily: string;
  textTransform: string;
  letterSpacing: string;
}

export interface DesignDossier {
  colors: ColorCandidate[];
  fonts: FontCandidate[];
  containers: ContainerCandidate[];
  customProperties: CssCustomProperty[];
  googleFonts: GoogleFontEntry[];
  typographySamples: TypographySample[];
  tailwindConfig: {
    colors: Record<string, string>;
    fontFamily: Record<string, string[]>;
    maxWidth: Record<string, string>;
  } | null;
  /** true if extraction ran without fatal errors */
  extracted: boolean;
  /** transparency notes: what was missed, why a value was chosen */
  warnings: string[];
}

export function emptyDossier(): DesignDossier {
  return {
    colors: [],
    fonts: [],
    containers: [],
    customProperties: [],
    googleFonts: [],
    typographySamples: [],
    tailwindConfig: null,
    extracted: false,
    warnings: [],
  };
}
```

---

## Phase 2: Playwright Extraction

### Task 2: Write the extraction script + JS config parser

**Files:**
- Create: `src/core/design-extractor.ts`

The extractor has three parts:
1. `colorToHex(cssColor: string): string | null` — a pure function (testable) that normalizes any CSS color format to `#rrggbb`
2. `parseJsObjectLiteral(raw: string)` — parses a JS object literal string (unquoted keys, single/double-quoted strings, arrays, nested objects) into a Record. Used to extract tailwind.config from `<script>` tags.
3. `extractConfigFromHtml(rawHtml: string)` — finds `tailwind.config = {...}` in `<script>` blocks, parses it, returns `{colors, fontFamily, maxWidth}`. Runs on Node.js side, NOT in the browser.
4. `buildExtractionScript(): string` — stringified IIFE for `page.evaluate()`. Does NOT read tailwind.config — only reads computed styles, CSS vars, fonts, containers from live DOM.

```typescript
import type { DesignDossier } from "./design-dossier.js";

// ── Color Format Normalization ─────────────────────────────
//
// Handles: rgb(), rgba(), hsl(), hsla(), oklch(), #hex,
// named colors, currentColor, transparent, color-mix()

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff",
  green: "#008000", transparent: "transparent",
  currentcolor: "currentColor",
};

export function colorToHex(cssColor: string): string | null {
  if (!cssColor) return null;
  const c = cssColor.trim().toLowerCase();

  // transparent / currentColor — pass through with warning handled by caller
  if (c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
  if (c === "currentcolor") return null;

  // Named colors
  if (NAMED_COLORS[c]) return NAMED_COLORS[c] === "transparent" || NAMED_COLORS[c] === "currentColor" ? null : NAMED_COLORS[c];

  // #hex
  const hexMatch = c.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    else if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; // #rgba → ignore alpha
    else if (h.length === 8) h = h.slice(0, 6); // #rrggbbaa → drop alpha
    return `#${h.slice(0, 6).toLowerCase()}`;
  }

  // rgb() / rgba() — both comma and space-separated modern syntax
  const rgbMatch = c.match(/rgba?\s*\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgbMatch) {
    return "#" + [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((x) => Math.min(255, Math.max(0, Math.round(parseFloat(x)))).toString(16).padStart(2, "0"))
      .join("");
  }

  // hsl() / hsla()
  const hslMatch = c.match(/hsla?\s*\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    return hslToHex(h, s, l);
  }

  // oklch() — approximate conversion to sRGB
  // oklch(L C H) or oklch(L C H / A)
  const oklchMatch = c.match(/oklch\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (oklchMatch) {
    const l = parseFloat(oklchMatch[1]);
    const chroma = parseFloat(oklchMatch[2]);
    const hue = parseFloat(oklchMatch[3]);
    try {
      return oklchToHex(l, chroma, hue);
    } catch {
      return null; // conversion failed — skip this color
    }
  }

  // color-mix() — extract the first color argument only (lossy fallback)
  const mixMatch = c.match(/color-mix\s*\([^,]*,\s*([^,)]+)/);
  if (mixMatch) return colorToHex(mixMatch[1].trim());

  return null;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function oklchToHex(l: number, c: number, h: number): string {
  // oklch → oklab → linear sRGB → sRGB
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  // oklab → linear sRGB
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  // Linear → sRGB gamma
  const toSrgb = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };

  return "#" + [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

// ── Extraction Script ──────────────────────────────────────

/**
 * Build a stringified IIFE that extracts design evidence from the
 * live DOM. Designed to be passed to page.evaluate().
 *
 * Must run AFTER Tailwind CDN has compiled all styles.
 * The IIFE is self-contained (no external function references).
 */
export function buildExtractionScript(): string {
  return `(function() {
    var result = {
      colors: [],
      fonts: [],
      containers: [],
      customProperties: [],
      googleFonts: [],
      typographySamples: [],
      tailwindConfig: null,
      extracted: true,
      warnings: []
    };

    try {

    // ── 0. Pseudo-class warning ────────────────────────────
    result.warnings.push(
      "Pseudo-class colors (:hover, :focus, :active) are not captured by getComputedStyle"
    );

    // ── 1. Extract all computed colors ─────────────────────
    // Iterate body + up to 500 descendants, collect unique colors
    var colorMap = new Map();
    var allElements = document.querySelectorAll('body, body *');
    var maxElements = 500;

    for (var i = 0; i < Math.min(allElements.length, maxElements); i++) {
      var el = allElements[i];
      var cs = window.getComputedStyle(el);

      [cs.backgroundColor, cs.color].forEach(function(rawColor, idx) {
        if (!rawColor) return;
        var hex = colorToHex(rawColor);
        if (!hex) return;

        var existing = colorMap.get(hex);
        if (existing) {
          existing.count++;
          if (existing.roles.length < 5) {
            var role = idx === 0 ? classifyBgRole(el) : classifyTextRole(el);
            if (existing.roles.indexOf(role) === -1) existing.roles.push(role);
          }
          if (existing.examples.length < 5) {
            existing.examples.push(getElementPath(el));
          }
        } else {
          colorMap.set(hex, {
            hex: hex,
            count: 1,
            roles: [idx === 0 ? classifyBgRole(el) : classifyTextRole(el)],
            examples: [getElementPath(el)]
          });
        }
      });
    }

    result.colors = Array.from(colorMap.values()).sort(function(a, b) {
      return b.count - a.count;
    });

    // ── 2. Font families on semantic elements ──────────────
    var fontMap = new Map();
    var tags = ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button'];
    tags.forEach(function(tag) {
      var els = document.querySelectorAll(tag);
      for (var i = 0; i < els.length; i++) {
        var cs = window.getComputedStyle(els[i]);
        var ff = cs.fontFamily;
        if (!ff) continue;
        var norm = ff.split(',')[0].trim().replace(/['"]/g, '');
        var role = tag;
        var existing = fontMap.get(norm);
        if (existing) {
          if (existing.roles.indexOf(role) === -1) existing.roles.push(role);
        } else {
          fontMap.set(norm, {
            fontFamily: ff,
            roles: [role],
            sampleSize: cs.fontSize,
            sampleWeight: cs.fontWeight
          });
        }
      }
    });
    result.fonts = Array.from(fontMap.values());

    // ── 3. CSS custom properties ───────────────────────────
    var contexts = [document.documentElement, document.body];
    var propSet = new Set();
    contexts.forEach(function(ctx) {
      if (!ctx) return;
      var cs = window.getComputedStyle(ctx);
      for (var j = 0; j < cs.length && propSet.size < 100; j++) {
        var propName = cs[j];
        if (propName.indexOf('--') === 0 && !propSet.has(propName)) {
          propSet.add(propName);
          result.customProperties.push({
            name: propName,
            value: cs.getPropertyValue(propName).trim(),
            context: ctx === document.documentElement ? ':root' : 'body'
          });
        }
      }
    });

    // ── 4. Google Fonts ────────────────────────────────────
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
      var href = link.getAttribute('href') || '';
      if (href.indexOf('fonts.googleapis.com') !== -1) {
        result.googleFonts.push({
          family: extractGoogleFontFamily(href),
          variants: extractGoogleFontVariants(href),
          href: href
        });
      }
    });

    // ── 5. Container candidates (centered, reasonable width) ──
    var containerEls = document.querySelectorAll(
      '[class*="container"], [class*="max-w-"], .mx-auto, main, .wrapper, #content'
    );
    var seenWidths = new Set();
    var candidates = [];
    for (var ci = 0; ci < containerEls.length && candidates.length < 10; ci++) {
      var el = containerEls[ci];
      var cs = window.getComputedStyle(el);
      var maxW = parseInt(cs.maxWidth, 10);

      // Must be a centered block-level element with reasonable width
      if (!maxW || maxW < 400 || maxW > 2500) continue;
      // Check horizontal centering: margin-left and margin-right must be auto or equal
      var ml = cs.marginLeft;
      var mr = cs.marginRight;
      if (ml !== mr && ml !== 'auto' && mr !== 'auto') continue;

      if (!seenWidths.has(maxW)) {
        seenWidths.add(maxW);
        candidates.push({
          px: maxW,
          source: 'computed',
          selector: getShortSelector(el)
        });
      }
    }
    result.containers = candidates;

    // ── 6. Typography samples ──────────────────────────────
    ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button'].forEach(function(tag) {
      var el = document.querySelector(tag);
      if (!el) return;
      var cs = window.getComputedStyle(el);
      result.typographySamples.push({
        selector: tag, tagName: tag,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, fontFamily: cs.fontFamily,
        textTransform: cs.textTransform, letterSpacing: cs.letterSpacing
      });
    });

    // ── 7. tailwind.config from CDN (window.tailwind) ──────
    if (typeof window.tailwind !== 'undefined' && window.tailwind.config) {
      try {
        var cfg = window.tailwind.config;
        var theme = cfg.theme || {};
        result.tailwindConfig = { colors: {}, fontFamily: {}, maxWidth: {} };

        var colors = theme.colors || {};
        Object.keys(colors).forEach(function(k) {
          var v = colors[k];
          if (typeof v === 'string') result.tailwindConfig.colors[k] = v;
          else if (typeof v === 'object' && v !== null) {
            var shade = v.DEFAULT || v['500'];
            if (typeof shade === 'string') result.tailwindConfig.colors[k] = shade;
          }
        });

        var fonts = theme.fontFamily || {};
        Object.keys(fonts).forEach(function(k) {
          if (Array.isArray(fonts[k])) result.tailwindConfig.fontFamily[k] = fonts[k];
        });

        var mw = theme.maxWidth || {};
        Object.keys(mw).forEach(function(k) {
          if (typeof mw[k] === 'string') result.tailwindConfig.maxWidth[k] = mw[k];
        });
      } catch(e) {
        result.warnings.push('Failed to read window.tailwind.config: ' + e.message);
      }
    } else {
      result.warnings.push('window.tailwind not available — tailwind.config values missing from dossier');
    }

    } catch(e) {
      result.warnings.push('Extraction error: ' + e.message);
      result.extracted = false;
    }

    return JSON.stringify(result);

    // ── Color normalization (embedded in IIFE) ─────────────
    function colorToHex(raw) {
      if (!raw) return null;
      var c = raw.trim().toLowerCase();

      // transparent / currentColor → skip
      if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'currentcolor') return null;

      // Named colors (compact set for common cases)
      var named = {black:'#000000',white:'#ffffff'};
      if (named[c]) return named[c];

      // #hex
      var hm = c.match(/^#([0-9a-f]{3,8})$/);
      if (hm) {
        var h = hm[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        else if (h.length === 8) h = h.slice(0, 6);
        return '#' + h.slice(0, 6).toLowerCase();
      }

      // rgb/rgba — comma-separated and space-separated
      var rm = c.match(/rgba?\\s*\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
      if (rm) {
        return '#' + [rm[1], rm[2], rm[3]].map(function(x) {
          return Math.min(255, Math.max(0, Math.round(parseFloat(x)))).toString(16).padStart(2, '0');
        }).join('');
      }

      // hsl/hsla
      var hsm = c.match(/hsla?\\s*\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)%[,\\s]+([\\d.]+)%/);
      if (hsm) {
        var hh = parseFloat(hsm[1]) / 360;
        var ss = parseFloat(hsm[2]) / 100;
        var ll = parseFloat(hsm[3]) / 100;
        return hslToHex(hh, ss, ll);
      }

      // oklch()
      var om = c.match(/oklch\\s*\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
      if (om) {
        try { return oklchToHex(parseFloat(om[1]), parseFloat(om[2]), parseFloat(om[3])); }
        catch(e) { return null; }
      }

      // color-mix() — extract first color arg
      var mm = c.match(/color-mix\\s*\\([^,]*,\\s*([^,)]+)/);
      if (mm) return colorToHex(mm[1].trim());

      return null;
    }

    function hslToHex(h, s, l) {
      var a = s * Math.min(l, 1 - l);
      var f = function(n) {
        var k = (n + h * 12) % 12;
        return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
      };
      return '#' + [f(0), f(8), f(4)].map(function(n) {
        return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      }).join('');
    }

    function oklchToHex(l, c, h) {
      var hRad = (h * Math.PI) / 180;
      var aVal = c * Math.cos(hRad);
      var bVal = c * Math.sin(hRad);
      var l_ = l + 0.3963377774 * aVal + 0.2158037573 * bVal;
      var m_ = l - 0.1055613458 * aVal - 0.0638541728 * bVal;
      var s_ = l - 0.0894841775 * aVal - 1.2914855480 * bVal;
      var l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
      var rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
      var gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
      var bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
      var toSrgb = function(x) {
        var v = Math.max(0, Math.min(1, x));
        return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055));
      };
      return '#' + [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)].map(function(n) {
        return n.toString(16).padStart(2, '0');
      }).join('');
    }

    // ── Role classifiers ───────────────────────────────────
    function classifyBgRole(el) {
      if (el === document.body) return 'body-bg';
      if (el.tagName === 'BUTTON' || el.closest('button')) return 'button';
      if (el.tagName === 'HEADER' || el.closest('header')) return 'header';
      if (el.tagName === 'FOOTER' || el.closest('footer')) return 'footer';
      if (el.tagName === 'NAV' || el.closest('nav')) return 'nav';
      if (/^H[1-6]$/.test(el.tagName)) return 'heading';
      if (el.closest('a')) return 'link';
      return 'generic';
    }

    function classifyTextRole(el) {
      if (/^H[1-6]$/.test(el.tagName)) return 'heading';
      if (el.tagName === 'A' || el.closest('a')) return 'link';
      if (el === document.body) return 'body-text';
      return 'generic';
    }

    function getElementPath(el) {
      var path = el.tagName.toLowerCase();
      if (el.id) path += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        var cls = el.className.split(/\\s+/).slice(0, 2).join('.');
        if (cls) path += '.' + cls;
      }
      return path;
    }

    function getShortSelector(el) {
      var sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        var c = el.className.split(/\\s+/)[0];
        if (c) sel += '.' + c;
      }
      return sel;
    }

    function extractGoogleFontFamily(href) {
      var m = href.match(/family=([^&:]+)/);
      return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
    }

    function extractGoogleFontVariants(href) {
      var m = href.match(/family=[^:]+:([^&]+)/);
      return m ? m[1].split(';').filter(Boolean) : ['400'];
    }
  })()`;
}
```

- [ ] **Step 1: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Commit**

```bash
git add src/core/design-dossier.ts src/core/design-extractor.ts
git commit -m "feat: add Playwright design evidence extraction with full color normalization"
```

### Task 2b: Wire extraction into InlinerResult + CDN wait

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Add dossier to InlinerResult**

```typescript
import { emptyDossier, type DesignDossier } from "./design-dossier.js";
import { buildExtractionScript } from "./design-extractor.js";

export interface InlinerResult {
  html: string;
  stylesCss: string;
  classNames: string[];
  warnings: string[];
  dossier: DesignDossier;
}
```

- [ ] **Step 2: Poll window.tailwind before extraction, then extract**

In `compileWithPlaywright`, after the CSS stability loop and verification succeed but before the closing `return`, insert:

```typescript
    // ── Layer 5: Wait for window.tailwind to be ready ──────
    const twReady = await page.evaluate(() => {
      return typeof (window as any).tailwind !== "undefined";
    });
    if (!twReady) {
      warnings.push("window.tailwind not available — tailwind.config values will be missing from customizer");
    }

    // ── Layer 6: Extract design evidence from live page ────
    let dossier: DesignDossier;
    try {
      const designScript = buildExtractionScript();
      const designJson = await page.evaluate(designScript);
      dossier = JSON.parse(designJson);
    } catch (err: any) {
      warnings.push(`Design extraction failed: ${err.message}`);
      dossier = emptyDossier();
    }
```

- [ ] **Step 3: Return dossier in all paths**

Update the normal return:
```typescript
    return { html, stylesCss: payload.css, classNames: payload.classNames, warnings, dossier };
```

Update the catch block return:
```typescript
    return { html, stylesCss: "", classNames: [], warnings, dossier: emptyDossier() };
```

Update `inlineTailwindMultiPage` to pass through `dossier` from `compileWithPlaywright` return.

- [ ] **Step 4: Verify existing tests still pass after InlinerResult change**

```bash
npx tsx --test tests/*.test.ts
```
Expected: all existing tests pass (adding `dossier` field shouldn't break anything since it's not destructured in tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: integrate design extraction into Playwright compilation flow"
```

---

## Phase 3: Deterministic Token Mapper

### Task 3: Write the token mapper

**Files:**
- Create: `src/core/token-mapper.ts`

```typescript
import type { DesignDossier, FontCandidate } from "./design-dossier.js";
import type { GpColorEntry, GpTypographyEntry } from "./types.js";

export interface MappedTokens {
  globalColors: GpColorEntry[];
  typography: GpTypographyEntry[];
  backgroundColor: string;
  containerWidth: number;
  linkColor: string;
  linkColorHover: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

export function mapTokensHeuristic(dossier: DesignDossier): MappedTokens {
  const notes: string[] = [...dossier.warnings];

  // ── Priority system for each token type:
  //    1. CSS custom property (--primary, --background, etc.)
  //    2. Computed style from semantic element (body-bg, button, heading)
  //    3. tailwind.config value (resolved by CDN)
  //    4. Hardcoded default

  // ── Background Color ─────────────────────────────────────
  let backgroundColor = selectColor(dossier, ["--background", "--color-background"], "body-bg", "background");

  // ── Primary Color ────────────────────────────────────────
  let primaryColor = selectColor(dossier, ["--primary", "--color-primary", "--tw-primary"], "button", "primary");

  // ── Secondary Color ──────────────────────────────────────
  let secondaryColor = selectColor(dossier, ["--secondary", "--color-secondary"], "generic", "secondary");

  // ── Fallback for secondary: second most-used non-primary, non-bg color
  if (secondaryColor === "#3a3a3a") {
    const others = dossier.colors.filter(
      (c) => c.hex !== primaryColor && c.hex !== backgroundColor && !c.roles.includes("body-bg")
    );
    others.sort((a, b) => b.usageCount - a.usageCount);
    if (others.length > 0) {
      secondaryColor = others[0].hex;
      notes.push(`Secondary inferred from usage (${others[0].usageCount} uses): ${secondaryColor}`);
    }
  }

  // ── Assemble global colors ───────────────────────────────
  const globalColors: GpColorEntry[] = [];
  function addColor(name: string, slug: string, color: string) {
    if (color && !globalColors.some((c) => c.slug === slug)) {
      globalColors.push({ name, slug, color });
    }
  }

  addColor("Background", "background", backgroundColor);
  addColor("Primary", "primary", primaryColor);
  addColor("Secondary", "secondary", secondaryColor);
  addColor("Accent", "accent", primaryColor);

  // Add significant remaining colors (≥5 uses, ≤8 extras)
  const existingHexes = new Set(globalColors.map((c) => c.color));
  const remaining = dossier.colors
    .filter((c) => c.usageCount >= 5 && !existingHexes.has(c.hex))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 8);

  for (const c of remaining) {
    const slug = c.configName || c.roles.find((r) => r !== "generic") || `color-${globalColors.length}`;
    const name = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
    if (!globalColors.some((gc) => gc.slug === slug)) {
      globalColors.push({ name, slug, color: c.hex });
    }
  }

  // ── Typography ───────────────────────────────────────────
  const typography: GpTypographyEntry[] = [];

  const bodySample = dossier.typographySamples.find((s) => s.tagName === "body");
  const bodyFont = pickFont(dossier, ["body", "p"]);
  if (bodyFont) {
    typography.push(makeTypographyEntry("body", bodyFont, bodySample!, "base"));
    notes.push(`Body font: ${bodyFont.fontFamily}`);
  }

  const h1Sample = dossier.typographySamples.find((s) => s.tagName === "h1");
  const headingFont = pickFont(dossier, ["h1", "h2", "h3"]);
  if (headingFont) {
    typography.push(makeTypographyEntry("all-headings", headingFont, h1Sample!, "content"));
    notes.push(`Heading font: ${headingFont.fontFamily}`);
  }

  // ── Container Width ──────────────────────────────────────
  let containerWidth = 1600;
  const sortedContainers = dossier.containers
    .filter((c) => c.source === "computed")
    .sort((a, b) => b.px - a.px);
  const best = sortedContainers.find((c) => c.px <= 2000);
  if (best) {
    containerWidth = best.px;
    notes.push(`Container width from computed style (${best.selector}): ${containerWidth}px`);
  } else if (dossier.tailwindConfig?.maxWidth?.container) {
    const parsed = parseInt(dossier.tailwindConfig.maxWidth.container);
    if (parsed > 0) { containerWidth = parsed; notes.push(`Container width from tailwind.config: ${containerWidth}px`); }
  }

  // ── Link Color ──────────────────────────────────────────
  let linkColor = primaryColor;
  let linkColorHover = "";

  // ── Confidence ───────────────────────────────────────────
  const hasFallbacks = notes.some((n) => n.includes("fallback") || n.includes("inferred"));
  const hasDefaults = notes.some((n) => n.includes("default"));
  const confidence = hasDefaults ? "low" : hasFallbacks ? "medium" : "high";

  return { globalColors, typography, backgroundColor, containerWidth, linkColor, linkColorHover, confidence, notes };
}

// ── Helpers ────────────────────────────────────────────────

function selectColor(dossier: DesignDossier, cssVarNames: string[], role: string, configKey: string): string {
  // 1. CSS custom property
  const prop = dossier.customProperties.find((p) => cssVarNames.includes(p.name));
  if (prop?.value) {
    const hex = tryHex(prop.value);
    if (hex) return hex;
  }

  // 2. Computed styles (by role)
  const byRole = dossier.colors.filter((c) => c.roles.includes(role));
  byRole.sort((a, b) => b.usageCount - a.usageCount);
  if (byRole.length > 0) return byRole[0].hex;

  // 3. tailwind.config
  if (dossier.tailwindConfig?.colors?.[configKey]) {
    const hex = tryHex(dossier.tailwindConfig.colors[configKey]);
    if (hex) return hex;
  }

  // 4. Hardcoded defaults
  const defaults: Record<string, string> = {
    body_bg: "#ffffff", background: "#ffffff",
    button: "#1e73be", primary: "#1e73be",
    generic: "#3a3a3a", secondary: "#3a3a3a",
  };
  return defaults[configKey] || defaults[role] || "#000000";
}

function tryHex(value: string): string | null {
  const hex = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex.toLowerCase() : null;
}

function pickFont(dossier: DesignDossier, roles: string[]): FontCandidate | undefined {
  for (const role of roles) {
    const match = dossier.fonts.find((f) => f.roles.includes(role));
    if (match) return match;
  }
  if (roles.includes("body") && dossier.tailwindConfig?.fontFamily?.sans) {
    return { fontFamily: dossier.tailwindConfig.fontFamily.sans.join(", "), roles: ["body"], configName: "sans" };
  }
  if (roles.some((r) => r.startsWith("h")) && dossier.tailwindConfig?.fontFamily?.display) {
    return { fontFamily: dossier.tailwindConfig.fontFamily.display.join(", "), roles: ["h1"], configName: "display" };
  }
  return dossier.fonts[0];
}

function makeTypographyEntry(selector: string, font: FontCandidate, sample: { fontSize?: string; fontWeight?: string; lineHeight?: string; textTransform?: string; letterSpacing?: string }, group: string): GpTypographyEntry {
  return {
    selector,
    customSelector: "",
    fontFamily: font.fontFamily,
    fontWeight: sample?.fontWeight || (selector === "body" ? "" : "600"),
    textTransform: sample?.textTransform || "",
    textDecoration: "",
    fontStyle: "",
    fontSize: selector === "body" ? (sample?.fontSize || "16px") : "",
    fontSizeTablet: "", fontSizeMobile: "",
    lineHeight: selector === "body" ? (sample?.lineHeight || "") : "",
    lineHeightTablet: "", lineHeightMobile: "",
    letterSpacing: sample?.letterSpacing || "",
    letterSpacingTablet: "", letterSpacingMobile: "",
    marginBottom: "", marginBottomTablet: "", marginBottomMobile: "", marginBottomUnit: "px",
    module: "core", group,
  };
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/core/token-mapper.ts
git commit -m "feat: add deterministic token mapper with priority heuristics"
```

---

## Phase 4: Rewrite Customizer Generator

### Task 4: New customizer generator + manual override support

**Files:**
- Modify: `src/core/customizer-generator.ts`
- Create: `config/customizer-overrides.json`

- [ ] **Step 1: Create override file**

`config/customizer-overrides.json`:
```json
{
  "_comment": "Override specific tokens here. Non-null values replace generated values. Delete this file or set values to null to use auto-detection.",
  "container_width": null,
  "background_color": null,
  "link_color": null,
  "link_color_hover": null,
  "global_colors": null,
  "typography": null
}
```

- [ ] **Step 2: Rewrite customizer-generator.ts**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DesignDossier } from "./design-dossier.js";
import type { MappedTokens } from "./token-mapper.js";
import { mapTokensHeuristic } from "./token-mapper.js";

export interface CustomizerExport {
  modules: Record<string, string>;
  mods: Record<string, unknown>;
  options: Record<string, unknown>;
}

const OVERRIDES_PATH = resolve(process.cwd(), "config", "customizer-overrides.json");

function loadOverrides(): Record<string, unknown> | null {
  try {
    if (existsSync(OVERRIDES_PATH)) {
      return JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
    }
  } catch { /* ignore broken overrides */ }
  return null;
}

export function generateCustomizerSettings(dossier: DesignDossier): CustomizerExport | null {
  if (!dossier?.extracted) return null;
  const tokens = mapTokensHeuristic(dossier);

  // Apply manual overrides
  const overrides = loadOverrides();
  if (overrides) {
    if (overrides.container_width != null) tokens.containerWidth = overrides.container_width as number;
    if (overrides.background_color != null) tokens.backgroundColor = overrides.background_color as string;
    if (overrides.link_color != null) tokens.linkColor = overrides.link_color as string;
    if (overrides.link_color_hover != null) tokens.linkColorHover = overrides.link_color_hover as string;
    if (overrides.global_colors != null) tokens.globalColors = overrides.global_colors as typeof tokens.globalColors;
    if (overrides.typography != null) tokens.typography = overrides.typography as typeof tokens.typography;
    tokens.notes.push("Manual overrides applied from config/customizer-overrides.json");
  }

  return buildCustomizerJson(tokens);
}

export function buildCustomizerJson(tokens: MappedTokens): CustomizerExport {
  return {
    modules: {
      Backgrounds: "generate_package_backgrounds",
      Blog: "generate_package_blog",
      Copyright: "generate_package_copyright",
      "Menu Plus": "generate_package_menu_plus",
      Spacing: "generate_package_spacing",
    },
    mods: { generate_copyright: false },
    options: {
      generate_settings: {
        container_width: tokens.containerWidth,
        content_layout_setting: "one-container",
        underline_links: "never",
        smooth_scroll: true,
        container_alignment: "boxes",
        global_colors: tokens.globalColors,
        typography: tokens.typography,
        background_color: tokens.backgroundColor,
        hide_title: true,
        hide_tagline: true,
        back_to_top: "enable",
        link_color: tokens.linkColor,
        link_color_hover: tokens.linkColorHover,
      },
      generate_background_settings: false,
      generate_blog_settings: {
        masonry: false, post_image: true, date: true, author: true,
        categories: true, tags: true, comments: true,
        single_date: true, single_author: true, single_categories: true, single_tags: true,
      },
      generate_spacing_settings: {
        separator: 0, content_element_separator: 0,
        header_right: 32, header_left: 32, content_right: 32, content_left: 32,
        header_top: 20, header_bottom: 20, menu_item_height: 50,
      },
      generate_menu_plus_settings: { sticky_menu: "false" },
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/customizer-generator.ts config/customizer-overrides.json
git commit -m "refactor: rewrite customizer generator with dossier-based extraction and manual overrides"
```

---

## Phase 5: Wire Through Orchestrator & CLI

### Task 5: Update orchestrator and CLI

**Files:**
- Modify: `src/core/orchestrator.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update orchestrator.ts**

Add to imports:
```typescript
import { emptyDossier, type DesignDossier } from "./design-dossier.js";
```

Add to `ConversionInput`:
```typescript
dossier?: DesignDossier;
```

In `convert()`, capture dossier from inliner:

```typescript
let dossier = input.dossier ?? emptyDossier();

if (!input.cssAlreadyCompiled && usesTailwind(rawHtml)) {
  const compiled = await inlineTailwindStyles(rawHtml);
  // ...warnings...
  compiledCss = compiled.stylesCss;
  if (!input.dossier && compiled.dossier?.extracted) {
    dossier = compiled.dossier;
  }
}
```

Change `generateCustomizerSettings(input.rawHtml)` to `generateCustomizerSettings(dossier)`.

- [ ] **Step 2: Update CLI multi-page flow**

In both `project:setup` and project mode convert, capture `sharedDossier` from `inlineTailwindMultiPage` and pass it to every `convert()` call via `dossier: sharedDossier`.

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts src/cli/index.ts
git commit -m "feat: wire DesignDossier through orchestrator and CLI"
```

---

## Phase 6: Tests

### Task 6: Tests for color normalization

**Files:**
- Create: `tests/design-extractor.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { colorToHex } from "../src/core/design-extractor.js";

describe("colorToHex", () => {
  it("converts hex to hex", () => {
    assert.strictEqual(colorToHex("#ff0000"), "#ff0000");
    assert.strictEqual(colorToHex("#c5ffd6"), "#c5ffd6");
  });

  it("converts 3-digit hex", () => {
    assert.strictEqual(colorToHex("#f00"), "#ff0000");
  });

  it("converts rgb()", () => {
    assert.strictEqual(colorToHex("rgb(30, 115, 190)"), "#1e73be");
  });

  it("converts rgba()", () => {
    assert.strictEqual(colorToHex("rgba(30, 115, 190, 0.5)"), "#1e73be");
  });

  it("converts space-separated modern rgb", () => {
    assert.strictEqual(colorToHex("rgb(30 115 190)"), "#1e73be");
  });

  it("converts hsl()", () => {
    const result = colorToHex("hsl(0, 100%, 50%)");
    assert.strictEqual(result, "#ff0000");
  });

  it("converts oklch() approximately", () => {
    // oklch(0.628 0.258 29) ≈ a vivid red-orange
    const result = colorToHex("oklch(0.628 0.258 29)");
    assert.ok(result, "oklch should produce a hex color");
    assert.ok(result.startsWith("#"), "result should be #hex: " + result);
  });

  it("handles color-mix() by extracting first argument", () => {
    const result = colorToHex("color-mix(in srgb, #ff0000 80%, white)");
    assert.strictEqual(result, "#ff0000");
  });

  it("returns null for transparent", () => {
    assert.strictEqual(colorToHex("transparent"), null);
    assert.strictEqual(colorToHex("rgba(0, 0, 0, 0)"), null);
  });

  it("returns null for currentColor", () => {
    assert.strictEqual(colorToHex("currentColor"), null);
  });

  it("returns null for empty input", () => {
    assert.strictEqual(colorToHex(""), null);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx tsx --test tests/design-extractor.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/design-extractor.test.ts
git commit -m "test: add color normalization tests for oklch, hsl, rgb formats"
```

### Task 7: Tests for token mapper

**Files:**
- Create: `tests/token-mapper.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { mapTokensHeuristic } from "../src/core/token-mapper.js";
import type { DesignDossier } from "../src/core/design-dossier.js";

function makeMinoDossier(): DesignDossier {
  return {
    colors: [
      { hex: "#eeeeee", usageCount: 142, roles: ["body-bg", "generic"], examples: ["body", "div"], configName: "background" },
      { hex: "#1e293b", usageCount: 87, roles: ["generic", "footer"], examples: ["div.surface", "footer"], configName: "surface" },
      { hex: "#c5ffd6", usageCount: 45, roles: ["button", "link", "generic"], examples: ["a.button", "button"], configName: "primary" },
      { hex: "#3d3b4f", usageCount: 23, roles: ["generic"], examples: ["div.secondary"], configName: "secondary" },
      { hex: "#334155", usageCount: 120, roles: ["generic"], examples: ["p", "span"], configName: "slate" },
    ],
    fonts: [
      { fontFamily: '"DM Sans", sans-serif', roles: ["body", "p", "a"], configName: "sans", sampleSize: "16px", sampleWeight: "400" },
      { fontFamily: 'Anybody, sans-serif', roles: ["h1", "h2", "h3"], configName: "display", sampleSize: "48px", sampleWeight: "700" },
    ],
    containers: [{ px: 1600, source: "computed", selector: "div.max-w-container" }],
    customProperties: [
      { name: "--primary", value: "#c5ffd6", context: ":root" },
      { name: "--secondary", value: "#3d3b4f", context: ":root" },
    ],
    googleFonts: [],
    typographySamples: [
      { selector: "body", tagName: "body", fontSize: "16px", fontWeight: "400", lineHeight: "1.6", fontFamily: '"DM Sans", sans-serif', textTransform: "none", letterSpacing: "normal" },
      { selector: "h1", tagName: "h1", fontSize: "48px", fontWeight: "700", lineHeight: "1.2", fontFamily: 'Anybody, sans-serif', textTransform: "none", letterSpacing: "-0.02em" },
    ],
    tailwindConfig: {
      colors: { background: "#eeeeee", primary: "#c5ffd6", secondary: "#3d3b4f", slate: "#334155" },
      fontFamily: { sans: ['"DM Sans"', "sans-serif"], display: ["Anybody", "sans-serif"] },
      maxWidth: { container: "1600px" },
    },
    extracted: true,
    warnings: [],
  };
}

describe("mapTokensHeuristic", () => {
  it("picks background from body-bg role", () => {
    assert.strictEqual(mapTokensHeuristic(makeMinoDossier()).backgroundColor, "#eeeeee");
  });

  it("picks primary from CSS custom property --primary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    assert.strictEqual(tokens.linkColor, "#c5ffd6");
    assert.strictEqual(tokens.globalColors.find(c => c.slug === "primary")?.color, "#c5ffd6");
  });

  it("picks secondary from CSS custom property --secondary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    assert.strictEqual(tokens.globalColors.find(c => c.slug === "secondary")?.color, "#3d3b4f");
  });

  it("picks body font from body role", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const body = tokens.typography.find(t => t.selector === "body");
    assert.ok(body, "should have body typography entry");
    assert.ok(body!.fontFamily.includes("DM Sans"));
  });

  it("picks heading font from h1 role", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const heading = tokens.typography.find(t => t.selector === "all-headings");
    assert.ok(heading, "should have all-headings entry");
    assert.ok(heading!.fontFamily.includes("Anybody"));
  });

  it("accent equals primary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const accent = tokens.globalColors.find(c => c.slug === "accent");
    const primary = tokens.globalColors.find(c => c.slug === "primary");
    assert.strictEqual(accent?.color, primary?.color);
  });

  it("falls back to defaults on empty dossier", () => {
    const empty = makeMinoDossier();
    empty.colors = []; empty.fonts = []; empty.containers = [];
    empty.customProperties = []; empty.tailwindConfig = null;
    empty.typographySamples = [];
    const tokens = mapTokensHeuristic(empty);
    assert.strictEqual(tokens.backgroundColor, "#ffffff");
    assert.strictEqual(tokens.containerWidth, 1600);
    assert.ok(tokens.globalColors.length >= 1);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx tsx --test tests/token-mapper.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/token-mapper.test.ts
git commit -m "test: add token mapper heuristic tests"
```

### Task 8: Tests for customizer generator

**Files:**
- Create: `tests/customizer-generator.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { generateCustomizerSettings, buildCustomizerJson } from "../src/core/customizer-generator.js";
import type { MappedTokens } from "../src/core/token-mapper.js";
import type { DesignDossier } from "../src/core/design-dossier.js";

function makeBasicDossier(): DesignDossier {
  return {
    colors: [
      { hex: "#f8f9fa", usageCount: 200, roles: ["body-bg"], examples: ["body"], configName: "background" },
      { hex: "#0d6efd", usageCount: 60, roles: ["button", "link"], examples: ["a", "button"], configName: "primary" },
    ],
    fonts: [
      { fontFamily: "Inter, sans-serif", roles: ["body", "h1"], configName: "sans", sampleSize: "16px", sampleWeight: "400" },
    ],
    containers: [{ px: 1200, source: "computed", selector: "div.container" }],
    customProperties: [],
    googleFonts: [],
    typographySamples: [
      { selector: "body", tagName: "body", fontSize: "16px", fontWeight: "400", lineHeight: "1.5", fontFamily: "Inter, sans-serif", textTransform: "none", letterSpacing: "normal" },
      { selector: "h1", tagName: "h1", fontSize: "36px", fontWeight: "700", lineHeight: "1.2", fontFamily: "Inter, sans-serif", textTransform: "none", letterSpacing: "-0.01em" },
    ],
    tailwindConfig: null,
    extracted: true,
    warnings: [],
  };
}

describe("generateCustomizerSettings", () => {
  it("returns null for unextracted dossier", () => {
    assert.strictEqual(generateCustomizerSettings({ ...makeBasicDossier(), extracted: false }), null);
  });

  it("produces valid CustomizerExport with colors and typography", () => {
    const result = generateCustomizerSettings(makeBasicDossier());
    assert.ok(result);
    const s = result.options.generate_settings as Record<string, unknown>;
    assert.ok(Array.isArray(s.global_colors));
    assert.ok(Array.isArray(s.typography));
    assert.strictEqual(typeof s.container_width, "number");
    assert.strictEqual(typeof s.background_color, "string");
  });

  it("includes background, primary, accent in global_colors", () => {
    const result = generateCustomizerSettings(makeBasicDossier())!;
    const slugs = (result.options.generate_settings.global_colors as Array<{slug: string}>).map(c => c.slug);
    assert.ok(slugs.includes("background"));
    assert.ok(slugs.includes("primary"));
    assert.ok(slugs.includes("accent"));
  });

  it("no empty required fields", () => {
    const result = generateCustomizerSettings(makeBasicDossier())!;
    const s = result.options.generate_settings;
    assert.ok(s.background_color.length > 0);
    assert.ok(s.link_color.length > 0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx tsx --test tests/customizer-generator.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/customizer-generator.test.ts
git commit -m "test: add customizer generator integration tests"
```

---

## Phase 7: End-to-End Validation

### Task 9: Run full conversion on real inputs

- [ ] **Step 1: Run mino project**

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split
```

- [ ] **Step 2: Verify customizer-import.json**

```bash
node -e "
const d = require('./output/mino/customizer-import.json');
const s = d.options.generate_settings;
console.log('Colors:', s.global_colors.map(c=>c.slug).join(', '));
console.log('Background:', s.background_color);
console.log('Container:', s.container_width);
console.log('Typography:', s.typography.length, 'entries');
s.typography.forEach(t => console.log('  -', t.selector, ':', t.fontFamily));
console.log('Link color:', s.link_color);
"
```

Expected (from mino `index.html`):
- Background: `#EEEEEE` (not `#ffffff`)
- Primary: `#C5FFD6` (not `#1e73be`)
- Typography: body → DM Sans, headings → Anybody
- Container: 1600
- Link color: `#C5FFD6` (not empty)

- [ ] **Step 3: Run hkvc project**

```bash
npx tsx src/cli/index.ts convert inputs/hkvc/ --split
node -e "
const d = require('./output/hkvc/customizer-import.json');
const s = d.options.generate_settings;
console.log('Colors:', s.global_colors.map(c=>c.slug).join(', '));
console.log('Background:', s.background_color);
console.log('Typography:', s.typography.length, 'entries');
"
```

Expected: contains actual colors and font data, not hardcoded defaults.

- [ ] **Step 4: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```
Expected: all tests pass (new + existing).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete V1 customizer design token extraction — E2E validated"
```
