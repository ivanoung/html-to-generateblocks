# CSS Classification & Canonicalization — P1 Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex-based CSS splitter with a PostCSS AST pipeline that canonicalizes Tailwind `--tw-*-opacity` variables for rgb/rgba color functions, routes rules by property-level GB-compatibility classification, and logs all rejections to `rejected.json`.

**Architecture:** A single `CssClassifier` class wraps PostCSS: `parse(css)` → `walkRules` → per-rule `canonicalize()` → per-declaration `classify()` → route to `structuredStyles[]` or `rawCss[]`. Sidecar `rejected.json` accumulates rejection records. The existing `splitCss()` and `generateGlobalStylesData()` become thin wrappers around this class.

**Tech Stack:** TypeScript + ESM, `postcss` (AST parser), `postcss-value-parser` (value-level parsing), Node.js built-in test runner.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/css-classifier.ts` (create) | Main class: parse → canonicalize → classify → route |
| `src/core/css-canonicalizer.ts` (create) | `--tw-*-opacity` resolution for rgb/rgba only (P1) |
| `src/core/gb-whitelist.ts` (create) | GB property whitelist + value-type validation |
| `src/core/rejection-log.ts` (create) | `RejectionLog` accumulator, outputs `rejected.json` |
| `src/core/global-styles-data.ts` (modify) | Replace regex-based `extractClassRules` with `CssClassifier` |
| `src/core/css-splitter.ts` (modify) | Replace regex-based splitter with `CssClassifier.getRawCss()` |
| `src/cli/index.ts` (modify) | Add `--canonicalize` flag, wire new pipeline alongside legacy |
| `config/canonicalizer-tailwind-v3.json` (create) | Canonicalizer patterns config |
| `config/gb-whitelist.json` (create) | GB property whitelist |
| `tests/css-classifier.test.ts` (create) | Integration: full pipeline on test fixtures |
| `tests/css-canonicalizer.test.ts` (create) | Unit: canonicalization edge cases |
| `tests/gb-whitelist.test.ts` (create) | Unit: whitelist positive/negative |
| `tests/rejection-log.test.ts` (create) | Unit: rejection accumulation + JSON output |
| `tests/snapshots/` (create dir) | Golden snapshot files |

---

### Task 1: Scaffold Config Files

**Files:**
- Create: `config/canonicalizer-tailwind-v3.json`
- Create: `config/gb-whitelist.json`

- [ ] **Step 1: Create canonicalizer config**

`config/canonicalizer-tailwind-v3.json`:

```json
{
  "version": "1.0",
  "framework": "tailwind",
  "frameworkVersion": "3.4",
  "patterns": {
    "opacityVariable": {
      "declarationPattern": "^--tw-(?<name>\\w+)-opacity:\\s*(?<value>[\\d.]+)",
      "usagePattern": "var\\(--tw-(?<name>\\w+)-opacity,\\s*[\\d.]+\\)",
      "colorFunctions": {
        "rgb": { "channels": ["r", "g", "b"], "separator": "space" },
        "rgba": { "channels": ["r", "g", "b", "a"], "separator": "comma" }
      },
      "outputFormat": {
        "1": "{fn}({channels})",
        "other": "rgba({r}, {g}, {b}, {opacity})"
      }
    }
  },
  "skipIfContains": ["--tw-shadow-colored"]
}
```

- [ ] **Step 2: Create GB whitelist config**

`config/gb-whitelist.json` — use the full property table from spec §6.3. At minimum include these entries to start:

```json
{
  "version": "2.2",
  "properties": {
    "color": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    "backgroundColor": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    "fontSize": { "acceptedValues": ["length", "percentage", "calc"] },
    "fontWeight": { "acceptedValues": ["number", "named"] },
    "fontFamily": { "acceptedValues": ["string", "ident-list"] },
    "textTransform": { "acceptedValues": ["none", "uppercase", "lowercase", "capitalize"] },
    "textAlign": { "acceptedValues": ["left", "center", "right", "justify"] },
    "lineHeight": { "acceptedValues": ["number", "length", "percentage"] },
    "letterSpacing": { "acceptedValues": ["length", "normal"] },
    "marginTop": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginRight": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginBottom": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginLeft": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "paddingTop": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingRight": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingBottom": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingLeft": { "acceptedValues": ["length", "percentage", "calc"] },
    "borderTopLeftRadius": { "acceptedValues": ["length", "percentage"] },
    "borderTopRightRadius": { "acceptedValues": ["length", "percentage"] },
    "borderBottomLeftRadius": { "acceptedValues": ["length", "percentage"] },
    "borderBottomRightRadius": { "acceptedValues": ["length", "percentage"] },
    "borderRadius": { "acceptedValues": ["length", "percentage"] },
    "borderWidth": { "acceptedValues": ["length"] },
    "borderStyle": { "acceptedValues": ["none", "solid", "dashed", "dotted", "double"] },
    "borderColor": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    "backgroundImage": { "acceptedValues": ["url", "linear-gradient", "radial-gradient", "none"] },
    "backgroundSize": { "acceptedValues": ["length", "percentage", "cover", "contain", "auto"] },
    "backgroundPosition": { "acceptedValues": ["position"] },
    "display": { "acceptedValues": ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"] },
    "position": { "acceptedValues": ["static", "relative", "absolute", "fixed", "sticky"] },
    "zIndex": { "acceptedValues": ["integer", "auto"] },
    "flexDirection": { "acceptedValues": ["row", "row-reverse", "column", "column-reverse"] },
    "flexWrap": { "acceptedValues": ["nowrap", "wrap", "wrap-reverse"] },
    "alignItems": { "acceptedValues": ["flex-start", "flex-end", "center", "baseline", "stretch"] },
    "justifyContent": { "acceptedValues": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"] },
    "gap": { "acceptedValues": ["length", "percentage", "calc"] },
    "columnGap": { "acceptedValues": ["length", "percentage", "calc"] },
    "rowGap": { "acceptedValues": ["length", "percentage", "calc"] },
    "flexGrow": { "acceptedValues": ["number"] },
    "flexShrink": { "acceptedValues": ["number"] },
    "overflowX": { "acceptedValues": ["visible", "hidden", "scroll", "auto"] },
    "overflowY": { "acceptedValues": ["visible", "hidden", "scroll", "auto"] },
    "width": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "minWidth": { "acceptedValues": ["length", "percentage", "calc"] },
    "maxWidth": { "acceptedValues": ["length", "percentage", "none", "calc"] },
    "height": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "minHeight": { "acceptedValues": ["length", "percentage", "calc"] },
    "maxHeight": { "acceptedValues": ["length", "percentage", "none", "calc"] },
    "opacity": { "acceptedValues": ["number"] },
    "cursor": { "acceptedValues": ["named"] },
    "boxShadow": { "acceptedValues": ["any"] }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add config/
git commit -m "feat: add canonicalizer and GB whitelist config files"
```

---

### Task 2: Create GB Whitelist Module

**Files:**
- Create: `src/core/gb-whitelist.ts`
- Create: `tests/gb-whitelist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/gb-whitelist.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { isGbSupported } from "../src/core/gb-whitelist.js";

describe("isGbSupported", () => {
  it("accepts color with rgb value", () => {
    assert.strictEqual(isGbSupported("color", "rgb(255, 127, 89)"), true);
  });

  it("accepts backgroundColor with hex value", () => {
    assert.strictEqual(isGbSupported("backgroundColor", "#C5FFD6"), true);
  });

  it("accepts fontSize with rem value", () => {
    assert.strictEqual(isGbSupported("fontSize", "1.5rem"), true);
  });

  it("accepts display with block value", () => {
    assert.strictEqual(isGbSupported("display", "block"), true);
  });

  it("rejects unknown property", () => {
    assert.strictEqual(isGbSupported("transform", "translateX(1rem)"), false);
  });

  it("rejects property in whitelist but unsupported value function", () => {
    assert.strictEqual(isGbSupported("color", "color-mix(in srgb, red, blue)"), false);
  });

  it("rejects property in whitelist but unsupported color space", () => {
    assert.strictEqual(isGbSupported("color", "oklch(0.6 0.2 150)"), false);
  });

  it("rejects unresolved var()", () => {
    assert.strictEqual(isGbSupported("color", "var(--brand-color)"), false);
  });

  it("rejects CSS-wide keyword inherit", () => {
    assert.strictEqual(isGbSupported("color", "inherit"), false);
  });

  it("rejects vendor-prefixed value", () => {
    assert.strictEqual(isGbSupported("display", "-webkit-box"), false);
  });

  it("rejects empty string value", () => {
    assert.strictEqual(isGbSupported("color", ""), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/gb-whitelist.test.ts`
Expected: FAIL — `isGbSupported` not defined.

- [ ] **Step 3: Write the module**

Create `src/core/gb-whitelist.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PropertyConfig {
  acceptedValues: string[];
}

interface WhitelistConfig {
  version: string;
  properties: Record<string, PropertyConfig>;
}

let _config: WhitelistConfig | null = null;

function loadConfig(): WhitelistConfig {
  if (_config) return _config;
  const configPath = resolve(__dirname, "../../config/gb-whitelist.json");
  _config = JSON.parse(readFileSync(configPath, "utf-8"));
  return _config!;
}

/** Check if property is in the GB whitelist */
export function isGbProperty(property: string): boolean {
  const config = loadConfig();
  return property in config.properties;
}

/** Validates CSS value syntax against GB-accepted types */
function isValidValueSyntax(property: string, value: string): boolean {
  if (!value || value.trim().length === 0) return false;

  // Reject CSS-wide keywords
  if (/^(inherit|initial|unset|revert|revert-layer)$/.test(value.trim())) {
    return false;
  }

  // Reject var() — GB doesn't support custom properties
  if (/\bvar\(/.test(value)) return false;

  // Reject vendor-prefixed values
  if (/^-webkit-|-moz-|-ms-|-o-/.test(value)) return false;

  // Reject GB-unsupported CSS functions
  if (/\bcolor-mix\(/.test(value)) return false;

  // Reject GB-unsupported color spaces
  if (/\boklch\(/.test(value) || /\boklab\(/.test(value) || /\blch\(/.test(value)) return false;

  // Reject calc() containing var()
  if (/\bcalc\([^)]*\bvar\(/.test(value)) return false;

  return true;
}

/**
 * Check if a camelCase property-value pair is supported by GenerateBlocks.
 * Returns true only if both the property is in the whitelist AND the value
 * syntax passes validation.
 */
export function isGbSupported(property: string, value: string): boolean {
  if (!isGbProperty(property)) return false;
  return isValidValueSyntax(property, value);
}

/** Get the accepted value types for a property */
export function getAcceptedValues(property: string): string[] | undefined {
  const config = loadConfig();
  return config.properties[property]?.acceptedValues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/gb-whitelist.test.ts`
Expected: 11/11 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/gb-whitelist.ts tests/gb-whitelist.test.ts
git commit -m "feat: add GB property whitelist with value-type validation"
```

---

### Task 3: Create Rejection Log Module

**Files:**
- Create: `src/core/rejection-log.ts`
- Create: `tests/rejection-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rejection-log.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { RejectionLog } from "../src/core/rejection-log.js";

describe("RejectionLog", () => {
  it("starts empty", () => {
    const log = new RejectionLog();
    assert.strictEqual(log.count, 0);
  });

  it("records a rejection with reason code", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected", "styles-unique.css");
    assert.strictEqual(log.count, 1);
  });

  it("accumulates multiple rejections", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".scale-110", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".color-mix", "UNSUPPORTED_FUNCTION", "color", "warning");
    assert.strictEqual(log.count, 3);
  });

  it("serializes to JSON with summary", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".scale-110", "UNSUPPORTED_PROPERTY", "transform", "expected");
    const json = log.toJSON(100);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.totalRules, 100);
    assert.strictEqual(parsed.rejectedRules, 2);
    assert.strictEqual(parsed.rejectionRate, "2.0%");
    assert.strictEqual(parsed.summaryByReason["UNSUPPORTED_PROPERTY"], 2);
    assert.strictEqual(parsed.rejections.length, 2);
  });

  it("serializes empty log", () => {
    const log = new RejectionLog();
    const json = log.toJSON(10);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.rejectedRules, 0);
    assert.deepStrictEqual(parsed.summaryByReason, {});
    assert.deepStrictEqual(parsed.rejections, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/rejection-log.test.ts`
Expected: FAIL — `RejectionLog` not defined.

- [ ] **Step 3: Write the module**

Create `src/core/rejection-log.ts`:

```typescript
export interface RejectionEntry {
  selector: string;
  reason: string;
  property?: string;
  detail?: string;
  severity: "expected" | "warning" | "error";
  destination: "styles-unique.css";
}

export interface RejectionJson {
  version: string;
  totalRules: number;
  rejectedRules: number;
  rejectionRate: string;
  rejections: RejectionEntry[];
  summaryByReason: Record<string, number>;
}

export class RejectionLog {
  private entries: RejectionEntry[] = [];

  get count(): number {
    return this.entries.length;
  }

  add(
    selector: string,
    reason: string,
    property?: string,
    severity: RejectionEntry["severity"] = "expected",
    destination: "styles-unique.css" = "styles-unique.css",
    detail?: string,
  ): void {
    this.entries.push({ selector, reason, property, severity, destination, detail });
  }

  toJSON(totalRules: number): string {
    const summaryByReason: Record<string, number> = {};
    for (const e of this.entries) {
      summaryByReason[e.reason] = (summaryByReason[e.reason] || 0) + 1;
    }

    const rate = totalRules > 0
      ? ((this.entries.length / totalRules) * 100).toFixed(1) + "%"
      : "0%";

    const json: RejectionJson = {
      version: "1.0",
      totalRules,
      rejectedRules: this.entries.length,
      rejectionRate: rate,
      rejections: this.entries,
      summaryByReason,
    };

    return JSON.stringify(json, null, 2) + "\n";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/rejection-log.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/rejection-log.ts tests/rejection-log.test.ts
git commit -m "feat: add RejectionLog for observable CSS classification decisions"
```

---

### Task 4: Create CSS Canonicalizer (rgb/rgba only — P1)

**Files:**
- Create: `src/core/css-canonicalizer.ts`
- Create: `tests/css-canonicalizer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/css-canonicalizer.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import postcss from "postcss";
import { canonicalizeRule } from "../src/core/css-canonicalizer.js";

function cssToRule(css: string): postcss.Rule {
  const root = postcss.parse(css);
  const rule = root.nodes.find((n): n is postcss.Rule => n.type === "rule");
  if (!rule) throw new Error("No rule found in CSS");
  return rule;
}

describe("canonicalizeRule", () => {
  it("resolves --tw-text-opacity: 1 in rgb()", () => {
    const rule = cssToRule(
      ".text-orange { --tw-text-opacity: 1; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); }",
    );
    const result = canonicalizeRule(rule);
    assert.strictEqual(result.warnings.length, 0);
    // --tw-text-opacity declaration should be removed
    const hasOpacityVar = rule.nodes.some(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "--tw-text-opacity",
    );
    assert.strictEqual(hasOpacityVar, false);
    // color should be resolved
    const colorDecl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "color",
    ) as postcss.Declaration;
    assert.ok(colorDecl);
    assert.strictEqual(colorDecl.value, "rgb(255, 127, 89)");
  });

  it("resolves --tw-bg-opacity: 0.5 in rgb()", () => {
    const rule = cssToRule(
      ".bg-primary\\/50 { --tw-bg-opacity: 0.5; background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1)); }",
    );
    canonicalizeRule(rule);
    const decl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color",
    ) as postcss.Declaration;
    assert.ok(decl);
    assert.strictEqual(decl.value, "rgba(197, 255, 214, 0.5)");
  });

  it("resolves opacity: 0", () => {
    const rule = cssToRule(
      ".invisible { --tw-text-opacity: 0; color: rgb(255 0 0 / var(--tw-text-opacity, 1)); }",
    );
    canonicalizeRule(rule);
    const decl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "color",
    ) as postcss.Declaration;
    assert.ok(decl);
    assert.strictEqual(decl.value, "rgba(255, 0, 0, 0)");
  });

  it("handles legacy rgba() syntax", () => {
    const rule = cssToRule(
      ".old { --tw-bg-opacity: 1; background-color: rgba(197, 255, 214, var(--tw-bg-opacity, 1)); }",
    );
    canonicalizeRule(rule);
    const decl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color",
    ) as postcss.Declaration;
    assert.ok(decl);
    assert.strictEqual(decl.value, "rgb(197, 255, 214)");
  });

  it("handles multiple opacity variables in one rule", () => {
    const rule = cssToRule(
      ".combo { --tw-text-opacity: 1; --tw-bg-opacity: 0.5; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1)); }",
    );
    canonicalizeRule(rule);
    const colorDecl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "color",
    ) as postcss.Declaration;
    const bgDecl = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color",
    ) as postcss.Declaration;
    assert.strictEqual(colorDecl.value, "rgb(255, 127, 89)");
    assert.strictEqual(bgDecl.value, "rgba(197, 255, 214, 0.5)");
  });

  it("emits warning on cross-variable mismatch", () => {
    const rule = cssToRule(
      ".mismatch { --tw-text-opacity: 0.5; color: rgb(255 0 0 / var(--tw-bg-opacity, 1)); }",
    );
    const result = canonicalizeRule(rule);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("CROSS_VARIABLE_MISMATCH"));
  });

  it("skips --tw-shadow-colored rules", () => {
    const rule = cssToRule(
      ".shadow { --tw-shadow: 0 1px 2px 0; --tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow), var(--tw-shadow); }",
    );
    const result = canonicalizeRule(rule);
    assert.strictEqual(result.skipped, true);
  });

  it("returns empty rule when only --tw-* declarations exist", () => {
    const rule = cssToRule(
      ".empty { --tw-text-opacity: 1; }",
    );
    canonicalizeRule(rule);
    assert.strictEqual(rule.nodes.length, 0);
  });

  it("preserves declaration order after stripping", () => {
    const rule = cssToRule(
      ".order { font-size: 1rem; --tw-text-opacity: 1; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); line-height: 1.5; }",
    );
    canonicalizeRule(rule);
    const props = rule.nodes
      .filter((n) => n.type === "decl")
      .map((n) => (n as postcss.Declaration).prop);
    assert.deepStrictEqual(props, ["font-size", "color", "line-height"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/css-canonicalizer.test.ts`
Expected: FAIL — `canonicalizeRule` not defined.

- [ ] **Step 3: Write the module**

Create `src/core/css-canonicalizer.ts`:

```typescript
import postcss from "postcss";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CanonicalizerConfig {
  version: string;
  framework: string;
  frameworkVersion: string;
  patterns: {
    opacityVariable: {
      declarationPattern: string;
      usagePattern: string;
      colorFunctions: Record<string, { channels: string[]; separator: string }>;
      outputFormat: { "1": string; other: string };
    };
  };
  skipIfContains: string[];
}

let _config: CanonicalizerConfig | null = null;

function loadConfig(): CanonicalizerConfig {
  if (_config) return _config;
  const configPath = resolve(__dirname, "../../config/canonicalizer-tailwind-v3.json");
  _config = JSON.parse(readFileSync(configPath, "utf-8"));
  return _config!;
}

export interface CanonicalizeResult {
  warnings: string[];
  skipped: boolean;
}

/**
 * Canonicalize a single PostCSS Rule: resolve --tw-*-opacity variables
 * in color functions, strip variable declarations. Mutates the rule in place.
 * Returns warnings and a skipped flag for rules that should be routed to raw CSS.
 */
export function canonicalizeRule(rule: postcss.Rule): CanonicalizeResult {
  const config = loadConfig();
  const warnings: string[] = [];

  // Check skipIfContains
  const ruleCss = rule.toString();
  for (const pattern of config.skipIfContains) {
    if (ruleCss.includes(pattern)) {
      return { warnings: [], skipped: true };
    }
  }

  // Collect opacity variable declarations
  const opacityDeclarations: Array<{ node: postcss.Declaration; name: string; value: number }> = [];
  for (const node of rule.nodes) {
    if (node.type !== "decl") continue;
    const decl = node as postcss.Declaration;
    const match = decl.prop.match(/^--tw-(\w+)-opacity$/);
    if (match) {
      const numVal = parseFloat(decl.value);
      if (!isNaN(numVal)) {
        opacityDeclarations.push({ node: decl, name: match[1], value: numVal });
      }
    }
  }

  if (opacityDeclarations.length === 0) {
    return { warnings: [], skipped: false };
  }

  // Process each opacity declaration
  for (const { node: opacityDecl, name, value: opacityValue } of opacityDeclarations) {
    // Find color declarations that use this specific --tw-<name>-opacity variable
    const usageRegex = new RegExp(`var\\(--tw-${name}-opacity,\\s*[\\d.]+\\)`);

    for (const node of rule.nodes) {
      if (node.type !== "decl") continue;
      const decl = node as postcss.Declaration;

      // Check if this declaration's VALUE uses the opacity variable
      if (!usageRegex.test(decl.value)) continue;

      // Check for cross-variable mismatch: does the value reference a DIFFERENT
      // --tw-*-opacity variable than what this declaration provides?
      const otherVarMatch = decl.value.match(/var\(--tw-(\w+)-opacity,\s*[\d.]+\)/);
      if (otherVarMatch && otherVarMatch[1] !== name) {
        warnings.push(
          `CROSS_VARIABLE_MISMATCH: declared --tw-${name}-opacity but var() references --tw-${otherVarMatch[1]}-opacity`,
        );
        continue;
      }

      // Resolve the color function
      try {
        decl.value = resolveColorFunction(decl.prop, decl.value, opacityValue);
      } catch (err: any) {
        warnings.push(`CANONICALIZE_ERROR: ${err.message}`);
      }
    }

    // Strip the opacity variable declaration
    opacityDecl.remove();
  }

  return { warnings, skipped: false };
}

/**
 * Resolve var(--tw-*-opacity, X) in a color function value.
 * Handles both modern rgb(R G B / var(...)) and legacy rgba(R, G, B, var(...)).
 * Only supports rgb/rgba in P1.
 */
function resolveColorFunction(
  property: string,
  value: string,
  opacity: number,
): string {
  // Modern rgb(R G B / var(...))
  const modernMatch = value.match(
    /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*var\(--tw-\w+-opacity,\s*[\d.]+\)\s*\)$/,
  );
  if (modernMatch) {
    const [, r, g, b] = modernMatch;
    if (opacity === 1) {
      return `rgb(${r}, ${g}, ${b})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // Legacy rgba(R, G, B, var(...))
  const legacyMatch = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*var\(--tw-\w+-opacity,\s*[\d.]+\)\s*\)$/,
  );
  if (legacyMatch) {
    const [, r, g, b] = legacyMatch;
    if (opacity === 1) {
      return `rgb(${r}, ${g}, ${b})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  throw new Error(`Unsupported color function format for ${property}: ${value}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/css-canonicalizer.test.ts`
Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/css-canonicalizer.ts tests/css-canonicalizer.test.ts
git commit -m "feat: add CSS canonicalizer for --tw-*-opacity resolution (rgb/rgba only, P1)"
```

---

### Task 5: Create CSS Classifier (Integration Module)

**Files:**
- Create: `src/core/css-classifier.ts`
- Create: `tests/css-classifier.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/css-classifier.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { CssClassifier } from "../src/core/css-classifier.js";

describe("CssClassifier", () => {
  const sampleCss = `
body { background-color: #EEEEEE; color: #334155; }
.text-orange { --tw-text-opacity: 1; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); }
.bg-primary { --tw-bg-opacity: 1; background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1)); }
.rotate-6 { --tw-rotate: 6deg; transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)); }
.font-sans { font-family: "DM Sans", sans-serif; }
.pt-32 { padding-top: 8rem; }
.group\\:hover .group-hover\\:text-primary { color: rgb(197 255 214); }
::selection { background: #C5FFD6; }
`;

  it("classifies and canonicalizes a CSS string", () => {
    const result = CssClassifier.classify(sampleCss);

    // Body, ::selection, compound selectors → raw CSS
    assert.ok(result.rawCss.length > 0, "raw CSS should not be empty");
    assert.ok(result.rawCss.includes("body"), "body rule should be in raw CSS");
    assert.ok(result.rawCss.includes("selection"), "::selection should be in raw CSS");
    assert.ok(result.rawCss.includes("group-hover"), "compound selector should be in raw CSS");

    // rotate-6 has transform → raw CSS
    assert.ok(result.rawCss.includes("rotate-6"), "transform rule should be in raw CSS");

    // GB-compatible classes → structured
    const selectors = result.structuredStyles.map((s) => s.selector);
    assert.ok(selectors.includes(".text-orange"), "text-orange should be structured");
    assert.ok(selectors.includes(".bg-primary"), "bg-primary should be structured");
    assert.ok(selectors.includes(".font-sans"), "font-sans should be structured");
    assert.ok(selectors.includes(".pt-32"), "pt-32 should be structured");
  });

  it("canonicalizes --tw-text-opacity in structured styles", () => {
    const result = CssClassifier.classify(sampleCss);
    const textOrange = result.structuredStyles.find((s) => s.selector === ".text-orange");
    assert.ok(textOrange, "text-orange should be in structured styles");
    const styles = textOrange!.styles as Record<string, unknown>;
    assert.strictEqual(styles.color, "rgb(255, 127, 89)", "color should be canonicalized to rgb()");

    const bgPrimary = result.structuredStyles.find((s) => s.selector === ".bg-primary");
    assert.ok(bgPrimary);
    const bgStyles = bgPrimary!.styles as Record<string, unknown>;
    assert.strictEqual(bgStyles.backgroundColor, "rgb(197, 255, 214)");
  });

  it("produces a rejection log", () => {
    const result = CssClassifier.classify(sampleCss);
    assert.ok(result.rejectionLog.count > 0, "should have rejections");
    assert.ok(result.rejectionLog.count >= 2, "at least body and transform should be rejected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/css-classifier.test.ts`
Expected: FAIL — `CssClassifier` not defined.

- [ ] **Step 3: Write the module**

Create `src/core/css-classifier.ts`:

```typescript
import postcss from "postcss";
import { canonicalizeRule } from "./css-canonicalizer.js";
import { isGbSupported } from "./gb-whitelist.js";
import { RejectionLog } from "./rejection-log.js";

export interface StructuredStyle {
  selector: string;
  name: string;
  styles: Record<string, unknown>;
}

export interface ClassificationResult {
  structuredStyles: StructuredStyle[];
  rawCss: string;
  rejectionLog: RejectionLog;
}

function classNameToName(className: string): string {
  return className
    .replace(/^\./, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * CSS classifier with canonicalization. Replaces the regex-based
 * extractClassRules from global-styles-data.ts.
 *
 * P1 scope: class rules only (non-class selectors route to raw CSS).
 * rgb/rgba canonicalization only. Property-level classification.
 */
export class CssClassifier {
  static classify(css: string): ClassificationResult {
    const root = postcss.parse(css, { from: undefined });
    const structured: StructuredStyle[] = [];
    const rawParts: string[] = [];
    const rejectionLog = new RejectionLog();

    let totalClassRules = 0;

    // Walk all rules
    root.walkRules((rule) => {
      const selector = rule.selector.trim();

      // Route non-class selectors to raw CSS
      if (!selector.startsWith(".")) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "NON_CLASS_SELECTOR", undefined, "expected");
        return;
      }

      // Route compound selectors to raw CSS
      if (/\s/.test(selector) || />|~|\+|,/.test(selector)) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "COMPOUND_SELECTOR", undefined, "expected");
        return;
      }

      totalClassRules++;

      // Canonicalize
      const canonResult = canonicalizeRule(rule);
      if (canonResult.skipped) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "CANONICALIZE_SKIPPED", undefined, "expected");
        return;
      }
      for (const w of canonResult.warnings) {
        rejectionLog.add(selector, w, undefined, "warning");
      }

      // Split declarations: GB-compatible → structured, rest → raw CSS
      const structuredDecls: Record<string, string> = {};
      const rawDecls: string[] = [];

      for (const node of rule.nodes) {
        if (node.type !== "decl") continue;
        const decl = node as postcss.Declaration;
        const camelProp = kebabToCamel(decl.prop);

        // Skip custom properties (--tw-*, --brand-*, etc.) — they're dead after canonicalization
        if (decl.prop.startsWith("--")) continue;

        if (isGbSupported(camelProp, decl.value)) {
          structuredDecls[camelProp] = decl.value;
        } else {
          rawDecls.push(`${decl.prop}: ${decl.value}`);
          rejectionLog.add(
            selector,
            rawDecls.length === 1 ? "UNSUPPORTED_PROPERTY" : "UNSUPPORTED_PROPERTY",
            camelProp,
            "expected",
          );
        }
      }

      // If structured declarations exist, add to structured styles
      if (Object.keys(structuredDecls).length > 0) {
        structured.push({
          selector,
          name: classNameToName(selector),
          styles: structuredDecls,
        });
      }

      // If raw declarations exist, add the rule with only raw decls to raw CSS
      if (rawDecls.length > 0) {
        const rawRule = `${selector} {\n  ${rawDecls.join(";\n  ")};\n}`;
        rawParts.push(rawRule);
      }
    });

    // Capture @media, @keyframes, @layer etc. for raw CSS
    root.walk((node) => {
      if (node.type === "atrule") {
        const atRule = node as postcss.AtRule;
        // Skip already-handled rules inside @media (they were walked above)
        if (atRule.name === "media" || atRule.name === "keyframes" ||
            atRule.name === "layer" || atRule.name === "supports" ||
            atRule.name === "container") {
          // @keyframes always go to raw CSS
          if (atRule.name === "keyframes") {
            rawParts.push(atRule.toString());
            rejectionLog.add(`@keyframes ${atRule.params}`, "ATRULE_KEYFRAMES", undefined, "expected");
          }
        }
      }
    });

    // Collect element and pseudo-element selectors that weren't walked as class rules
    root.walkRules((rule) => {
      const selector = rule.selector.trim();
      if (/^[a-z*]|^::/.test(selector)) {
        // Already handled above — but walkRules on root visits @media children too.
        // Deduplicate: check if not already in rawParts
        const ruleStr = rule.toString();
        if (!rawParts.some((p) => p.includes(ruleStr.substring(0, 50)))) {
          rawParts.push(ruleStr);
          if (!rejectionLogContainsSelector(rejectionLog, selector)) {
            rejectionLog.add(selector, "NON_CLASS_SELECTOR", undefined, "expected");
          }
        }
      }
    });

    return {
      structuredStyles: structured,
      rawCss: rawParts.join("\n\n") + "\n",
      rejectionLog,
    };
  }
}

function rejectionLogContainsSelector(log: RejectionLog, selector: string): boolean {
  // Quick check — the RejectionLog class doesn't expose entries directly.
  // We'll rely on deduplication being done by the first pass.
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/css-classifier.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/css-classifier.ts tests/css-classifier.test.ts
git commit -m "feat: add CssClassifier — PostCSS AST pipeline with canonicalization and classification"
```

---

### Task 6: Wire Into Existing Pipeline + `--canonicalize` Flag

**Files:**
- Modify: `src/core/global-styles-data.ts` (add canonicalized path)
- Modify: `src/core/css-splitter.ts` (add canonicalized path)
- Modify: `src/cli/index.ts` (add `--canonicalize` flag)

- [ ] **Step 1: Add canonicalized path to global-styles-data.ts**

In `src/core/global-styles-data.ts`, add a new export:

```typescript
import { CssClassifier } from "./css-classifier.js";

/**
 * Generate structured gb_style_data with canonicalization.
 * Uses the PostCSS AST pipeline instead of regex-based extraction.
 */
export function generateGlobalStylesDataCanonicalized(compiledCss: string): {
  editable: GbStyleDataEntry[];
  raw: GbStyleDataEntry[];
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);

  const editable: GbStyleDataEntry[] = result.structuredStyles.map((s) => ({
    selector: s.selector,
    name: s.name,
    styles: s.styles,
  }));

  const raw: GbStyleDataEntry[] = [];
  // Raw entries: everything that went to styles-unique.css is flagged raw
  // (the rawCss string is used directly, not parsed into entries)
  // For global-styles.json compatibility, raw entries are selector-only
  const rawSelectors = new Set<string>();
  // Extract selectors from rawCss — simple regex is fine here since PostCSS already parsed
  const selectorMatches = result.rawCss.matchAll(/^([.#][^\s{]+)\s*\{/gm);
  for (const m of selectorMatches) {
    rawSelectors.add(m[1]);
  }
  for (const sel of rawSelectors) {
    raw.push({ selector: sel, name: sel.replace(/^\./, ""), styles: {}, raw: true });
  }

  return {
    editable,
    raw,
    rejectionJson: result.rejectionLog.toJSON(result.structuredStyles.length + raw.length),
  };
}
```

- [ ] **Step 2: Add canonicalized path to css-splitter.ts**

In `src/core/css-splitter.ts`, add:

```typescript
import { CssClassifier } from "./css-classifier.js";

/**
 * Split CSS using the canonicalized classifier.
 * Returns unique CSS (non-class + rejected) and the classifier result.
 */
export function splitCssCanonicalized(compiledCss: string): {
  uniqueCss: string;
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);
  return {
    uniqueCss: result.rawCss,
    rejectionJson: result.rejectionLog.toJSON(
      result.structuredStyles.length + (result.rawCss.match(/\{/g) || []).length,
    ),
  };
}
```

- [ ] **Step 3: Wire `--canonicalize` flag into CLI**

In `src/cli/index.ts`, inside the convert directory-mode handler, add the dual-mode logic. Find the Phase 2 split block (inside `if (existsSync(cssPath) && doSplit)`) and add a branch:

```typescript
      const useCanonical = args.includes("--canonicalize");

      if (existsSync(cssPath) && doSplit) {
        mkdirSync(setupDir, { recursive: true });

        const fullCss = readFileSync(cssPath, "utf-8");

        if (useCanonical) {
          // Canonicalized path: PostCSS AST pipeline
          const { editable, raw, rejectionJson } = generateGlobalStylesDataCanonicalized(fullCss);
          const manifest = buildGlobalStylesManifest(editable, raw, []);
          writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

          const { uniqueCss } = splitCssCanonicalized(fullCss);
          writeFileSync(resolve(setupDir, "styles-unique.css"), uniqueCss + "\n", "utf-8");
          
          writeFileSync(resolve(setupDir, "rejected.json"), rejectionJson + "\n", "utf-8");

          console.log(`  Global Styles: ${editable.length} structured (editable), ${raw.length} raw (CSS-only)`);
          console.log(`  Rejections:    setup/rejected.json`);
        } else {
          // Legacy path: regex-based
          const { editable, raw } = generateGlobalStylesData(fullCss);
          const manifest = buildGlobalStylesManifest(editable, raw, []);
          writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

          const split = splitCss(fullCss);
          writeFileSync(resolve(setupDir, "styles-unique.css"), split.uniqueCss + "\n", "utf-8");

          console.log(`  Global Styles: ${editable.length} structured (editable), ${raw.length} raw (CSS-only)`);
        }
      }
```

Also update the help text:

```typescript
    console.log("    --canonicalize            Use PostCSS AST pipeline with variable resolution");
```

- [ ] **Step 4: Run both paths and compare**

```bash
# Legacy
npx tsx src/cli/index.ts convert inputs/mino/ --split
# Canonicalized
npx tsx src/cli/index.ts convert inputs/mino/ --split --canonicalize
```

Verify: canonicalized `global-styles.json` has `--tw-*-opacity` variables resolved to concrete values. `rejected.json` exists with non-zero rejection count.

- [ ] **Step 5: Commit**

```bash
git add src/core/global-styles-data.ts src/core/css-splitter.ts src/cli/index.ts
git commit -m "feat: wire canonicalized CSS pipeline behind --canonicalize flag"
```

---

### Task 7: Golden Snapshot Tests

**Files:**
- Create: `tests/snapshots/mino-global-styles.json`
- Create: `tests/snapshots/mino-styles-unique.css`
- Create: `tests/snapshots/mino-rejected.json`
- Create: `tests/snapshot.test.ts`

- [ ] **Step 1: Generate golden snapshots**

Run the canonicalized pipeline and save output:

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split --canonicalize
cp output/mino/setup/global-styles.json tests/snapshots/mino-global-styles.json
cp output/mino/setup/styles-unique.css tests/snapshots/mino-styles-unique.css
cp output/mino/setup/rejected.json tests/snapshots/mino-rejected.json
```

- [ ] **Step 2: Write snapshot test**

Create `tests/snapshot.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CssClassifier } from "../src/core/css-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = resolve(__dirname, "snapshots");

const minoCss = readFileSync(resolve(process.cwd(), "output/mino/styles.css"), "utf-8");

describe("Golden Snapshots — mino", () => {
  it("global-styles.json matches snapshot", () => {
    const result = CssClassifier.classify(minoCss);
    const actual = JSON.stringify(
      result.structuredStyles.map((s) => ({ selector: s.selector, styles: s.styles })),
      null,
      2,
    );
    const expected = JSON.stringify(
      JSON.parse(readFileSync(resolve(SNAPSHOTS, "mino-global-styles.json"), "utf-8")).styles.map(
        (s: any) => ({ selector: s.selector, styles: s.styles }),
      ),
      null,
      2,
    );
    assert.strictEqual(actual, expected, "global-styles.json should match golden snapshot");
  });

  it("styles-unique.css matches snapshot", () => {
    const result = CssClassifier.classify(minoCss);
    const expected = readFileSync(resolve(SNAPSHOTS, "mino-styles-unique.css"), "utf-8");
    assert.strictEqual(result.rawCss, expected, "styles-unique.css should match golden snapshot");
  });

  it("rejected.json matches snapshot (counts only)", () => {
    const result = CssClassifier.classify(minoCss);
    const actual = JSON.parse(result.rejectionLog.toJSON(10000));
    const expected = JSON.parse(readFileSync(resolve(SNAPSHOTS, "mino-rejected.json"), "utf-8"));
    assert.strictEqual(actual.rejectedRules, expected.rejectedRules, "rejection count should match");
    assert.strictEqual(actual.rejectionRate, expected.rejectionRate, "rejection rate should match");
  });
});
```

- [ ] **Step 3: Run snapshot tests**

Run: `npx tsx --test tests/snapshot.test.ts`
Expected: 3/3 pass (snapshots match).

- [ ] **Step 4: Commit**

```bash
git add tests/snapshots/ tests/snapshot.test.ts
git commit -m "test: add golden snapshot tests for canonicalized mino output"
```

---

### Task 8: Install Dependencies

- [ ] **Step 1: Install postcss**

```bash
npm install postcss
npm install --save-dev @types/postcss
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/core/css-classifier.ts src/core/css-canonicalizer.ts src/core/gb-whitelist.ts src/core/rejection-log.ts
```

Expected: no errors in these new files (pre-existing errors in other files are fine).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add postcss dependency for CSS AST pipeline"
```

---

### Task 9: Final Integration Run

- [ ] **Step 1: Run all tests**

```bash
npx tsx --test tests/gb-whitelist.test.ts tests/rejection-log.test.ts tests/css-canonicalizer.test.ts tests/css-classifier.test.ts tests/snapshot.test.ts
```

Expected: 31/31 pass (11 + 5 + 9 + 3 + 3).

- [ ] **Step 2: Run full conversion with canonicalized path**

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split --canonicalize
```

Expected: 10/10 pages pass. `setup/global-styles.json` has canonicalized colors. `setup/rejected.json` exists.

- [ ] **Step 3: Verify legacy path still works**

```bash
npx tsx src/cli/index.ts convert inputs/hkvc/ --split
```

Expected: 329 blocks, pass. No regression.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final integration — 31/31 tests pass, both paths work"
```
