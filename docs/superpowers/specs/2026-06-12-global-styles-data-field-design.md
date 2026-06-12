# Global Styles `data` Field — Design Spec

**Date:** 2026-06-12  
**Status:** Design approved — ready for implementation planning  

## Problem

`global-styles.json` entries produced by `css-splitter.ts` render correctly in
the browser but are **non-editable** in the GenerateBlocks editor UI. Style
panel controls show empty/unpopulated.

### Root Cause

GB stores each global style as a `gblocks_styles` custom post with three
meta fields (confirmed from `class-styles-post-type.php`):

| Meta Key | Content | Makes styles… |
|---|---|---|
| `gb_style_selector` | `.flex` | Selectable |
| `gb_style_css` | `.flex{display:flex}` | Renderable |
| `gb_style_data` | `{"display":"flex"}` | **Editable** |

The `gb_style_data` field (exposed as `data` in JSON imports) bridges raw CSS
and the editor's style panels. It uses **camelCase** expanded property keys.
Without it, GB renders CSS from `gb_style_css` but cannot populate the editor
controls — which is exactly the behavior observed.

Our `css-splitter.ts` outputs only `{name, selector, css}` — no `data` field.

## Solution

### Core idea

Add a **gate check** in `css-splitter.ts`: before promoting a CSS rule to
Global Styles, verify that **every property** in the rule maps to a GB editor
panel. If even one property cannot be mapped, demote the entire rule to
`styles-unique.css`.

This gives a simple invariant: **every Global Style entry is 100% editable
in the GB editor.** No silent property loss on edit.

### New function: `generateStyleData()`

Takes a CSS rule string → returns the `data` object, or `null` if the gate fails.

```
Input:  ".flex{display:flex;gap:16px;padding:24px;border:2px solid red}"
Process:
  1. Parse declarations with `css` npm package
  2. Expand shorthand properties to longhands
  3. Convert kebab-case → camelCase  
  4. Check every expanded property against GB_DATA_PROPERTIES set
  5. If all pass → return data object
  6. If any fail → return null (gate failed)
Output: { display:"flex", gap:"16px", paddingTop:"24px", … borderLeftColor:"red" }
```

### Shorthand expansion

| Shorthand | Expands to |
|---|---|
| `padding` | `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` |
| `margin` | `marginTop`, `marginRight`, `marginBottom`, `marginLeft` |
| `border` | `borderTopWidth`, `borderRightWidth`… `borderLeftColor` (12 props) |
| `border-width` | `borderTopWidth`, `borderRightWidth`, `borderBottomWidth`, `borderLeftWidth` |
| `border-style` | `borderTopStyle`, `borderRightStyle`, `borderBottomStyle`, `borderLeftStyle` |
| `border-color` | `borderTopColor`, `borderRightColor`, `borderBottomColor`, `borderLeftColor` |
| `border-radius` | `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius` |
| `flex` | `flexGrow`, `flexShrink`, `flexBasis` |
| `gap` | `rowGap`, `columnGap` (if value has two parts) |
| `inset` | `top`, `right`, `bottom`, `left` |
| `overflow` | `overflowX`, `overflowY` (if value has two parts) |

Unrecognized values (e.g., `padding: var(--foo)`) are expanded as-is:
`paddingTop: "var(--foo)"` — we don't attempt CSS resolution.

### GB_DATA_PROPERTIES set

Confirmed from `styles-builder.js` — these are the camelCase keys GB's
editor panels read from `gb_style_data`:

```
display  position  zIndex  overflow  overflowX  overflowY
width  height  minWidth  maxWidth  minHeight  maxHeight  aspectRatio

flexDirection  flexWrap  flexGrow  flexShrink  flexBasis
alignItems  alignSelf  alignContent
justifyContent  justifyItems  justifySelf  order

gridTemplateColumns  gridTemplateRows  gridAutoColumns  gridAutoRows  gridAutoFlow

marginTop  marginRight  marginBottom  marginLeft
paddingTop  paddingRight  paddingBottom  paddingLeft
gap  columnGap  rowGap

borderTopWidth  borderRightWidth  borderBottomWidth  borderLeftWidth
borderTopStyle  borderRightStyle  borderBottomStyle  borderLeftStyle
borderTopColor  borderRightColor  borderBottomColor  borderLeftColor
borderTopLeftRadius  borderTopRightRadius  borderBottomRightRadius  borderBottomLeftRadius

fontFamily  fontSize  fontWeight  fontStyle  textTransform
textDecoration  lineHeight  letterSpacing  textAlign  color

backgroundColor  backgroundImage  backgroundSize  backgroundPosition  backgroundRepeat
boxShadow  textShadow  opacity  transform
top  right  bottom  left
objectFit  objectPosition
```

### Properties that systematically fail the gate

These appear in Tailwind utilities but have no GB editor panel equivalent.
Any rule containing one of these is demoted to `styles-unique.css`:

```
box-sizing  float  clear  visibility  container-type  container-name
text-indent  white-space  word-break  overflow-wrap  vertical-align
direction  writing-mode  font-variant  word-spacing
outline  outline-width  outline-style  outline-offset  outline-color
inset-block  inset-inline  place-items  place-content  place-self
```

### Revised walkRule() flow

```
Current:
  classifyDeclarations() → "gs" → globalStyles.push({name, selector, css})

New:
  classifyDeclarations() → "gs"
    → data = generateStyleData(css)
      → data !== null? → globalStyles.push({name, selector, css, data})
      → data === null? → uniqueCssParts.push(rule)  // gate failed → demote
```

### Net effect on output

- `global-styles.json`: **fewer entries** (only fully-editable classes), each with `data`
- `styles-unique.css`: **larger** (absorbs demoted classes)
- Frontend rendering: **unchanged** — all CSS still loads, just through different channels
- Editor experience: Global Styles that exist are now fully editable

### Trade-off: split vs reject

An alternative considered was to **split** mixed rules — send GB-mappable
properties to Global Styles and unmappable ones to `styles-unique.css` under
the same selector. While CSS cascade would handle this correctly (no property
overlap), it creates **partially editable** global styles — the user sees
the visual effect of `box-sizing:border-box` but can't touch it in the editor.
This is worse than demoting the class entirely. **We choose D (reject entire
rule): the invariant "every Global Style is 100% editable" is more valuable
than squeezing a few extra entries out of mixed-property rules.**

## Test Fixture

A minimal HTML page in `output/global-style-investigation/`:

```
output/global-style-investigation/
├── source.html                    # Test HTML (input)
├── setup/global-styles.json       # Generated global styles (output)
└── pages/index.html               # Generated block markup (output)
```

**source.html** structure:
- Outer container `<div>` wrapping an inner container `<div>`
- Inside inner: two-column grid (`display:grid; grid-template-columns:1fr 1fr`), two boxes
- Each box: `<h2>` + `<p>` with Tailwind utility classes for typography
- Uses `.grid`, `.grid-cols-2`, `.gap-4`, `.p-6`, `.text-lg`, `.font-bold`

Process via `convert` (project mode), then inspect `global-styles.json` to
confirm entries include `data` fields with correct camelCase expanded
properties.

## Files Changed

### Modify: `src/core/css-splitter.ts`

- Add `GB_DATA_PROPERTIES` constant (ReadonlySet of camelCase property names)
- Add `generateStyleData(rule: css.Rule): Record<string, string> | null`
- Modify `walkRule()`: gate check before pushing to globalStyles
- Update `GlobalStyleEntry` interface: add optional `data` field
- Modify `merge` logic to preserve `data` on deduplication

### No change to:
- `src/core/types.ts` — `GlobalStyleEntry` already has `data: Record<string, unknown>`
- `src/core/orchestrator.ts` — `splitCss()` is called post-pipeline, not in the orchestrator
- `src/cli/index.ts` — `splitCss()` signature unchanged (data is an addition to output)

## Testing Strategy

### Manual validation

1. Create test fixture (`source.html`) with known Tailwind classes
2. Run `npx tsx src/cli/index.ts convert output/global-style-investigation/source.html`
3. Inspect `setup/global-styles.json` — confirm entries have `data` with correct expanded camelCase properties
4. Confirm classes with non-GB properties (like `box-sizing`) are absent from `global-styles.json` and present in `styles-unique.css`
5. Import into WordPress GB Global Styles admin → verify editor panels populate

### Unit tests (deferred to implementation plan)

- `generateStyleData` with various CSS rule inputs
- Gate rejection for rules containing non-GB properties
- Shorthand expansion correctness
- Empty rule handling
- Multi-value shorthand parsing (e.g., `padding: 10px 20px 30px 40px`)

## Scope Boundaries

**In scope:**
- `generateStyleData()` function and GB_DATA_PROPERTIES constant
- Gate check in `walkRule()`
- Shorthand expansion for padding, margin, border, border-width, border-style, border-color, border-radius, flex, gap, inset, overflow
- Test fixture creation
- Manual validation against WordPress

**Out of scope:**
- Responsive/breakpoint data (mobile, tablet variants in `data`)
- Pseudo-class data (`:hover`, `:focus`) 
- CSS variable resolution (pass through as-is)
- Auto-import into WordPress (existing snippet/plugin handles this)
- Changing the per-block `globalClasses` mechanism — this is orthogonal

## Self-Review

1. **Placeholder scan:** No TBD, TODO, or incomplete sections.
2. **Internal consistency:** Gate check invariant (all properties must map) ensures no silent loss. GB_DATA_PROPERTIES verified against styles-builder.js. Shorthand expansion covers all shorthands used by Tailwind utilities the CSS splitter processes.
3. **Scope check:** Single focused change to `css-splitter.ts`. Test fixture is minimal and targeted. No unrelated refactoring.
4. **Ambiguity check:** Gate behavior is binary (pass all or reject entirely). Shorthand expansion behavior is explicit per shorthand, including edge case for multi-value values.
