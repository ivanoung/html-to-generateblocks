# Intent-Based Style Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `getComputedStyle()` extraction with CSS rule parsing from `document.styleSheets`. Only capture properties Tailwind actually set (~5-8 per element vs ~300). Resolve CSS variable chains in transforms. Normalize values. Produce minimal `global-styles.json` and `custom.css`.

**Architecture:** The inliner's main function changes from a per-element computed-style loop to a two-pass approach: (1) parse all CSS rules into a ClassRegistry, then (2) look up each element's class list against the registry. The consolidator simplifies to hashing whatever Tailwind set (no structural/decorative split).

**Tech Stack:** TypeScript, Playwright (Chromium headless), Cheerio

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/tailwind-inliner.ts` | **Rewrite** | Phases 1-5: CSS rule extraction, per-element assignment, CSS variable resolution, value normalization, desktop-first conversion, property placement |
| `src/core/class-consolidator.ts` | **Simplify** | Phases 6-7: hash-based dedup, original name preservation, state-only class handling, global-styles.json generation |
| `src/core/orchestrator.ts` | **Modify** | Wire new inliner output; write global-styles.json and custom.css |
| `src/core/dom-walker.ts` | **No change** | Section wrapper unchanged |
| `src/cli/index.ts` | **No change** | Pre-flight check unchanged |

---

### Task 1: CSS Rule Extraction + Classification (Phase 1)

**Files:**
- Rewrite: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Define the ClassRegistry types and ParsedRule interface**

Replace the existing type definitions at the top of `tailwind-inliner.ts`:

```ts
type RuleKind = "class-base" | "class-state" | "class-responsive" | "compound" | "element" | "keyframe" | "vendor-pseudo";

interface ParsedRule {
  kind: RuleKind;
  selector: string;
  className?: string;
  properties: Record<string, string>;
  breakpoint?: string;
  state?: string;
  index: number;  // position in stylesheet for cascade order
}

interface ClassRegistry {
  base: Map<string, ParsedRule>;
  responsive: Map<string, ParsedRule[]>;
  state: Map<string, ParsedRule[]>;
  compound: ParsedRule[];
}

interface ExtractionResult {
  registry: ClassRegistry;
  customCssRules: string[];
  breakpoints: Record<string, string>; // "lg" → "1024px" (from config)
}
```

- [ ] **Step 2: Write the `extractCssRules()` function**

Replace the `extractStyles()` function with a new one that runs inside `page.evaluate()`:

```ts
async function extractCssRules(page: Page, tailwindConfig: string | null): Promise<ExtractionResult> {
  return page.evaluate((configStr) => {
    const breakpoints = parseBreakpoints(configStr);
    const registry: ClassRegistry = { base: new Map(), responsive: new Map(), state: new Map(), compound: [] };
    const customCssRules: string[] = [];
    let ruleIndex = 0;

    for (const sheet of document.styleSheets) {
      try {
        processStyleSheet(sheet, registry, customCssRules, breakpoints, ruleIndex);
      } catch { /* cross-origin */ }
    }

    // Convert Maps to plain objects for serialization
    return {
      registry: {
        base: Object.fromEntries(registry.base),
        responsive: Object.fromEntries(registry.responsive),
        state: Object.fromEntries(registry.state),
        compound: registry.compound,
      },
      customCssRules,
      breakpoints,
    };
  }, tailwindConfig);
}
```

- [ ] **Step 3: Write the browser-side rule processing functions**

Inside the `page.evaluate` callback, define helper functions:

```ts
function processStyleSheet(sheet, registry, customCss, breakpoints, ruleIndex) {
  for (const rule of sheet.cssRules) {
    if (rule instanceof CSSStyleRule) {
      processStyleRule(rule, null, registry, customCss, breakpoints, ruleIndex++);
    } else if (rule instanceof CSSMediaRule) {
      const bp = matchBreakpoint(rule.conditionText, breakpoints);
      for (const inner of rule.cssRules) {
        if (inner instanceof CSSStyleRule) {
          processStyleRule(inner, bp, registry, customCss, breakpoints, ruleIndex++);
        }
      }
    } else if (rule instanceof CSSKeyframesRule) {
      customCss.push(`@keyframes ${rule.name}{${rule.cssText.substring(rule.cssText.indexOf('{')+1)}`);
    }
  }
}

function processStyleRule(rule, breakpoint, registry, customCss, breakpoints, idx) {
  const sel = rule.selectorText;
  
  // Element/universal selectors → custom.css
  if (!sel.trim().startsWith('.')) {
    customCss.push(`${sel}{${rule.style.cssText}}`);
    return;
  }
  
  // Vendor-prefixed → custom.css
  if (/::-webkit-|::-moz-|::-ms-/.test(sel)) {
    customCss.push(`${sel}{${rule.style.cssText}}`);
    return;
  }
  
  // Extract properties, filter --tw-*
  const props = {};
  for (let i = 0; i < rule.style.length; i++) {
    const p = rule.style[i];
    if (p.startsWith('--tw-')) continue;
    props[p] = rule.style.getPropertyValue(p);
  }
  if (Object.keys(props).length === 0) return;
  
  // Unescape class name
  let className = sel.replace(/^\./, '').replace(/:.*$/, '');
  className = className.replace(/\\:/g, ':').replace(/\\\//g, '/').replace(/\\\./g, '.');
  
  // Detect state
  let state = null;
  if (/:hover/.test(sel)) state = 'hover';
  else if (/:focus-visible/.test(sel)) state = 'focus-visible';
  else if (/:focus/.test(sel)) state = 'focus';
  else if (/:active/.test(sel)) state = 'active';
  
  // Check for compound selectors (space, >, ~, +)
  const isCompound = /[\s>~+]/.test(sel.replace(/:.*$/, ''));
  
  const rule: ParsedRule = { kind: 'class-base', selector: sel, className, properties: props, breakpoint, state, index: idx };
  
  if (isCompound) {
    rule.kind = 'compound';
    registry.compound.push(rule);
  } else if (breakpoint) {
    rule.kind = 'class-responsive';
    if (!registry.responsive.has(className)) registry.responsive.set(className, []);
    registry.responsive.get(className).push(rule);
  } else if (state) {
    rule.kind = 'class-state';
    if (!registry.state.has(className)) registry.state.set(className, []);
    registry.state.get(className).push(rule);
  } else {
    registry.base.set(className, rule);
  }
}
```

- [ ] **Step 4: Write breakpoint parsing and matching helpers**

```ts
function parseBreakpoints(configStr: string | null): Record<string, string> {
  if (!configStr) return { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' };
  try {
    const obj = JSON.parse(configStr);
    return obj?.theme?.screens || { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' };
  } catch { return { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' }; }
}

function matchBreakpoint(conditionText: string, breakpoints: Record<string, string>): string | null {
  const match = conditionText.match(/min-width:\s*(\d+)px/);
  if (!match) return null;
  const px = parseInt(match[1]);
  for (const [name, val] of Object.entries(breakpoints)) {
    if (val === `${px}px`) return name;
  }
  return null;
}
```

- [ ] **Step 5: Run a quick verification by extracting and logging rule counts**

Temporarily add console.log of registry sizes and verify:
- `registry.base.size` ≈ 400+ (Tailwind utilities + custom CSS classes)
- `registry.responsive.size` ≈ 30+ (responsive variants)
- `registry.state.size` ≈ 40+ (hover/focus variants)
- `customCssRules.length` ≈ 20+ (element selectors, @keyframes)

- [ ] **Step 6: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: CSS rule extraction from document.styleSheets (Phase 1)

- Classifies rules into base/responsive/state/compound/element/keyframe/vendor-pseudo
- Builds ClassRegistry indexed by unescaped class name
- Routes element/universal/vendor-prefixed selectors to customCssRules
- Filters --tw-* CSS custom properties
- Parses Tailwind config for breakpoint name mapping
- Handles CSSKeyframesRule extraction"
```

---

### Task 2: Per-Element Style Assignment (Phase 2)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Write `assignStylesToElement()` function**

```ts
interface ElementStyles {
  base: Record<string, string>;
  responsive: Record<string, Record<string, string>>;
  state: Record<string, Record<string, string>>;
}

function assignStylesToElement(
  classList: string,
  registry: ClassRegistry,
): ElementStyles {
  const result: ElementStyles = { base: {}, responsive: {}, state: {} };
  const classes = classList.split(/\s+/).filter(c => c.length > 0);

  for (const cls of classes) {
    // Split responsive prefix: lg:pt-48 → { prefix: "lg", name: "pt-48" }
    const prefixMatch = cls.match(/^(sm|md|lg|xl|2xl):(.+)$/);
    const name = prefixMatch ? prefixMatch[2] : cls;
    const bp = prefixMatch ? prefixMatch[1] : null;
    
    // Also check for state prefix: hover:bg-red-500
    const stateMatch = cls.match(/^(hover|focus|focus-visible|active):(.+)$/);
    if (stateMatch && !bp) {
      const rules = registry.state.get(stateMatch[2]);
      if (rules) {
        for (const rule of rules) {
          Object.assign(result.state[stateMatch[1]] ||= {}, rule.properties);
        }
      }
      continue;
    }

    if (bp) {
      // Responsive class
      const rules = registry.responsive.get(name);
      if (rules) {
        for (const rule of rules) {
          if (rule.breakpoint === bp) {
            Object.assign(result.responsive[bp] ||= {}, rule.properties);
          }
        }
      }
    } else {
      // Base class — process in order; later properties override earlier
      const rule = registry.base.get(name);
      if (rule) {
        Object.assign(result.base, rule.properties);
      }
    }
  }

  // Also check compound selectors for this element
  // (handled separately with DOM context — see Step 2)

  return result;
}
```

- [ ] **Step 2: Handle compound selector matching**

For each element, check if it matches any compound selector in `registry.compound`:

```ts
function matchCompoundSelectors(
  el: HTMLElement,
  registry: ClassRegistry,
  result: ElementStyles,
): void {
  for (const rule of registry.compound) {
    try {
      if (el.matches(rule.selector)) {
        Object.assign(result.base, rule.properties);
      }
    } catch { /* invalid selector */ }
  }
}
```

Call this after the class-based assignment pass.

- [ ] **Step 3: Capture existing inline styles and merge**

Before assigning Tailwind properties, capture the element's existing `style` attribute. After assignment, merge:

```ts
function mergeWithExisting(
  tailwindStyles: ElementStyles,
  existingStyle: string,
): ElementStyles {
  const existing = parseStyleToMap(existingStyle);
  // Existing inline styles override Tailwind for same property (in base only)
  for (const [prop, val] of Object.entries(existing)) {
    result.base[prop] = val;
  }
  return result;
}
```

- [ ] **Step 4: Wire into the main `inlineTailwindStyles()` flow**

Replace the old `extractStyles()` + reconstruction logic with:

```ts
const { registry, customCssRules, breakpoints } = await extractCssRules(page, configJson);
const elementStylesMap = new Map<string, ElementStyles>();

for (const [idx, classList] of Object.entries(payload.classListPerElement)) {
  const styles = assignStylesToElement(classList, registry);
  // Merge with existing inline styles (captured earlier)
  const existingStyle = payload.existingStyles[idx] || '';
  const merged = mergeWithExisting(styles, existingStyle);
  elementStylesMap.set(idx, merged);
}
```

- [ ] **Step 5: Run conversion, verify element count matches**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: same 321 blocks, far fewer warnings (no more "Forbidden CSS property skipped" spam).

- [ ] **Step 6: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: per-element style assignment from ClassRegistry (Phase 2)

- assignStylesToElement: class list → ClassRegistry lookup → ElementStyles
- Class list order resolves conflicts (later overrides earlier)
- Compound selector matching via el.matches()
- Existing inline style capture + merge (source styles preserved)"
```

---

### Task 3: CSS Variable Resolution (Phase 3)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Define the CSS variable defaults (from Tailwind preflight)**

```ts
const TW_VARIABLE_DEFAULTS: Record<string, string> = {
  "--tw-translate-x": "0",
  "--tw-translate-y": "0",
  "--tw-rotate": "0deg",
  "--tw-scale-x": "1",
  "--tw-scale-y": "1",
  "--tw-skew-x": "0deg",
  "--tw-skew-y": "0deg",
  "--tw-blur": "0",
  "--tw-brightness": "1",
  "--tw-contrast": "1",
  "--tw-grayscale": "0",
  "--tw-hue-rotate": "0deg",
  "--tw-invert": "0",
  "--tw-saturate": "1",
  "--tw-sepia": "0",
  "--tw-drop-shadow": "none",
};
```

- [ ] **Step 2: Collect `--tw-*` values from an element's matching rules**

```ts
function collectTwVariables(
  classList: string,
  registry: ClassRegistry,
): Record<string, string> {
  const vars = { ...TW_VARIABLE_DEFAULTS };
  
  for (const cls of classList.split(/\s+/)) {
    const name = cls.replace(/^(?:sm|md|lg|xl|2xl):/, '');
    const rule = registry.base.get(name);
    if (!rule) continue;
    for (const [prop, val] of Object.entries(rule.properties)) {
      if (prop.startsWith("--tw-")) {
        vars[prop] = val;
      }
    }
  }
  return vars;
}
```

- [ ] **Step 3: Resolve and simplify transform/filter/backdrop-filter**

```ts
function resolveTransform(transformStr: string, twVars: Record<string, string>): string {
  let resolved = transformStr;
  for (const [varName, val] of Object.entries(twVars)) {
    resolved = resolved.replace(new RegExp(`var\\(${varName}[^)]*\\)`, 'g'), val);
  }
  return simplifyTransform(resolved);
}

function simplifyTransform(t: string): string {
  // Remove identity components
  t = t.replace(/translate\(0px,\s*0px\)\s*/g, '');
  t = t.replace(/translateX\(0px\)\s*/g, '');
  t = t.replace(/translateY\(0px\)\s*/g, '');
  t = t.replace(/rotate\(0deg\)\s*/g, '');
  t = t.replace(/scaleX\(1\)\s*/g, '');
  t = t.replace(/scaleY\(1\)\s*/g, '');
  t = t.replace(/skewX\(0deg\)\s*/g, '');
  t = t.replace(/skewY\(0deg\)\s*/g, '');
  t = t.trim();
  // If empty after simplification, return "none"
  return t || "none";
}
```

- [ ] **Step 4: Apply resolution to each element's styles**

In the per-element loop, after `assignStylesToElement()`:

```ts
if (styles.base["transform"] || styles.base["filter"] || styles.base["backdrop-filter"]) {
  const twVars = collectTwVariables(classList, registry);
  if (styles.base["transform"]) {
    styles.base["transform"] = resolveTransform(styles.base["transform"], twVars);
  }
  // Same pattern for filter and backdrop-filter
}
```

- [ ] **Step 5: Run conversion, verify transforms are clean**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
grep -o '"transform":"[^"]*"' output/mino/index.html | sort -u
```

Expected: `"transform":"translateY(-0.5rem)"`, `"transform":"none"` — no `var(--tw-*)` in values.

- [ ] **Step 6: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: CSS variable resolution for transform/filter (Phase 3)

- Collects --tw-* variable values from matching rules + preflight defaults
- Substitutes variables in transform/filter/backdrop-filter
- Simplifies identity components (translate(0,0), rotate(0deg), scaleX(1))"
```

---

### Task 4: Value Normalization (Phase 4)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Write color normalization**

```ts
function normalizeValue(prop: string, value: string): string {
  // Normalize rgb() → #hex where possible
  const rgbMatch = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    const hex = [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    // Use shorthand if possible
    if (hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) {
      return `#${hex[0]}${hex[2]}${hex[4]}`;
    }
    return `#${hex}`;
  }
  
  // Strip px from 0px
  if (value === '0px') return '0';
  
  return value;
}

function normalizeStyles(styles: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, val] of Object.entries(styles)) {
    result[prop] = normalizeValue(prop, val);
  }
  return result;
}
```

- [ ] **Step 2: Apply normalization to all element styles**

In the per-element loop, after CSS variable resolution:

```ts
styles.base = normalizeStyles(styles.base);
for (const bp of Object.keys(styles.responsive)) {
  styles.responsive[bp] = normalizeStyles(styles.responsive[bp]);
}
```

- [ ] **Step 3: Verify normalization output**

```bash
grep -o '"color":"[^"]*"' output/mino/index.html | sort -u | head -10
```

Expected: hex colors like `"color":"#1E293B"`, not `"color":"rgb(30, 41, 59)"`.

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: value normalization — rgb→hex, 0px→0 (Phase 4)"
```

---

### Task 5: Desktop-First Conversion + Property Placement (Phase 5)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Implement desktop-first conversion logic**

The inliner returns the `ElementStyles` for each element. The consolidator handles placement. But first, convert responsive overrides to desktop-first format:

```ts
function convertToDesktopFirst(styles: ElementStyles, breakpoints: Record<string, string>): DesktopFirstStyles {
  // Start with base properties
  const desktop: Record<string, string> = { ...styles.base };
  const overrides: Array<{ maxWidth: number; props: Record<string, string> }> = [];
  
  // Sort breakpoints by width descending (largest first → desktop)
  const sortedBps = Object.entries(breakpoints)
    .sort(([, a], [, b]) => parseInt(b) - parseInt(a));
  
  for (const [bpName, bpVal] of sortedBps) {
    const bpStyles = styles.responsive[bpName];
    if (!bpStyles) continue;
    
    // Responsive overrides base for same property
    for (const [prop, val] of Object.entries(bpStyles)) {
      if (desktop[prop] !== val) {
        // This is a responsive override — add to desktop if larger BP,
        // or to overrides if smaller
        if (overrides.length === 0) {
          // First (largest) breakpoint: apply to desktop base
          desktop[prop] = val;
        }
      }
    }
  }
  
  // Build max-width overrides for smaller breakpoints
  const maxWidth = parseInt(sortedBps[0]?.[1] || '1280');
  for (let i = 1; i < sortedBps.length; i++) {
    const bpName = sortedBps[i][0];
    const bpStyles = styles.responsive[bpName];
    if (!bpStyles) continue;
    
    const maxW = parseInt(sortedBps[i-1][1]) - 1;
    const diff: Record<string, string> = {};
    for (const [prop, val] of Object.entries(bpStyles)) {
      if (desktop[prop] !== val) {
        diff[prop] = val;
      }
    }
    if (Object.keys(diff).length > 0) {
      overrides.push({ maxWidth: maxW, props: diff });
    }
  }
  
  return { desktop, overrides };
}
```

- [ ] **Step 2: Apply initial-value filter to desktop base**

Strip properties that match CSS initial values:

```ts
const CSS_INITIALS: Record<string, string> = {
  "display": "inline",
  "position": "static",
  "margin-top": "0", "margin-right": "0", "margin-bottom": "0", "margin-left": "0",
  "padding-top": "0", "padding-right": "0", "padding-bottom": "0", "padding-left": "0",
  "border-top-width": "0", "border-right-width": "0", "border-bottom-width": "0", "border-left-width": "0",
  "border-radius": "0",
  "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto",
  "order": "0", "float": "none", "opacity": "1", "z-index": "auto",
  "overflow": "visible", "visibility": "visible", "transform": "none",
};

function stripInitials(desktop: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, val] of Object.entries(desktop)) {
    if (CSS_INITIALS[prop] === val) continue;
    result[prop] = val;
  }
  return result;
}
```

- [ ] **Step 3: Wire into main flow**

After per-element assignment, convert each element's styles:

```ts
const desktopFirstMap = new Map<string, DesktopFirstStyles>();
for (const [idx, styles] of elementStylesMap) {
  desktopFirstMap.set(idx, convertToDesktopFirst(styles, breakpoints));
}
```

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: desktop-first conversion + initial-value filter (Phase 5)

- Largest breakpoint → desktop base, smaller → max-width overrides
- Responsive overrides base for same property
- Strips CSS initial values from base properties"
```

---

### Task 6: Simplified Class Consolidator (Phases 6-7)

**Files:**
- Modify: `src/core/class-consolidator.ts`

- [ ] **Step 1: Remove structural/decorative split**

Replace the `STRUCTURAL_PROPS` Set and `isStructural()`/`splitProps()` logic. The new consolidator takes `DesktopFirstStyles` directly and hashes all non-initial properties:

```ts
export function consolidateStyles(
  elementStyles: Map<string, DesktopFirstStyles>,
): GlobalStyleEntry[] {
  const hashToIdx = new Map<string, string[]>();
  const hashToProps = new Map<string, Record<string, string>>();
  const hashToOverrides = new Map<string, Array<{ maxWidth: number; props: Record<string, string> }>>();

  for (const [idx, styles] of elementStyles) {
    const cleaned = stripInitials(styles.desktop);
    if (Object.keys(cleaned).length === 0) continue;
    
    const hash = hashProps(cleaned);
    if (!hashToIdx.has(hash)) {
      hashToIdx.set(hash, []);
      hashToProps.set(hash, cleaned);
      hashToOverrides.set(hash, []);
    }
    hashToIdx.get(hash)!.push(idx);
    // Collect responsive overrides
    const existing = hashToOverrides.get(hash)!;
    for (const ov of styles.overrides) {
      const match = existing.find(e => e.maxWidth === ov.maxWidth);
      if (match) {
        Object.assign(match.props, ov.props);
      } else {
        existing.push({ maxWidth: ov.maxWidth, props: { ...ov.props } });
      }
    }
  }

  const entries: GlobalStyleEntry[] = [];
  for (const [hash, idxs] of hashToIdx) {
    if (idxs.length < 2) continue; // Used by only 1 element → inline
    
    const className = `gb-s-${hash}`;
    const desktop = hashToProps.get(hash)!;
    const overrides = hashToOverrides.get(hash)!;
    
    entries.push(buildClassEntry(className, desktop, overrides));
  }
  
  return entries;
}
```

- [ ] **Step 2: Preserve original class names for custom CSS classes**

When a class name from the source CSS (not Tailwind-generated) appears in the registry, preserve its original name instead of generating `gb-s-{hash}`:

```ts
const ORIGINAL_CLASS_NAMES = new Set(['blueprint-bg', 'blueprint-bg-dark', 'clip-hex', 'hover-shadow-md', 'ruler-x', 'no-scrollbar']);

function getClassName(hash: string, props: Record<string, string>, classList: string): string {
  for (const name of ORIGINAL_CLASS_NAMES) {
    if (classList.includes(name)) return name;
  }
  return `gb-s-${hash}`;
}
```

- [ ] **Step 3: Handle state-only classes**

Classes like `.hover-shadow-md` have only state properties. They produce entries with only `&:hover`:

```ts
function buildStateOnlyEntry(className: string, stateStyles: Record<string, Record<string, string>>): GlobalStyleEntry {
  const parts: string[] = [];
  const data: Record<string, unknown> = {};
  
  for (const [state, props] of Object.entries(stateStyles)) {
    const sel = `.${className}${state.replace('&', '')}`;
    const css = Object.entries(props).map(([k, v]) => `${kebabCase(k)}:${v}`).join(';');
    parts.push(`${sel}{${css}}`);
    data[`&:${state}`] = props;
  }
  
  return { selector: `.${className}`, name: className, css: parts.join(''), data };
}
```

- [ ] **Step 4: Build the `buildClassEntry()` function**

Simplified from the current version — no structural/decorative split:

```ts
function buildClassEntry(
  className: string,
  desktop: Record<string, string>,
  overrides: Array<{ maxWidth: number; props: Record<string, string> }>,
): GlobalStyleEntry {
  const parts: string[] = [];
  const data: Record<string, unknown> = { ...desktop };
  
  const baseCss = Object.entries(desktop).map(([k, v]) => `${kebabCase(k)}:${v}`).join(';');
  parts.push(`.${className}{${baseCss}}`);
  
  for (const ov of overrides) {
    const ovCss = Object.entries(ov.props).map(([k, v]) => `${kebabCase(k)}:${v}`).join(';');
    parts.push(`@media(max-width:${ov.maxWidth}px){.${className}{${ovCss}}}`);
    data[`@media (max-width: ${ov.maxWidth}px)`] = ov.props;
  }
  
  return { selector: `.${className}`, name: className, css: parts.join(''), data };
}
```

- [ ] **Step 5: Run conversion, verify global-styles.json entries drop significantly**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
node -e "const g=require('./output/mino/global-styles.json'); console.log('Classes:', g.length, 'Sample props:', Object.keys(g[0]?.data||{}).length)"
```

Expected: class count similar but properties per class drop from 65 to ~5-8.

- [ ] **Step 6: Commit**

```bash
git add src/core/class-consolidator.ts
git commit -m "refactor: simplify class consolidator — no structural/decorative split

- Hashes all non-initial Tailwind properties directly
- Preserves original class names for custom CSS classes
- Handles state-only classes (&:hover-only entries)
- Per-class property count drops from ~65 to ~5-8"
```

---

### Task 7: custom.css Assembly (Phase 8)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Assemble custom.css from extracted rules**

```ts
function buildCustomCss(
  customCssRules: string[],
  styleBlocks: string[],
): string {
  const parts: string[] = [];
  
  // Element/universal selectors from CSS extraction
  parts.push("/* Tailwind Preflight */");
  for (const rule of customCssRules) {
    parts.push(rule);
  }
  
  // @keyframes from existing <style> blocks (extracted by preprocessor)
  for (const block of styleBlocks) {
    // Extract @keyframes and vendor-prefixed rules
    const keyframes = block.match(/@keyframes\s+[\s\S]+?}(?=\s*$|@|\})/g);
    if (keyframes) parts.push(...keyframes);
    
    const vendorRules = block.match(/::-webkit-[^}]+}/g);
    if (vendorRules) parts.push(...vendorRules);
    
    // Body-level rules
    const bodyRules = block.match(/body\s*\{[^}]+\}/g);
    if (bodyRules) parts.push(...bodyRules);
  }
  
  return parts.join('\n');
}
```

- [ ] **Step 2: Pass styleBlocks through to the orchestrator**

The `styleBlocks` are already in `InlinerResult` from Task 1's refactoring. Add a `customCss` field:

```ts
export interface InlinerResult {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
  customCss: string;  // NEW
  desktopFirstStyles: Map<string, DesktopFirstStyles>;  // NEW
  warnings: string[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: custom.css assembly from extracted rules + style blocks (Phase 8)"
```

---

### Task 8: Orchestrator Integration

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Wire new inliner output to consolidator**

```ts
if (usesTailwind(rawHtml)) {
  const inlined = await inlineTailwindStyles(rawHtml);
  if (inlined.elementCount > 0) {
    rawHtml = inlined.html;
    
    const consolidatedGlobalStyles = consolidateStyles(inlined.desktopFirstStyles);
    
    // Write global-styles.json
    if (consolidatedGlobalStyles.length > 0) {
      writeFileSync(
        resolve(outDir, "global-styles.json"),
        JSON.stringify(consolidatedGlobalStyles, null, 2) + "\n",
        "utf-8",
      );
    }
    
    // Write custom.css
    if (inlined.customCss) {
      writeFileSync(
        resolve(outDir, "custom.css"),
        inlined.customCss + "\n",
        "utf-8",
      );
    }
  }
}
```

- [ ] **Step 2: Remove old compilation logic (tailwind-resolver, theme-settings, global-styles-generator)**

These are no longer needed since Tailwind is resolved by the inliner:

```ts
// Remove: compileTailwindCss, generateThemeSettingsPrompt, generateGlobalStyles
// and their corresponding output file writes
```

- [ ] **Step 3: Run full conversion, verify all output files**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
ls -la output/mino/
```

Expected: `index.html`, `index.report.json`, `global-styles.json`, `custom.css`.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: wire intent-based inliner + consolidator into orchestrator

- Removes tailwind-resolver/theme-settings/global-styles-generator calls
- Writes global-styles.json from consolidated classes
- Writes custom.css from extracted rules + style blocks"
```

---

### Task 9: Clean Up Removed Code

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Remove dead code**

Remove from `tailwind-inliner.ts`:
- `DEFAULTS` map (browser defaults filter)
- `SKIP_PROPS` Set (browser-internal filter)
- `reconstructRelativeValues()` and helpers
- `extractStyles()` (old getComputedStyle approach)
- Multi-viewport capture loop
- `responsiveOverrides` field from `InlinerResult`
- `stateStyles` field from `InlinerResult`

- [ ] **Step 2: Update InlinerResult to match new fields**

```ts
export interface InlinerResult {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
  customCss: string;
  desktopFirstStyles: Map<string, DesktopFirstStyles>;
  warnings: string[];
}
```

- [ ] **Step 3: Run fixtures to confirm no regression**

```bash
npx tsx src/cli/index.ts regression
```

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "chore: remove dead code from old computed-style pipeline"
```

---

### Task 10: End-to-End Mino Verification

- [ ] **Step 1: Clean run**

```bash
rm -rf output/* && npx tsx src/cli/index.ts convert inputs/mino/index.html
```

- [ ] **Step 2: Verify key metrics**

```bash
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('output/mino/index.report.json','utf-8'));
const html = fs.readFileSync('output/mino/index.html','utf-8');
console.log('Status:', r.overallStatus);
console.log('Hard fails:', r.hardFails.length);
console.log('Blocks:', r.blockCount);
console.log('Outer sections:', (html.match(/uniqueId\":\"outer/g)||[]).length);
console.log('Inner divs:', (html.match(/uniqueId\":\"inner/g)||[]).length);
console.log('TW in globalClasses:', (html.match(/\"globalClasses\":\[([^\]]*)\]/g)||[]).filter(g=>/pt-|text-5xl|flex/.test(g)).length);
"
```

Expected: `pass`, 0 hard fails, 321 blocks, 10 outer/inner pairs, 0 TW in globalClasses.

- [ ] **Step 3: Verify global-styles.json quality**

```bash
node -e "
const gs = require('./output/mino/global-styles.json');
console.log('Classes:', gs.length);
console.log('Avg props per class:', Math.round(gs.reduce((s,c)=>s+Object.keys(c.data).length,0)/gs.length));
console.log('Contains rgb():', JSON.stringify(gs).includes('rgb(') ? 'YES (bad)' : 'NO (good)');
console.log('Contains var(--tw-):', JSON.stringify(gs).includes('var(--tw-') ? 'YES (bad)' : 'NO (good)');
"
```

Expected: classes with ~5-8 props, no `rgb()` values, no `var(--tw-*)`.

- [ ] **Step 4: Verify output files exist**

```bash
for f in index.html index.report.json global-styles.json custom.css; do
  test -f "output/mino/$f" && echo "  $f: EXISTS" || echo "  $f: MISSING"
done
```

- [ ] **Step 5: Run regression**

```bash
npx tsx src/cli/index.ts regression
```

- [ ] **Step 6: Commit final verification**

```bash
git add -A
git commit -m "verify: end-to-end Mino conversion with intent-based style transfer"
```
