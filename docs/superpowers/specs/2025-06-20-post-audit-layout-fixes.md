# Spec: Close Remaining Layout Gaps after Live WordPress Audit

**Date**: 2025-06-20
**Status**: Draft
**Based on**: Live WordPress analysis at https://minodigital-2tcd.1wp.site/

---

## Problem Statement

After deploying converted GB blocks to WordPress, four categories of visual degradation remain:

1. **Heading line-height regression**: `leading-[0.9]` overridden by breakpoint-specific `line-height` values from `text-Xxl` classes
2. **Form/browser-mockup children unstyled**: Inner-HTML elements (form inputs, browser chrome, SVG wrappers, inline spans) have Tailwind classes that lose their CSS when `filterUtilityCss()` strips them
3. **Color-dependent visual loss**: Backgrounds, text colors, borders, hover states rely on `--tw-*` CSS variables that can't map to GB inline styles
4. **No auditable proof of CSS coverage**: No tool reports which classes appear in the DOM but lack CSS support

---

## Architecture Context

### How the converter pipeline works

```
inputs/mino/index.html
    │
    ▼
[tailwind-inliner]  ← compiles Tailwind via CDN → styles.css (full CSS)
    │
    ▼
[verify-prepare]    ← parses styles.css → classNameToProperties map
    │
    ▼
[dom-walker]        ← walks DOM, creates GB blocks
    │   ├─ skipMapper=true  → fallback/ (ALL classes in globalClasses)
    │   └─ skipMapper=false → processed/ (mapped classes → styles)
    │
    ▼
[css-splitter]      ← reads styles.css, splits into:
    │   ├─ global-styles-import.json (GB Global Styles)
    │   └─ tailwind-utilities.css    (unmapped utility classes)
    │
    ▼
[filterUtilityCss]  ← removes CSS for classes in mappedClasses set
    │
    ▼
output/mino/processed/
    ├─ pages/*.html       ← GB blocks with mix of styles + globalClasses
    └─ setup/
        ├─ tailwind-utilities.css   ← filtered CSS for unmapped classes
        └─ global-styles-import.json
```

### How GB renders on WordPress

```
GB block JSON:
  { "styles": {"display":"flex","paddingLeft":"48px"},
    "css": ".gb-element-elem004{overflow:visible}",
    "globalClasses": ["transition-transform","duration-300"] }

GB generates:
  .gb-element-elem004 { display:flex; padding-left:48px; overflow:visible }
  <div class="transition-transform duration-300 gb-element-elem004 gb-element">
```

- `styles` → GB generates CSS rules
- `css` → raw CSS injected by GB
- `globalClasses` → added as HTML class attributes (rely on external CSS)

### How the V3 cascade works (current)

```
Input:  text-5xl md:text-7xl lg:text-8xl leading-[0.9]

Step 1: Parse breakpoint prefixes
  base:  text-5xl, leading-[0.9]
  md:    text-7xl
  lg:    text-8xl

Step 2: Map tokens per-breakpoint
  base:  fontSize:48px, lineHeight:48px  (text-5xl) + lineHeight:0.9 (leading-[0.9])
  md:    fontSize:72px, lineHeight:72px  (text-7xl)
  lg:    fontSize:96px, lineHeight:96px  (text-8xl)

Step 3: resolveCascade() — carry values forward base→sm→md→lg→xl→2xl
  base:  fontSize:48px,  lineHeight:0.9
  sm:    fontSize:48px,  lineHeight:0.9
  md:    fontSize:72px,  lineHeight:72px    ← md overrides
  lg:    fontSize:96px,  lineHeight:96px    ← lg overrides

Step 4: collapseToAllScreensWithResets()
  All Screens: fontSize:96px, lineHeight:96px     ← LARGEST bp value
  @media(max-width:1023px): fontSize:72px, lineHeight:72px
  @media(max-width:767px): fontSize:48px, lineHeight:0.9

BUG: lineHeight should be 0.9 at ALL screens (leading-[0.9] is a base class).
     Only fontSize should cascade per-breakpoint.
```

---

## Phase A: V3 Cascade Precedence Fix

### Goal
Base classes take priority over breakpoint-specific values for the same CSS property.

### Spec

**Current behavior**: `collapseToAllScreensWithResets()` takes the largest-breakpoint value for All Screens, regardless of whether a base class sets the same property.

**Target behavior**: Per-property resolution:
- If base breakpoint (index 0, `""`) has a value for property P → use base value as All Screens; emit `@media(max-width)` resets only for breakpoints where P was **explicitly set** by a breakpoint-prefixed class
- If only breakpoint-prefixed classes set P → keep current largest-breakpoint-as-default behavior

### Algorithm

```
function resolveCascadeWithBasePriority(perBp: Map<string, string>): Map<string, string> {
  // Step 1: Standard cascade (carry forward)
  const resolved = standardResolveCascade(perBp);

  // Step 2: Check if base has this property
  const baseValue = perBp.get("");
  if (baseValue === undefined) return resolved; // No base class → standard cascade

  // Step 3: Base exists → base value wins at all breakpoints
  // Identify breakpoints with EXPLICIT overrides (set by bp-prefixed class)
  const overrideBps = [];
  for (const bp of BREAKPOINTS) {
    if (bp === "") continue;
    if (perBp.has(bp) && perBp.get(bp) !== baseValue) {
      overrideBps.push(bp);
    }
  }

  // Step 4: Build result — base value at All Screens, overrides at breakpoints
  const result = new Map();
  result.set("", baseValue);
  for (const bp of overrideBps) {
    result.set(bp, resolved.get(bp)!); // Use cascaded value from standard resolve
  }

  return result;
}
```

### Edge Cases

| Scenario | Expected |
|---|---|
| `text-5xl md:text-7xl lg:text-8xl` (no base `leading-`) | Current behavior: lg value → All Screens, downward resets |
| `leading-[0.9]` (only base, no bp variants) | Base value at all breakpoints, zero `@media` blocks |
| `text-5xl md:text-7xl leading-[0.9]` | fontSize cascades per-bp; lineHeight = 0.9 everywhere (base wins) |
| `p-4 md:p-8` (base + one override) | All Screens: 16px; @media(max-width:767px): 16px (reset) |
| `md:p-8 lg:p-12` (no base, two bps) | Current behavior: lg → All Screens, md → max-width reset |
| `text-5xl lg:text-8xl` (gap between base and lg, no md) | Standard cascade: base→md gets carried, lg overrides |
| `font-thin md:font-bold` (base + one override) | All Screens: 100 (base thin); @media(max-width:767px): 100; (md value not shown because base+md same as base? No — md:font-bold = 700, so: All Screens: 100; @media(max-width:767px): 100) — Wait, md should apply at md. Let me re-think. |

**Correction for edge case `p-4 md:p-8`**:
- Base: 16px → All Screens
- md: 32px — this OVERRIDES at md. But with base priority, All Screens = 16px.
- The md override happens at the md breakpoint. In Tailwind CSS, `md:p-8` means "at md and above". In our inverted system, this means `@media(min-width:768px)` → we emit `@media(max-width:767px)` reset to 16px.
- At All Screens: 16px (base). At viewports below md (max-width:767px): 16px (base). At md+: 32px... but All Screens IS the desktop value.

Wait — this reveals the tension. In the V3 system, All Screens = desktop value. If base is `p-4` and md override is `p-8`:
- In Tailwind (mobile-first): base p-4 applies everywhere, md:p-8 overrides at md+
- In V3 (desktop-first): All Screens = md value (because it's the largest applicable) → All Screens: 32px, reset at max-width:767px to 16px

But with "base priority", All Screens = base value = 16px. The md override (32px) would NOT apply at All Screens. To get the same visual result, we'd need:
- All Screens: 32px (md override wins at desktop)
- @media(max-width:767px): 16px (base)

This is the CORRECT behavior. The md override SHOULD win at desktop. "Base priority" is wrong for this case!

**The real rule**: Base classes cascade through ALL breakpoints. A breakpoint-prefixed class overrides the base value at THAT breakpoint and above. In Tailwind CSS, `md:p-8` overrides `p-4` at md and up. So:
- At base/sm: p-4 (16px)
- At md/lg/xl/2xl: p-8 (32px)

In V3 (desktop-first): 
- All Screens: 32px (md+ value, because md is the largest breakpoint with an override)
- @media(max-width:767px): 16px (base resets)

**The `leading-[0.9]` case is DIFFERENT**: `leading-[0.9]` at base sets `line-height: 0.9`. `text-8xl` at lg sets `line-height: 96px`. But `text-8xl` is a FONT-SIZE class that coincidentally sets line-height. The `leading-[0.9]` class is a LINE-HEIGHT class.

In Tailwind CSS, both set `line-height`. `leading-[0.9]` applies everywhere. `lg:text-8xl` applies at lg+. If `leading-[0.9]` comes AFTER `lg:text-8xl` in the CSS, it wins. If before, `lg:text-8xl` wins at lg+.

But in our mapper, we process classes left to right. `leading-[0.9]` comes AFTER `lg:text-8xl` in the class string (text-5xl md:text-7xl lg:text-8xl tracking-tighter text-surface **leading-[0.9]** mb-8 uppercase). So at the base breakpoint, `leading-[0.9]` IS set and it overwrites the base `text-5xl` line-height. At md, `text-7xl` sets line-height: 72px. At lg, `text-8xl` sets line-height: 96px.

After standard `resolveCascade`:
- base: lineHeight: 0.9
- sm: lineHeight: 0.9
- md: lineHeight: 72px (text-7xl)
- lg: lineHeight: 96px (text-8xl)

The cascade carries forward: base=0.9, sm=0.9, md=72px, lg=96px. But in Tailwind CSS, `leading-[0.9]` would be compiled as a base rule, and `lg:text-8xl` as an @media rule. Both set `line-height`. The result depends on source order:
```
.leading-\[0\.9\] { line-height: 0.9; }
@media (min-width: 1024px) { .lg\:text-8xl { font-size: 6rem; line-height: 1; } }
```
If `leading-[0.9]` is AFTER `lg:text-8xl` in the CSS file, `leading-[0.9]` wins because both have same specificity and the later rule wins. Our mapper processes tokens left-to-right, which matches CSS source order.

So the real question is: in our mapper, what's the source order of the base `leading-[0.9]` token relative to `lg:text-8xl`? They're in DIFFERENT breakpoint buckets. The base bucket processes `leading-[0.9]` and sets `lineHeight: 0.9`. The lg bucket processes `text-8xl` and sets `lineHeight: 96px`. The cascade then takes the lg value to All Screens.

This is fundamentally wrong because the mapper's breakpoint-separated processing loses the source order between base and breakpoint-specific tokens. In Tailwind CSS, `leading-[0.9]` (base) and `lg:text-8xl` (responsive) compile to different CSS rules, and source order in the CSS file determines precedence.

**Revised analysis**: The bug is not about "base priority" per se. It's that the mapper splits tokens by breakpoint, then cascades separately per-property, losing the original source order. A base class like `leading-[0.9]` that sets a property ALSO set by a bp-prefixed class should win because it appears LATER in the class string (matches CSS source order).

**Correct fix**: After `resolveCascade`, for each property, if the base breakpoint has a value AND that value came from a token that appeared AFTER any bp-prefixed token that sets the same property, the base value should win at all breakpoints.

But tracking "which token came from where" is complex. A simpler heuristic that covers 99% of cases:

**Simplified rule**: If base has P, and ANY bp-prefixed class also sets P, and the base P came from a DIFFERENT class than the bp P, use base P at all breakpoints. Because:
- `leading-[0.9]` sets lineHeight at base → `text-8xl` also sets lineHeight at lg → different classes → base wins
- `text-5xl` sets fontSize at base → `text-8xl` sets fontSize at lg → SAME class family (text-*) → bp wins

But distinguishing "same class family" is fragile. Let me use an even simpler rule:

**Simplest correct rule**: If the base breakpoint has property P, and a later breakpoint has a DIFFERENT value for P, keep the base value at all breakpoints. Only let bp-prefixed classes override if no base value exists.

Wait, but for `text-5xl md:text-7xl lg:text-8xl`, the base HAS a fontSize value (48px from text-5xl). The bp values are 72px and 96px. Should base win? NO! The bp values SHOULD override because they're the same concept (font-size responsive scaling).

The issue is that `text-8xl` sets BOTH fontSize AND lineHeight, while `leading-[0.9]` only sets lineHeight. The bp class setting lineHeight is a SIDE EFFECT of the font-size class, not an intentional line-height override. The intentional line-height override (`leading-[0.9]`) should win.

**Actual correct approach**: Track which CLASS produced each property value at each breakpoint. If the class that produced the base value is the SAME class family as the bp class, let bp win. If they're different class families, base wins.

Class family = the class name without responsive prefix (e.g., `text-8xl` → text, `leading-[0.9]` → leading, `p-8` → p, `font-bold` → font-bold).

This is more precise but more complex to implement. Let me think about the simplest implementation...

**Ponytail approach**: For 99% of cases, the "different class origin" check reduces to: if the base has the property and any bp has the property, keep the base value. The only case where bp should win is responsive sizing like `text-5xl md:text-7xl lg:text-8xl`, `p-4 md:p-8 lg:p-12`, `w-full md:w-1/2 lg:w-1/3`.

These are ALL cases where:
1. The SAME property family appears at multiple breakpoints
2. There's NO other class modifying the same property

So the rule can be: "base wins a property ONLY if a base-exclusive class (one that ONLY exists at base and no bp prefix) sets a value different from what the bp cascade would produce."

Implementation: after resolveCascade, for each property, if base value ≠ largest-bp value (meaning a base-exclusive class changed the base value), keep base value at all screens. Emit resets only for breakpoints that explicitly override it.

Actually wait — `text-5xl` at base gives fontSize:48px. `text-8xl` at lg gives fontSize:96px. These are DIFFERENT values. Base ≠ largest-bp. So this rule would make All Screens = 48px? That's wrong!

Hmm. The difference is that `text-5xl` is a BREAKPOINT-AWARE class (it also has md and lg variants in the class string). `leading-[0.9]` is NOT breakpoint-aware (it only appears at base).

**Final approach**: "Base class wins if it has no breakpoint-prefixed siblings in the class list."

For `text-5xl md:text-7xl lg:text-8xl`:
- `text-5xl` at base HAS bp siblings (md:text-7xl, lg:text-8xl) → bp cascade wins ✓
- fontSize: All Screens = 96px, resets at 1023px and 767px ✓

For `leading-[0.9]`:
- `leading-[0.9]` at base has NO bp siblings → base wins ✓
- But wait, `text-8xl` at lg also sets lineHeight. The check should be: "does ANY bp-prefixed class set the same property?"
- Yes, `text-8xl` at lg sets lineHeight:96px
- But `leading-[0.9]` at base has no bp siblings (no `md:leading-*` or `lg:leading-*`)
- So base wins → lineHeight: 0.9 at all breakpoints ✓

For `p-4 md:p-8`:
- `p-4` at base has bp sibling `md:p-8` → bp cascade wins
- All Screens: 32px, reset at 767px ✓

This works! The rule is:

> A property P set at the base breakpoint only wins at All Screens if **no breakpoint-prefixed class** of the same family exists in the class list.

"Same family" = same class prefix after stripping any breakpoint prefix. E.g., `text-5xl`, `md:text-7xl`, `lg:text-8xl` are all in the `text-*` family. `p-4`, `md:p-8` are in the `p-*` family. `leading-[0.9]` is alone — no `md:leading-*` or `lg:leading-*` → base wins.

### Implementation

In `mapTokens()`, track which class FAMILIES have breakpoint-prefixed entries across all breakpoints. Then in the cascade, for each property, check if the class that produced the base value belongs to a family with bp siblings.

Actually, the simpler implementation: before cascading, for each property at the base breakpoint, check if the SAME class family appears at any other breakpoint. If not → mark property as "base-exclusive wins".

Let me refine the spec with this approach.

---

Wait, I'm overcomplicating this. Let me re-read the fusion recommendation: "Kimi's per-property approach — when a base class exists for a property, use the base value as All-Screens." 

Kimi's recommendation is simpler than what I'm working through. But it has the edge case I identified: `text-5xl` at base + `text-8xl` at lg — should base fontSize win? No. So Kimi's rule needs refinement.

The refinement is: "when a **base-exclusive** class exists for a property" — i.e., a class at base that sets P and has no bp-prefixed variants in the class string.

Let me write the final, clean spec.
