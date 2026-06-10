# Inline Style → GB Attribute Promotion — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

When inline `style="..."` attributes on vanilla HTML contain properties that
GenerateBlocks exposes as dedicated top-level attributes (notably backgrounds
and colors), promote those properties out of the flat `styles` JSON object into
the actual attributes GB's editor UI panels read from.

This fixes the gap where `background-color`, `background-image`, `color`, and
gradients silently land in `styles` but never populate the GB editor UI because
GB looks for `backgroundColor`, `bgImage`, `bgOptions`, `textColor`, etc. as
top-level block attributes.

**Scope:** Backgrounds and text color only. Spacing/typography/layout promotion
is deferred to follow-up iterations.

## Architecture

```
parseStyleString()          (unchanged)
       ↓
  styles: { backgroundColor, backgroundImage, color, paddingTop, ... }
       ↓
  buildElementAttrs()       (MODIFIED — calls mapper before assembly)
       ↓
  gb-attribute-mapper.ts    (NEW — extracts GB attrs from styles)
       ↓
  { gbAttrs, remainingStyles }
       ↓
  Serialized block JSON     (backgroundColor, bgImage, bgOptions, textColor as top-level)
```

## Components

### New: `src/core/gb-attribute-mapper.ts`

Single exported function:

```ts
export function mapStylesToGbAttributes(styles: BlockStyles): {
  gbAttrs: Record<string, unknown>;
  remainingStyles: BlockStyles;
}
```

**Input:** The `styles` object from `parseStyleString()` (camelCase keys).

**Output:** Two objects:
1. `gbAttrs` — GB top-level attributes ready to merge into the block
2. `remainingStyles` — everything that wasn't promoted, continues as `styles`

### Mappings (this iteration)

| styles key | GB attribute(s) | Logic |
|---|---|---|
| `backgroundColor` | `backgroundColor: string` | Pass through as-is (already hex) |
| `backgroundImage` | `bgImage: { url: string }` + `bgImageSize: "full"` | Extract URL from `url("...")` |
| `backgroundSize` | `bgOptions.size: string` | Pass through (e.g., `"cover"`) |
| `backgroundPosition` | `bgOptions.position: string` | Pass through (e.g., `"center"`) |
| `backgroundRepeat` | `bgOptions.repeat: string` | Pass through (e.g., `"no-repeat"`) |
| `backgroundAttachment` | `bgOptions.attachment: string` | Pass through (e.g., `"fixed"`) |
| `color` | `textColor: string` | Pass through (hex) |
| `background` (gradient) | `gradient: true` + `gradientDirection` + `gradientColorOne` + `gradientColorTwo` | Parse `linear-gradient(angle, color1, color2)` |

**bgOptions defaults** (always set when any background-image option is present):
- `selector: "element"`
- `opacity: 1`
- `overlay: false`
- Missing options use their existing values or GB defaults

**Not mapped (stay in remainingStyles for now):**
- `background-color` as a simple color (already handled by `backgroundColor`)
- All spacing: `padding`, `margin`, `paddingTop`, etc.
- All layout: `display`, `flexDirection`, `alignItems`, etc.
- All typography: `fontSize`, `fontFamily`, etc.
- All borders: `borderRadius`, etc.
- All sizing: `width`, `height`, etc.

### Modified: `src/core/serializer.ts` — `buildElementAttrs()`

Before the existing attribute assembly, call the mapper:

```ts
const { gbAttrs, remainingStyles } = mapStylesToGbAttributes(block.styles);
Object.assign(attrs, gbAttrs);
// Use remainingStyles (without promoted properties) instead of original styles
const stylesEmpty = !remainingStyles || Object.keys(remainingStyles).length === 0;
attrs.styles = stylesEmpty ? {} : remainingStyles;
```

## Data Flow

```
HTML: <div style="background-color:#fff;background-image:url(hero.jpg);padding:64px">
  │
  ▼ parseStyleString()
  styles: { backgroundColor: "#fff", backgroundImage: "url(hero.jpg)", paddingTop: "64px", ... }
  css: "background-color:#fff;background-image:url(hero.jpg);padding-top:64px;..."
  │
  ▼ mapStylesToGbAttributes(styles)
  gbAttrs: { backgroundColor: "#fff", bgImage: { url: "hero.jpg" }, bgImageSize: "full", 
             bgOptions: { selector: "element", opacity: 1, overlay: false, size: "cover", ... } }
  remainingStyles: { paddingTop: "64px", ... }
  │
  ▼ buildElementAttrs()
  attrs: { uniqueId, tagName, backgroundColor, bgImage, bgImageSize, bgOptions, 
           styles: { paddingTop: "64px" }, css: "...", globalClasses, htmlAttributes }
  │
  ▼ serializeAttributes()
  WordPress block JSON with promoted background attributes
```

## Error Handling

- **Missing URL in background-image:** If the value doesn't match `url("...")`, leave it in `remainingStyles` and emit a warning
- **Unparseable gradient:** If `background` value isn't a recognizable `linear-gradient(...)`, leave it in `remainingStyles` and emit a warning
- **Empty styles:** If all properties were promoted, `remainingStyles` is `{}` — the serializer already handles empty styles correctly
- **No crash path:** The mapper is a pure transformation; any unhandled property stays in `remainingStyles` and falls through to the existing `styles`/`css` behavior

## Testing

### New test: `tests/gb-attribute-mapper.test.ts`

- Background color promotion (`backgroundColor → backgroundColor`)
- Background image promotion (`backgroundImage → bgImage + bgImageSize`)
- Background options promotion (`backgroundSize/Position/Repeat/Attachment → bgOptions`)
- Text color promotion (`color → textColor`)
- Gradient parsing (`background: linear-gradient(135deg, #fff, #000) → gradient + colors`)
- Partial mapping (some properties promoted, others stay)
- Empty input (returns empty gbAttrs, empty remainingStyles)
- No properties mappable (all stay in remainingStyles)

### Existing tests (59 total)

- Should all pass unchanged
- The mapper only runs on `generateblocks/element` blocks during serialization
- M1 fixtures don't exercise background promotion (no inline background styles)
- Fidelity fixtures with inline styles on text headings — unaffected (text blocks use `buildTextAttrs`, not `buildElementAttrs`)

## What This Does NOT Change

- `parseStyleString()` — unchanged
- `STYLES_PROPERTIES` set — unchanged
- DOM walker, preprocessor, tailwind-inliner, CSS splitter — zero changes
- M1 pipeline (mapper.ts) — zero changes
- Text blocks, media blocks, shape blocks — no promotion, those blocks don't have these GB attributes
- Core blocks — no promotion, they don't use GB's attribute model
- Tailwind-class-sourced styles — unchanged, they continue through the class → globalClasses → CSS splitter path

## Future Extension Points

The mapper is designed for easy extension. Each new property category is a new block in the `mapStylesToGbAttributes` function:

**Typography (next iteration):**
- `fontSize: "48px"` → `fontSize: 48, fontSizeUnit: "px"`
- `fontFamily: "Inter"` → `fontFamily: "Inter"`
- `fontWeight: "700"` → `fontWeight: "700"`
- `textTransform: "uppercase"` → `textTransform: "uppercase"`
- `lineHeight: "1.5"` → `lineHeight: 1.5`
- `letterSpacing: "0.02em"` → `letterSpacing: 0.02`
- `textAlign: "center"` → `alignment: "center"`

**Spacing (future iteration):**
- `paddingTop: "64px"` → `paddingTop: "64px"` (already top-level in GB)
- `marginBottom: "24px"` → `marginBottom: "24px"`

**Layout (future iteration):**
- `display: "flex"` → `display: "flex"`
- `flexDirection: "column"` → `flexDirection: "column"`
- And so on...

Each iteration is a small, focused change to the mapper — no cascade into other parts of the system.
