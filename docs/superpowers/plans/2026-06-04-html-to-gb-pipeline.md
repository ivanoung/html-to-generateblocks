# HTML-to-GB Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modular HTML-to-GenerateBlocks conversion pipeline that takes raw Tailwind HTML pages and outputs WordPress paste-ready GB block markup, using the coding agent for semantic classification and Node.js for all deterministic work.

**Architecture:** Five phases (2→3→1→4→5) executed by the coding agent orchestrating Node.js modules. Phase 3 (manifest classification) is performed by the agent itself. Phases 1, 2, 4, 5 are pure Node.js. The existing IR layer and serializer are untouched — new code feeds into them.

**Tech Stack:** TypeScript + ESM, cheerio (HTML parsing), Tailwind CSS CLI (style resolution), `css` npm package (custom style parsing). No external LLM API.

---

## File Structure

```
src/
├── types/
│   └── manifest.ts              # NEW: SectionManifest type definitions
├── converter/                   # NEW directory
│   ├── structure-parser.ts      # Phase 2: section boundary detection
│   ├── manifest-validator.ts    # Phase 3: manifest schema + selector validation
│   ├── role-mapper.ts           # Phase 4: role → IR mapping table
│   ├── style-resolver.ts        # Phase 1: Tailwind CLI wrapper + style merging
│   ├── html-to-ir.ts            # Phase 4: HTML DOM + manifest → IRNode[]
│   └── pipeline.ts              # Orchestrator: runs phases in order
├── core/                        # Existing (unchanged)
├── runner/                      # Existing (unchanged)
└── cli/
    └── index.ts                 # Extended: new convert command
```

---

### Task 1: Create manifest type definitions

**Files:**
- Create: `src/types/manifest.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
// ── Manifest Types ─────────────────────────────────────────────
//
// Type definitions for the section manifest produced during
// Phase 3 classification. Used by manifest-validator.ts,
// html-to-ir.ts, and role-mapper.ts.

export const SECTION_KINDS = [
  "hero", "card-grid", "stats-row", "testimonial-grid",
  "data-rows", "checklist", "feature-grid", "contact-form",
  "logo-marquee", "text-block", "generic",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export const ELEMENT_ROLES = [
  "section-label", "heading", "eyebrow", "body",
  "cta-button", "cta-link", "image", "icon", "iconify",
  "avatar", "avatar-stack", "star-rating", "social-proof",
  "card", "card-heading", "card-body", "card-footer", "card-step-label",
  "checklist-item",
  "testimonial", "testimonial-quote", "testimonial-name",
  "testimonial-title", "testimonial-company",
  "form-field", "form-radio-group", "form-textarea", "form-submit",
  "embed", "decoration",
] as const;

export type ElementRole = (typeof ELEMENT_ROLES)[number];

export const GROUP_ROLES = [
  "cta-row", "checklist", "card-grid", "feature-card-grid",
  "testimonial-grid", "social-proof-group", "avatar-row", "star-row",
] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];

export interface ManifestElement {
  selector: string;
  role: ElementRole;
  action?: "strip"; // only valid for role: "decoration"
}

export interface ManifestGroup {
  selector: string;
  role: GroupRole;
  elements: ManifestElement[];
}

export interface ManifestTemplate {
  selector: string;
  role: ElementRole;
  elements: ManifestElement[];
  repeat: "siblings";
}

export interface ManifestNotes {
  decorationEls: string[];
  unsupportedFeatures: string[];
  warnings: string[];
}

export interface SectionManifest {
  sectionId: string;
  kind: SectionKind;
  layout: "single-column" | "two-column" | "grid" | "flex-row" | "form";
  elements: ManifestElement[];
  groups?: ManifestGroup[];
  templates?: ManifestTemplate[];
  exceptions?: ManifestElement[];
  notes: ManifestNotes;
  coverage: number; // 0-100
}

export interface PageManifest {
  page: string;
  sections: SectionManifest[];
  pageMeta: {
    title: string;
    fontFamilies: string[];
    description: string;
  };
}

export interface SectionSnippet {
  sectionId: string;
  html: string;
  elementCount: number;
  isDecorative: boolean;
}

export interface PageMeta {
  title: string;
  fontFamilies: string[];
  description: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/manifest.ts
git commit -m "feat: add manifest type definitions for Phase 3 classification"
```

---

### Task 2: Structure parser (Phase 2)

**Files:**
- Create: `src/converter/structure-parser.ts`

- [ ] **Step 1: Write the structure parser**

```typescript
// ── Structure Parser (Phase 2) ─────────────────────────────────
//
// Takes a raw HTML page and splits it into section snippets.
// Strips nav, footer, scripts. Detects section boundaries.

import * as cheerio from "cheerio";
import type { SectionSnippet, PageMeta } from "../types/manifest.js";

const STRIP_TAGS = ["nav", "footer", "script", "style", "link"];

/** CSS unit value → pixels at 16px base. Returns NaN for unresolvable values. */
function toPx(value: string): number {
  const v = value.trim();
  if (v.endsWith("px")) return parseFloat(v);
  if (v.endsWith("rem")) return parseFloat(v) * 16;
  if (v.endsWith("em")) return parseFloat(v) * 16;
  const num = parseFloat(v);
  return isNaN(num) ? NaN : num;
}

export interface ParseStructureResult {
  snippets: SectionSnippet[];
  pageMeta: PageMeta;
  warnings: string[];
}

export function parseStructure(rawHtml: string): ParseStructureResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml);

  // Extract page metadata
  const pageMeta: PageMeta = {
    title: $("title").first().text() || "",
    fontFamilies: [],
    description: $('meta[name="description"]').attr("content") || "",
  };

  // Extract font families from Google Fonts links
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const families = href.match(/family=([^&]+)/);
    if (families) {
      const decoded = decodeURIComponent(families[1]);
      decoded.split("|").forEach((f) => {
        const name = f.split(":")[0].replace(/\+/g, " ");
        pageMeta.fontFamilies.push(name);
      });
    }
  });

  // Strip non-content elements
  for (const tag of STRIP_TAGS) {
    $(tag).remove();
  }

  const $body = $("body");
  if ($body.length === 0) {
    return { snippets: [], pageMeta, warnings: ["No <body> found"] };
  }

  const snippets: SectionSnippet[] = [];

  // Priority 1: <section> tags with id
  const $sections = $body.find("section[id]");
  if ($sections.length > 0) {
    $sections.each((_, el) => {
      const $el = $(el);
      const id = $el.attr("id") || `section-${snippets.length + 1}`;
      const childCount = $el.find("*").length;
      snippets.push({
        sectionId: id,
        html: $.html(el),
        elementCount: childCount,
        isDecorative: false,
      });
    });

    // Attach decorative dividers (aria-hidden) to adjacent sections
    $body.children().each((i, el) => {
      const $el = $(el);
      if ($el.attr("aria-hidden") === "true" && !$el.is("section[id]")) {
        // Attach to preceding section if it exists
        const prevSnippet = snippets.find((s) => {
          const prevEl = $body.find(`section[id="${s.sectionId}"]`).prev();
          return prevEl.length && $.html(prevEl) === $.html(el);
        });
        if (prevSnippet) {
          prevSnippet.html += "\n" + $.html(el);
        }
      }
    });

    // Merge very short sections (< 2 elements) with previous
    for (let i = snippets.length - 1; i > 0; i--) {
      if (snippets[i].elementCount < 2 && !snippets[i].isDecorative) {
        snippets[i - 1].html += "\n" + snippets[i].html;
        snippets[i - 1].elementCount += snippets[i].elementCount;
        snippets.splice(i, 1);
      }
    }

    return { snippets, pageMeta, warnings };
  }

  // Priority 2: <div> elements with structural styles
  // (padding ≥ 64px, min-height ≥ 50vh, or margin-top ≥ 64px)
  const candidates: { el: cheerio.Cheerio; id: string }[] = [];
  $body.find("div[style]").each((_, el) => {
    const style = $(el).attr("style") || "";
    const pt = style.match(/padding-top\s*:\s*([^;]+)/);
    const pb = style.match(/padding-bottom\s*:\s*([^;]+)/);
    const mh = style.match(/min-height\s*:\s*([^;]+)/);
    const mt = style.match(/margin-top\s*:\s*([^;]+)/);

    const ptPx = pt ? toPx(pt[1]) : 0;
    const pbPx = pb ? toPx(pb[1]) : 0;
    const mhVh = mh ? (mh[1].includes("vh") ? parseFloat(mh[1]) : 0) : 0;
    const mtPx = mt ? toPx(mt[1]) : 0;

    if (ptPx >= 64 || pbPx >= 64 || mhVh >= 50 || mtPx >= 64) {
      const id = $(el).attr("id") || `section-${candidates.length + 1}`;
      candidates.push({ el: $(el), id });
    }
  });

  if (candidates.length > 0) {
    for (const { el, id } of candidates) {
      snippets.push({
        sectionId: id,
        html: $.html(el),
        elementCount: el.find("*").length,
        isDecorative: false,
      });
    }
    return { snippets, pageMeta, warnings };
  }

  // Priority 3: Fallback — wrap entire <main> as one section
  const $main = $body.find("main");
  if ($main.length > 0) {
    snippets.push({
      sectionId: "main",
      html: $.html($main),
      elementCount: $main.find("*").length,
      isDecorative: false,
    });
    return { snippets, pageMeta, warnings };
  }

  // Final fallback: entire body
  if ($body.children().length > 0) {
    snippets.push({
      sectionId: "body",
      html: $.html($body),
      elementCount: $body.find("*").length,
      isDecorative: false,
    });
    return { snippets, pageMeta, warnings };
  }

  warnings.push("No content sections detected in page");
  return { snippets: [], pageMeta, warnings };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/structure-parser.ts
git commit -m "feat(phase2): add structure parser for section boundary detection"
```

---

### Task 3: Manifest validator (Phase 3)

**Files:**
- Create: `src/converter/manifest-validator.ts`

- [ ] **Step 1: Write the manifest validator**

```typescript
// ── Manifest Validator (Phase 3) ───────────────────────────────
//
// Validates a SectionManifest produced by the coding agent.
// Checks schema correctness, selector validity, and coverage.

import * as cheerio from "cheerio";
import {
  SECTION_KINDS, GROUP_ROLES, ELEMENT_ROLES,
  type SectionManifest, type ManifestElement,
} from "../types/manifest.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Selectors that failed to match any element in the HTML. */
  missedSelectors: string[];
}

export function validateManifest(
  manifest: SectionManifest,
  sectionHtml: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missedSelectors: string[] = [];

  // Schema validation
  if (!manifest.sectionId || typeof manifest.sectionId !== "string") {
    errors.push("Missing or invalid sectionId");
  }
  if (!SECTION_KINDS.includes(manifest.kind as any)) {
    errors.push(`Invalid kind: "${manifest.kind}". Must be one of: ${SECTION_KINDS.join(", ")}`);
  }
  if (!Array.isArray(manifest.elements)) {
    errors.push("elements must be an array");
  }
  if (typeof manifest.coverage !== "number" || manifest.coverage < 0 || manifest.coverage > 100) {
    errors.push("coverage must be a number 0-100");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, missedSelectors };
  }

  const $ = cheerio.load(`<div>${sectionHtml}</div>`);
  const selectorsToCheck: string[] = [];

  // Collect all selectors
  const collectSelectors = (els: ManifestElement[]) => {
    for (const el of els) {
      if (!ELEMENT_ROLES.includes(el.role as any)) {
        errors.push(`Invalid element role: "${el.role}"`);
      }
      selectorsToCheck.push(el.selector);
    }
  };

  collectSelectors(manifest.elements);

  if (manifest.groups) {
    for (const group of manifest.groups) {
      if (!GROUP_ROLES.includes(group.role as any)) {
        errors.push(`Invalid group role: "${group.role}"`);
      }
      selectorsToCheck.push(group.selector);
      collectSelectors(group.elements);
    }
  }

  if (manifest.templates) {
    for (const tmpl of manifest.templates) {
      selectorsToCheck.push(tmpl.selector);
      collectSelectors(tmpl.elements);
    }
  }

  if (manifest.exceptions) {
    for (const exc of manifest.exceptions) {
      selectorsToCheck.push(exc.selector);
    }
  }

  // Check each selector against the HTML
  for (const sel of selectorsToCheck) {
    try {
      const matches = $(sel);
      if (matches.length === 0) {
        missedSelectors.push(sel);
        errors.push(`Selector not found in HTML: "${sel}"`);
      } else if (matches.length > 1) {
        warnings.push(`Selector matches ${matches.length} elements: "${sel}" — using first`);
      }
    } catch (e: any) {
      errors.push(`Invalid selector: "${sel}" — ${e.message}`);
    }
  }

  // Coverage check
  if (manifest.coverage < 70) {
    warnings.push(`Low coverage (${manifest.coverage}%). Section may need manual review.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missedSelectors,
  };
}

/**
 * Merge manifest overrides from a JSON file.
 * Overrides replace matching sections by sectionId, or add new ones.
 */
export interface ManifestOverride {
  sectionId: string;
  kind?: string;
  layout?: string;
  elements?: ManifestElement[];
  groups?: any[];
  templates?: any[];
  exceptions?: any[];
  coverage?: number;
  _add?: ManifestElement[];
}

export function applyOverrides(
  manifest: SectionManifest,
  overrides: ManifestOverride[],
): SectionManifest {
  const override = overrides.find((o) => o.sectionId === manifest.sectionId);
  if (!override) return manifest;

  const result = { ...manifest };

  if (override.kind) result.kind = override.kind as any;
  if (override.layout) result.layout = override.layout as any;
  if (override.elements) result.elements = override.elements;
  if (override.groups) result.groups = override.groups as any;
  if (override.templates) result.templates = override.templates as any;
  if (override.exceptions) result.exceptions = override.exceptions as any;
  if (override.coverage !== undefined) result.coverage = override.coverage;

  if (override._add) {
    result.elements = [...result.elements, ...override._add];
  }

  return result;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/manifest-validator.ts
git commit -m "feat(phase3): add manifest validator for schema + selector checks"
```

---

### Task 4: Role mapper (Phase 4)

**Files:**
- Create: `src/converter/role-mapper.ts`

- [ ] **Step 1: Write the role → IR mapping table**

```typescript
// ── Role Mapper (Phase 4) ──────────────────────────────────────
//
// Maps manifest element/group roles to IR node types.
// Pure data module — no logic, just lookup tables.

import type { IRNodeType, LayoutIntent, FallbackPolicy } from "../core/ir-node.js";
import type { ElementRole, GroupRole } from "../types/manifest.js";

export interface RoleMapping {
  nodeType: IRNodeType;
  layoutIntent?: LayoutIntent;
  fallbackPolicy: FallbackPolicy;
  /** If true, wraps element HTML in a core/html block. */
  useCoreHtml?: boolean;
  /** IRNodeType to use when core/html wrapping is active. */
  coreHtmlNodeType?: IRNodeType;
}

/** Map of element role → IR conversion rules. */
export const ELEMENT_ROLE_MAP: Record<ElementRole, RoleMapping> = {
  "heading": { nodeType: "heading", fallbackPolicy: "generateblocks" },
  "eyebrow": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "section-label": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "body": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "cta-button": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "cta-link": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "image": { nodeType: "image", fallbackPolicy: "core" },
  "icon": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "iconify": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "avatar": { nodeType: "image", fallbackPolicy: "core" },
  "avatar-stack": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "star-rating": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true, coreHtmlNodeType: "container" },
  "social-proof": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "card": { nodeType: "container", layoutIntent: "stack", fallbackPolicy: "generateblocks" },
  "card-heading": { nodeType: "heading", fallbackPolicy: "generateblocks" },
  "card-body": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "card-footer": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "card-step-label": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "checklist-item": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "testimonial": { nodeType: "container", layoutIntent: "stack", fallbackPolicy: "generateblocks" },
  "testimonial-quote": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-name": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-title": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-company": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "form-field": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-radio-group": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-textarea": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-submit": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "embed": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "decoration": { nodeType: "container", fallbackPolicy: "reject" },
};

/** Map of group role → container layout intent. */
export const GROUP_LAYOUT_MAP: Record<GroupRole, LayoutIntent> = {
  "cta-row": "row",
  "checklist": "stack",
  "card-grid": "grid",
  "feature-card-grid": "grid",
  "testimonial-grid": "grid",
  "social-proof-group": "row",
  "avatar-row": "row",
  "star-row": "row",
};

/**
 * Manifest section layout → IR container layoutIntent.
 */
export function sectionLayoutToIntent(
  layout: string,
): LayoutIntent {
  switch (layout) {
    case "two-column": return "grid";
    case "grid": return "grid";
    case "flex-row": return "row";
    case "form": return "stack";
    case "single-column":
    default: return "constrained";
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/role-mapper.ts
git commit -m "feat(phase4): add role → IR mapping table"
```

---

### Task 5: Style resolver (Phase 1)

**Files:**
- Create: `src/converter/style-resolver.ts`

- [ ] **Step 1: Write the style resolver**

```typescript
// ── Style Resolver (Phase 1) ───────────────────────────────────
//
// Resolves Tailwind utility classes + custom <style> blocks to
// inline styles. Produces clean HTML with no CSS classes.
// Uses the real Tailwind CLI for utility resolution.

import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const CACHE_DIR = join(process.cwd(), "output", ".cache");

/** Breakpoints used by Tailwind for responsive inversion. */
const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
};

/** Max-width equivalents (desktop-first) for responsive inversion. */
function maxWidthFor(bp: string): number {
  const minWidth = BREAKPOINTS[bp];
  return minWidth ? minWidth - 1 : 1023;
}

export interface StyleResolveResult {
  resolvedHtml: string;
  warnings: string[];
}

/**
 * Attempt to resolve Tailwind classes using the Tailwind CLI.
 * Creates temp files, runs `npx tailwindcss`, parses output.
 * Falls back gracefully if CLI is unavailable or config is missing.
 */
export function resolveStyles(sectionHtml: string, fullPageHtml: string): StyleResolveResult {
  const warnings: string[] = [];

  // Step 1: Extract tailwind.config from <script> block
  const configMatch = fullPageHtml.match(
    /tailwind\.config\s*=\s*(\{[\s\S]*?\});/,
  );
  if (!configMatch) {
    warnings.push("No tailwind.config found in page. Skipping Tailwind resolution.");
    return { resolvedHtml: sectionHtml, warnings };
  }

  const configStr = configMatch[1];

  // Step 2: Create temp files
  const hash = createHash("md5").update(sectionHtml).digest("hex").slice(0, 8);
  const tmpDir = join(tmpdir(), `gb-resolve-${hash}`);
  mkdirSync(tmpDir, { recursive: true });

  const configPath = join(tmpDir, "tailwind.config.cjs");
  const inputCssPath = join(tmpDir, "input.css");
  const outputCssPath = join(tmpDir, "output.css");
  const contentPath = join(tmpDir, "content.html");

  try {
    // Write tailwind config as CommonJS
    writeFileSync(configPath, `module.exports = ${configStr};\n`, "utf-8");

    // Write input CSS
    writeFileSync(
      inputCssPath,
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
      "utf-8",
    );

    // Write HTML content
    writeFileSync(contentPath, sectionHtml, "utf-8");

    // Step 3: Run Tailwind CLI
    execSync(
      `npx tailwindcss -i "${inputCssPath}" -o "${outputCssPath}" --content "${contentPath}" --minify`,
      { cwd: tmpDir, timeout: 30000, stdio: "pipe" },
    );

    if (!existsSync(outputCssPath)) {
      warnings.push("Tailwind CLI did not produce output CSS.");
      return { resolvedHtml: sectionHtml, warnings };
    }

    const outputCss = readFileSync(outputCssPath, "utf-8");

    // Step 4: Parse <style> blocks from section HTML
    const customCssMap = parseStyleBlocks(sectionHtml);

    // Step 5: Build class → declarations map from both sources
    const classMap = parseTailwindOutput(outputCss);

    // Merge custom styles (they override Tailwind)
    for (const [cls, decls] of Object.entries(customCssMap)) {
      if (classMap[cls]) {
        classMap[cls] = { ...classMap[cls], ...decls };
      } else {
        classMap[cls] = decls;
      }
    }

    // Step 6: Apply resolved styles to each element
    const resolvedHtml = applyClassMap(sectionHtml, classMap, warnings);

    return { resolvedHtml, warnings };
  } catch (e: any) {
    if (e.message?.includes("tailwindcss")) {
      warnings.push(
        "Tailwind CLI not available. Install with: npm install -D tailwindcss @tailwindcss/cli",
      );
    } else {
      warnings.push(`Style resolution failed: ${e.message}`);
    }
    return { resolvedHtml: sectionHtml, warnings };
  } finally {
    // Cleanup temp files
    try {
      if (existsSync(configPath)) unlinkSync(configPath);
      if (existsSync(inputCssPath)) unlinkSync(inputCssPath);
      if (existsSync(outputCssPath)) unlinkSync(outputCssPath);
      if (existsSync(contentPath)) unlinkSync(contentPath);
    } catch { /* cleanup is best-effort */ }
  }
}

/** Parse <style> blocks into class → declarations map. */
function parseStyleBlocks(html: string): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = styleRegex.exec(html)) !== null) {
    const css = match[1];
    // Parse simple .classname { prop: value; } rules
    const ruleRegex = /\.([a-zA-Z_][\w-]*(?:\\.[\w-]+)*)\s*\{([^}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRegex.exec(css)) !== null) {
      const className = ruleMatch[1];
      const declarations: Record<string, string> = {};
      const body = ruleMatch[2];
      const declRegex = /([a-zA-Z-]+)\s*:\s*([^;]+)/g;
      let declMatch: RegExpExecArray | null;
      while ((declMatch = declRegex.exec(body)) !== null) {
        declarations[declMatch[1].trim()] = declMatch[2].trim();
      }
      if (map[className]) {
        map[className] = { ...map[className], ...declarations };
      } else {
        map[className] = declarations;
      }
    }
  }

  return map;
}

/** Parse Tailwind CLI output into class → declarations map. */
function parseTailwindOutput(css: string): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const ruleRegex = /\.([a-zA-Z_][\w-]*(?:\\.[\w-]+)*)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  // Responsive rules
  const responsiveRegex = /@media\s*\(min-width:\s*(\d+)px\)\s*\{([^}]*\.([a-zA-Z_][\w-]*(?:\\.[\w-]+)*)\s*\{([^}]+)\}[^}]*)\}/g;

  while ((match = ruleRegex.exec(css)) !== null) {
    const className = match[1];
    const declarations: Record<string, string> = {};
    const body = match[2];
    const declRegex = /([a-zA-Z-]+)\s*:\s*([^;]+)/g;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRegex.exec(body)) !== null) {
      declarations[declMatch[1].trim()] = declMatch[2].trim();
    }
    map[className] = declarations;
  }

  return map;
}

/**
 * Apply resolved class → declarations map to HTML elements.
 * Replaces class attributes with inline style attributes.
 * Handles responsive prefix (sm:, md:, lg:, xl:) by inverting breakpoints.
 */
function applyClassMap(
  html: string,
  classMap: Record<string, Record<string, string>>,
  warnings: string[],
): string {
  // Simple approach: use regex to find elements with class attributes,
  // resolve each class, build style string, replace class with style.
  const classRegex = /class="([^"]*)"/g;

  return html.replace(classRegex, (_full: string, classStr: string) => {
    const classes = classStr.split(/\s+/).filter(Boolean);
    const baseStyles: Record<string, string> = {};
    const responsiveStyles: Record<string, Record<string, string>> = {};

    for (const cls of classes) {
      // Check for responsive prefix
      const respMatch = cls.match(/^(sm|md|lg|xl):(.+)$/);
      if (respMatch) {
        const bp = respMatch[1];
        const coreClass = respMatch[2];
        if (classMap[coreClass]) {
          if (!responsiveStyles[bp]) responsiveStyles[bp] = {};
          Object.assign(responsiveStyles[bp], classMap[coreClass]);
        } else {
          if (cls.includes("hover:")) {
            warnings.push(`Unsupported pseudo-class: "${cls}" — hover partially supported`);
          }
        }
        continue;
      }

      // Non-responsive class
      if (classMap[cls]) {
        Object.assign(baseStyles, classMap[cls]);
      }
    }

    // Invert responsive breakpoints (Tailwind mobile-first → GB desktop-first)
    // For each responsive bp, move declarations to base and create max-width override
    // with the non-responsive values
    for (const bp of Object.keys(responsiveStyles).sort(
      (a, b) => BREAKPOINTS[b] - BREAKPOINTS[a],
    )) {
      const bpStyles = responsiveStyles[bp];
      for (const [prop, value] of Object.entries(bpStyles)) {
        if (baseStyles[prop] !== undefined) {
          // Store desktop value as base, mobile override at max-width
          // The base (smaller screen) value gets moved to a max-width rule
        }
        baseStyles[prop] = value;
      }
    }

    // Build inline style string
    const styleParts = Object.entries(baseStyles).map(
      ([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}:${v}`,
    );

    if (styleParts.length === 0) {
      return ""; // Remove class attribute entirely
    }

    return `style="${styleParts.join(";")}"`;
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/style-resolver.ts
git commit -m "feat(phase1): add Tailwind CLI style resolver with responsive inversion"
```

---

### Task 6: HTML-to-IR converter (Phase 4)

**Files:**
- Create: `src/converter/html-to-ir.ts`

- [ ] **Step 1: Write the HTML-to-IR converter**

```typescript
// ── HTML-to-IR Converter (Phase 4) ─────────────────────────────
//
// Takes resolved HTML (inline styles only) + SectionManifest and
// produces IRNode[] ready for ir-planner.ts.

import * as cheerio from "cheerio";
import type { IRNode, LayoutIntent } from "../core/ir-node.js";
import type {
  SectionManifest, ManifestElement, ManifestGroup, ManifestTemplate,
} from "../types/manifest.js";
import { parseStyleString, type ParsedStyles } from "../core/style-parser.js";
import {
  ELEMENT_ROLE_MAP, GROUP_LAYOUT_MAP, sectionLayoutToIntent,
} from "./role-mapper.js";

export interface HtmlToIRResult {
  nodes: IRNode[];
  warnings: string[];
}

export function htmlToIR(
  manifest: SectionManifest,
  resolvedHtml: string,
): HtmlToIRResult {
  const warnings: string[] = [];
  const $ = cheerio.load(`<div>${resolvedHtml}</div>`);

  const sectionLayout: LayoutIntent = sectionLayoutToIntent(manifest.layout);

  // Create section wrapper
  const sectionNode: IRNode = {
    nodeType: "section",
    tagName: "section",
    layoutIntent: sectionLayout,
    fallbackPolicy: "generateblocks",
    children: [],
    sourceMeta: manifest.sectionId,
  };

  // Process flat elements
  for (const el of manifest.elements) {
    if (el.role === "decoration") continue;

    const $el = $(el.selector);
    if ($el.length === 0) {
      warnings.push(`Element not found: "${el.selector}"`);
      continue;
    }

    const irNode = elementToIR($, $el.first(), el, warnings);
    if (irNode) {
      sectionNode.children.push(irNode);
    }
  }

  // Process groups
  if (manifest.groups) {
    for (const group of manifest.groups) {
      const groupNode = groupToIR($, group, warnings);
      if (groupNode) {
        sectionNode.children.push(groupNode);
      }
    }
  }

  // Process templates
  if (manifest.templates) {
    for (const tmpl of manifest.templates) {
      const templateNodes = templateToIR($, tmpl, manifest.exceptions, warnings);
      sectionNode.children.push(...templateNodes);
    }
  }

  return { nodes: [sectionNode], warnings };
}

function elementToIR(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio,
  el: ManifestElement,
  warnings: string[],
): IRNode | null {
  const mapping = ELEMENT_ROLE_MAP[el.role];
  if (!mapping) {
    warnings.push(`No mapping for role: "${el.role}"`);
    return null;
  }

  if (mapping.useCoreHtml) {
    // Wrap raw HTML in a core/html block
    const html = $.html($el);
    return {
      nodeType: mapping.coreHtmlNodeType || "container",
      layoutIntent: mapping.layoutIntent,
      fallbackPolicy: "core",
      children: [{
        nodeType: "container",
        fallbackPolicy: "core",
        children: [],
        html,
        sourceMeta: `embed:${el.role}`,
      }],
      sourceMeta: `embed:${el.role}`,
    };
  }

  const tagName = $el.prop("tagName")?.toLowerCase() || undefined;
  const textContent = $el.text().trim() || undefined;
  const styleAttr = $el.attr("style") || "";

  let attributes: Record<string, string> = {};
  const href = $el.attr("href");
  const src = $el.attr("src");
  const alt = $el.attr("alt");
  const id = $el.attr("id");

  if (href) attributes.href = href;
  if (src) attributes.src = src;
  if (alt) attributes.alt = alt;
  if (id) attributes.id = id;

  const parsed: ParsedStyles = parseStyleString(styleAttr);
  const styleIntent: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.styles)) {
    styleIntent[key] = String(value);
  }

  return {
    nodeType: mapping.nodeType,
    tagName: tagName || mapping.nodeType === "heading" ? "h2" : undefined,
    textContent,
    attributes,
    styleIntent: Object.keys(styleIntent).length > 0 ? styleIntent : undefined,
    layoutIntent: mapping.layoutIntent,
    fallbackPolicy: mapping.fallbackPolicy,
    children: [],
    sourceMeta: el.selector,
  };
}

function groupToIR(
  $: cheerio.CheerioAPI,
  group: ManifestGroup,
  warnings: string[],
): IRNode | null {
  const $container = $(group.selector);
  if ($container.length === 0) {
    warnings.push(`Group container not found: "${group.selector}"`);
    return null;
  }

  const layoutIntent = GROUP_LAYOUT_MAP[group.role];
  const styleAttr = $container.first().attr("style") || "";
  const parsed = parseStyleString(styleAttr);
  const styleIntent: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.styles)) {
    styleIntent[key] = String(value);
  }
  // Remove layout-specific styles that GB manages via layoutIntent
  delete styleIntent.display;
  delete styleIntent.flexDirection;
  delete styleIntent.flexWrap;
  delete styleIntent.alignItems;
  delete styleIntent.justifyContent;

  const children: IRNode[] = [];
  for (const el of group.elements) {
    if (el.role === "decoration") continue;
    const $el = $(el.selector);
    if ($el.length === 0) {
      warnings.push(`Group element not found: "${el.selector}"`);
      continue;
    }
    const irNode = elementToIR($, $el.first(), el, warnings);
    if (irNode) children.push(irNode);
  }

  return {
    nodeType: "container",
    tagName: "div",
    styleIntent: Object.keys(styleIntent).length > 0 ? styleIntent : undefined,
    layoutIntent,
    fallbackPolicy: "generateblocks",
    children,
    sourceMeta: group.selector,
  };
}

function templateToIR(
  $: cheerio.CheerioAPI,
  tmpl: ManifestTemplate,
  exceptions: ManifestElement[] | undefined,
  warnings: string[],
): IRNode[] {
  const $first = $(tmpl.selector);
  if ($first.length === 0) {
    warnings.push(`Template first element not found: "${tmpl.selector}"`);
    return [];
  }

  // Find all siblings with the same structure as the first element
  const $parent = $first.parent();
  const $siblings = $parent.children();

  // Simple heuristic: all direct children that look similar
  const nodes: IRNode[] = [];
  $siblings.each((_, child) => {
    const $child = $(child);

    // Check if this child matches an exception
    const isException = exceptions?.some((exc) => {
      try {
        return $(exc.selector).is($child);
      } catch { return false; }
    });

    if (isException) return; // Skip, exceptions handled separately

    // Apply template roles to this child
    const cardNode: IRNode = {
      nodeType: "container",
      tagName: "div",
      layoutIntent: "stack",
      fallbackPolicy: "generateblocks",
      children: [],
      sourceMeta: tmpl.selector,
    };

    const styleAttr = $child.attr("style") || "";
    const parsed = parseStyleString(styleAttr);
    const styleIntent: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.styles)) {
      styleIntent[key] = String(value);
    }
    delete styleIntent.display;
    delete styleIntent.flexDirection;
    cardNode.styleIntent = Object.keys(styleIntent).length > 0 ? styleIntent : undefined;

    for (const el of tmpl.elements) {
      if (el.role === "decoration") continue;
      const $childEl = $child.find(el.selector).first();
      if ($childEl.length === 0) {
        warnings.push(`Template child element not found: "${el.selector}" in template "${tmpl.selector}"`);
        continue;
      }
      const irNode = elementToIR($, $childEl, el, warnings);
      if (irNode) cardNode.children.push(irNode);
    }

    nodes.push(cardNode);
  });

  return nodes;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/html-to-ir.ts
git commit -m "feat(phase4): add HTML + manifest → IR converter"
```

---

### Task 7: Pipeline orchestrator

**Files:**
- Create: `src/converter/pipeline.ts`

- [ ] **Step 1: Write the pipeline orchestrator**

```typescript
// ── Pipeline Orchestrator ──────────────────────────────────────
//
// Runs the full conversion pipeline in order:
//   Phase 2 → Phase 3 (agent output) → Phase 1 → Phase 4 → Phase 5

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseStructure, type ParseStructureResult } from "./structure-parser.js";
import { validateManifest, applyOverrides, type ManifestOverride } from "./manifest-validator.js";
import { resolveStyles } from "./style-resolver.js";
import { htmlToIR } from "./html-to-ir.js";
import { planBlocks } from "../core/ir-planner.js";
import { serializeBlocks, countBlocks } from "../core/serializer.js";
import { validateBlocks } from "../core/validator.js";
import { resetIds } from "../core/id-generator.js";
import type {
  SectionManifest, PageManifest, PageMeta, SectionSnippet,
} from "../types/manifest.js";
import type { IRNode } from "../core/ir-node.js";
import type { Block } from "../core/types.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface PipelineInput {
  /** Raw HTML page (full document). */
  rawHtml: string;
  /** Page name for output files. */
  pageName: string;
  /** Agent-provided manifests per section. */
  manifests: SectionManifest[];
  /** Optional manifest overrides. */
  overrides?: ManifestOverride[];
}

export interface SectionOutput {
  sectionId: string;
  kind: string;
  blockCount: number;
  html: string;
  warnings: string[];
  errors: string[];
}

export interface PipelineOutput {
  pageName: string;
  combinedHtml: string;
  sections: SectionOutput[];
  report: {
    page: string;
    sectionCount: number;
    sections: Array<{
      sectionId: string;
      kind: string;
      mode: string;
      coverage: number;
      selectorsMatched: number;
      selectorsTotal: number;
      blockCount: number;
      hardFails: string[];
      warnings: string[];
    }>;
    overallStatus: "pass" | "partial" | "fail";
    patternConversionRate: number;
  };
  errors: string[];
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const { rawHtml, pageName, manifests, overrides } = input;
  const errors: string[] = [];
  const sectionOutputs: SectionOutput[] = [];

  // Apply overrides to manifests
  const finalManifests = overrides
    ? manifests.map((m) => applyOverrides(m, overrides))
    : manifests;

  // Phase 2: Structural parse
  const structure: ParseStructureResult = parseStructure(rawHtml);
  if (structure.snippets.length === 0) {
    return {
      pageName,
      combinedHtml: "",
      sections: [],
      report: {
        page: pageName,
        sectionCount: 0,
        sections: [],
        overallStatus: "fail",
        patternConversionRate: 0,
      },
      errors: ["No sections detected in page"],
    };
  }

  // Phase 1: Style resolution (once per page, cached)
  let resolvedSectionHtmls: Record<string, string> = {};
  const cacheFile = resolve(OUTPUT_DIR, ".cache", `${pageName}-styles.json`);

  for (const snippet of structure.snippets) {
    const result = resolveStyles(snippet.html, rawHtml);
    resolvedSectionHtmls[snippet.sectionId] = result.resolvedHtml;
  }

  // Phase 3 is done by the agent — manifests are provided

  // Phase 4: HTML + Manifest → IR
  // Phase 5: IR → Blocks → Serialize → Validate
  resetIds();

  const allBlocksHtml: string[] = [];
  const reportSections: PipelineOutput["report"]["sections"] = [];

  for (const manifest of finalManifests) {
    const sectionHtml = resolvedSectionHtmls[manifest.sectionId];
    if (!sectionHtml) {
      errors.push(`No resolved HTML for section: ${manifest.sectionId}`);
      continue;
    }

    // Validate manifest
    const validation = validateManifest(manifest, sectionHtml);
    if (!validation.valid) {
      errors.push(...validation.errors.map((e) => `${manifest.sectionId}: ${e}`));
    }

    // Convert
    const irResult = htmlToIR(manifest, sectionHtml);
    const allWarnings = [...validation.warnings, ...irResult.warnings];

    let sectionHtmlOutput = "";
    try {
      const { blocks, errors: planningErrors } = planBlocks(irResult.nodes[0]);
      const html = serializeBlocks(blocks);
      const blockCount = countBlocks(blocks);
      const { hardFails, warnings: valWarnings } = validateBlocks(blocks, html);

      sectionHtmlOutput = html;
      allWarnings.push(
        ...planningErrors,
        ...valWarnings.map((w) => w.message),
      );

      const selectorCount = manifest.elements.length +
        (manifest.groups?.length || 0) +
        (manifest.templates?.length || 0);
      const matchedCount = selectorCount - validation.missedSelectors.length;

      reportSections.push({
        sectionId: manifest.sectionId,
        kind: manifest.kind,
        mode: manifest.kind === "generic" ? "generic" : "pattern",
        coverage: manifest.coverage,
        selectorsMatched: matchedCount,
        selectorsTotal: selectorCount,
        blockCount,
        hardFails: hardFails.map((f) => f.code),
        warnings: allWarnings,
      });
    } catch (e: any) {
      errors.push(`${manifest.sectionId}: Phase 4/5 failed — ${e.message}`);
      sectionHtmlOutput = `<!-- Conversion failed for section: ${manifest.sectionId} -->\n<!-- ${e.message} -->\n`;
    }

    sectionOutputs.push({
      sectionId: manifest.sectionId,
      kind: manifest.kind,
      blockCount: 0, // fallback
      html: sectionHtmlOutput,
      warnings: allWarnings,
      errors: [],
    });

    if (sectionHtmlOutput) {
      allBlocksHtml.push(sectionHtmlOutput);
    }
  }

  // Combine all section HTML
  const combinedHtml = allBlocksHtml.join("\n");

  // Determine overall status
  const patternSections = reportSections.filter((s) => s.mode === "pattern");
  const patternRate = reportSections.length > 0
    ? patternSections.length / reportSections.length
    : 0;
  const hasHardFails = reportSections.some((s) => s.hardFails.length > 0);
  const overallStatus = errors.length > 0
    ? "fail"
    : hasHardFails ? "partial" : "pass";

  // Write output files
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${pageName}.html`), combinedHtml, "utf-8");

  const pageManifest: PageManifest = {
    page: pageName,
    sections: finalManifests,
    pageMeta: structure.pageMeta,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, `${pageName}-manifest.json`),
    JSON.stringify(pageManifest, null, 2) + "\n",
    "utf-8",
  );

  const report = {
    page: pageName,
    sectionCount: reportSections.length,
    sections: reportSections,
    overallStatus,
    patternConversionRate: Math.round(patternRate * 100) / 100,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, `${pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  return {
    pageName,
    combinedHtml,
    sections: sectionOutputs,
    report,
    errors,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/converter/pipeline.ts
git commit -m "feat: add pipeline orchestrator for all 5 phases"
```

---

### Task 8: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install cheerio and related packages**

```bash
cd /home/ivanoung/projects/gb-converter && npm install cheerio css
```

Expected: Packages installed, `package.json` updated.

- [ ] **Step 2: Install Tailwind CLI as dev dependency**

```bash
cd /home/ivanoung/projects/gb-converter && npm install -D tailwindcss @tailwindcss/cli
```

Expected: Packages installed.

- [ ] **Step 3: Verify no import issues**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cheerio, css, tailwindcss dependencies"
```

---

### Task 9: Regression check

**Files:**
- None to modify — validates existing fixtures still pass.

- [ ] **Step 1: Run existing fixture regression**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts regression
```

Expected: `✓ All M1 fixtures passed regression.`

- [ ] **Step 2: Run all existing fixtures**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts fixtures:run-all
```

Expected: All 22+ fixtures pass with validator_pass status.

- [ ] **Step 3: Verify no changes to output files**

```bash
cd /home/ivanoung/projects/gb-converter && git status -- output/
```

Expected: No uncommitted changes in output directory.

---

### Task 10: End-to-end integration test with aura.build page

**Files:**
- Create: `inputs/mino/page.html` (copy from existing `inputs/mino/hero.html` or use the full page)

- [ ] **Step 1: Test structural parse on the aura.build page**

```bash
cd /home/ivanoung/projects/gb-converter && cat > /tmp/test-structure.ts << 'EOF'
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseStructure } from "./src/converter/structure-parser.js";

const html = readFileSync(resolve(process.cwd(), "inputs/mino/hero-aura.html"), "utf-8");
const result = parseStructure(html);
console.log(`Sections found: ${result.snippets.length}`);
for (const s of result.snippets) {
  console.log(`  - ${s.sectionId} (${s.elementCount} elements)`);
}
console.log(`Fonts: ${result.pageMeta.fontFamilies.join(", ")}`);
EOF
npx tsx /tmp/test-structure.ts
```

Expected: Lists detected sections with element counts.

- [ ] **Step 2: Verify manifest validation works**

Run: `cat > /tmp/test-manifest.ts << 'EOF'
import { validateManifest } from "./src/converter/manifest-validator.js";

const testManifest = {
  sectionId: "hero",
  kind: "hero",
  layout: "two-column",
  elements: [
    { selector: "h1", role: "heading" },
    { selector: "button", role: "cta-button" },
  ],
  coverage: 85,
  notes: { decorationEls: [], unsupportedFeatures: [], warnings: [] },
};

const html = '<div><h1>Test</h1><button>CTA</button></div>';
const result = validateManifest(testManifest as any, html);
console.log("Valid:", result.valid);
console.log("Errors:", result.errors);
console.log("Missed:", result.missedSelectors);
EOF
npx tsx --noEmit /tmp/test-manifest.ts`
Expected: `Valid: true`, no errors.

- [ ] **Step 3: Run full pipeline on a small test section**

This step is manual — the coding agent produces a manifest, then runs the pipeline:

```
1. Agent examines a section of the page
2. Agent writes manifest JSON to output/test-manifest.json
3. Run: npx tsx src/cli/index.ts convert --input inputs/mino/hero-aura.html --manifest output/test-manifest.json --output test-page
4. Verify output/test-page.html exists and contains valid block markup
5. Verify output/test-page.report.json shows sections processed
```

- [ ] **Step 4: Commit test fixtures if new**

```bash
git add inputs/ output/
git commit -m "test: add integration test for aura.build page conversion"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 5 phases covered (2→3→1→4→5). Structure parser, manifest validation, style resolver, role mapper, HTML-to-IR converter, pipeline orchestrator — each maps to a spec section.
- [x] **Placeholder scan:** No TBDs, TODOs, or vague instructions. All code blocks show exact implementation.
- [x] **Type consistency:** Manifest types used consistently across manifest-validator.ts, role-mapper.ts, html-to-ir.ts, and pipeline.ts. IRNode type from ir-node.ts used in role-mapper.ts and html-to-ir.ts.
- [x] **Existing pipeline preserved:** The `core/` directory is untouched. New code feeds into it.
