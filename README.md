# html-to-generateblocks

Convert clean HTML/CSS/JS sites into WordPress paste-ready GenerateBlocks & Core block markup. Tailwind or vanilla CSS — both work.

📺 **[Watch the demo →](https://www.boomshare.ai/shared/01KVJWQBK46FQYP6MSM)** (3:54 showcase)

> **Status:** v0.2 — Dual-output pipeline (fallback + processed) with self-verification.
> Tailwind utility classes mapped to GB inline `styles` for editor-editable blocks.
> Vanilla CSS sites supported (styles stay as class-based CSS).

## Scope

**In scope:**
- Clean HTML/CSS/JS sites — hand-written or framework-generated
- Tailwind CSS sites (utility classes mapped to GB `styles`)
- Vanilla CSS sites (classes preserved, CSS split into `styles-unique.css`)

**Out of scope (need cleanup pass first):**
- Squarespace exports (component-scoped `[data-definition-name]` selectors, 26+ stylesheets)
- Wix / Webflow exports (proprietary component systems)
- Sites with messy markup that needs human cleanup before conversion

## Quick Start

```bash
# Prerequisites: Node.js 18+, Chromium (npx playwright install chromium)
npm install

# Convert a single HTML page
npx tsx src/cli/index.ts convert inputs/mino/index.html

# Convert an entire project (all pages in directory) with CSS split
npx tsx src/cli/index.ts convert inputs/mino/ --split

# Verify processed output against fallback (layout fidelity check)
npx tsx src/cli/verify.ts --output output/mino

# Check CSS coverage (which DOM classes have CSS support)
npx tsx src/cli/verify.ts --output output/mino --coverage
```

## Pipeline

```
Input HTML/CSS/JS
    │
    ▼
[Tailwind inliner]    ← compiles Tailwind via CDN → styles.css
    │                   (skipped if no tailwind.config found)
    ▼
[verify-prepare]      ← parses styles.css → classNameToProperties map
    │
    ▼
[DOM walker]          ← walks DOM, creates GB blocks
    │   ├─ fallback/    ALL classes in globalClasses, styles.css present
    │   └─ processed/   mapped classes → styles, unmapped → globalClasses
    │
    ▼
[CSS splitter]        ← splits styles.css into:
    │   ├─ tailwind-utilities.css   (unmapped utility classes)
    │   └─ styles-unique.css        (structured styles + unique CSS)
    │
    ▼
[Serializer]          ← styles + css synced (editor + frontend match)
    │
    ▼
output/{project}/
├── fallback/              ← pixel-perfect reference (styles.css)
│   ├── pages/*.html
│   ├── styles.css
│   └── app.js
└── processed/             ← editor-ready (inline styles + split CSS)
    ├── pages/*.html
    └── setup/
        ├── tailwind-utilities.css
        └── styles-unique.css
```

## Block Coverage

| GB Block | Status |
|---|---|
| `generateblocks/element` | ✅ Containers, sections, nav, footer, links |
| `generateblocks/text` | ✅ All tag variants, CTA pattern, rich inline, headings |
| `generateblocks/media` | ✅ Images, responsive |
| `generateblocks/shape` | ✅ SVG icons |

| Core Block | Status |
|---|---|
| `core/image` | ✅ Captioned images |
| `core/embed` | ✅ YouTube provider |
| `core/list` | ✅ Unordered lists |
| `core/quote` | ✅ With citation |
| `core/html` | ✅ Raw HTML fallback (forms, SVGs, illustrations) |

## Tailwind Class → GB Style Mapping

Mappable classes convert to GB inline `styles` (editor-editable):

| Category | Classes | Status |
|---|---|---|
| Layout | `flex`, `grid`, `gap-*`, `items-*`, `justify-*`, `grid-cols-*` | ✅ Mapped |
| Spacing | `p-*`, `px-*`, `py-*`, `m-*`, `mx-auto`, `space-*` | ✅ Mapped |
| Sizing | `w-*`, `h-*`, `min/max-w/h-*`, fractions | ✅ Mapped |
| Positioning | `fixed/absolute/relative/sticky`, `top/left/right/bottom/inset`, `z-*` | ✅ Mapped |
| Borders | `border`, `border-t/r/b/l`, `border-dashed`, `rounded-*` | ✅ Mapped |
| Typography | `text-xs`→`text-9xl`, `font-weight`, `text-align`, `tracking-*`, `leading-*`, `uppercase`, `italic`, `underline` | ✅ Mapped |
| Effects | `shadow-*`, `opacity-*`, `backdrop-blur-*`, `rotate-*`, `scale-*` | ✅ Mapped |
| Colors | `bg-*`, `text-*`, `border-*` with colors | ❌ Skipped (CSS variables) |
| State | `hover:*`, `focus:*`, `group-hover:*` | ❌ Skipped (pseudo-classes) |
| Transitions | `transition-*`, `duration-*`, `animate-*` | ❌ Skipped (no GB equivalent) |

Unmapped classes stay in `globalClasses` and rely on `tailwind-utilities.css` for CSS support.

## Responsive System

Tailwind is mobile-first (min-width). GenerateBlocks is desktop-first (max-width). The converter inverts the cascade:

- Largest Tailwind breakpoint value → GB "All Screens"
- Downward breakpoints → `@media(max-width: N-1px)` resets
- `styles` (editor) and `css` (frontend) kept in sync — both contain `@media` blocks

## Verification

```bash
# Layout fidelity: compare mapper output against processed styles
npx tsx src/cli/verify.ts --output output/mino

# CSS coverage: which DOM classes have CSS in tailwind-utilities.css
npx tsx src/cli/verify.ts --output output/mino --coverage
```

The verifier re-runs the mapper on each fallback block's `globalClasses` and compares against the processed block's `styles`. Zero discrepancies = layout-faithful conversion.

## Known Limitations

- **Color classes** (`bg-primary`, `text-slate/80`, `border-seafoam/40`) rely on `--tw-*` CSS custom properties and opacity modifiers. These CANNOT be mapped to GB inline styles — they remain as utility classes requiring `tailwind-utilities.css`.
- **State modifiers** (`hover:`, `focus:`, `group-hover:`, `peer-*`) have no GB inline equivalent. They stay in `globalClasses` with CSS support.
- **Transition/animation classes** (`transition-colors`, `duration-300`, `animate-pulse`) have no direct CSS property mapping in GB's inline styles. They remain as utility classes.
- **Font families from Tailwind config** (`font-display`, `font-mono`) stay in `globalClasses` — the mapper cannot access config-defined font-family values dynamically.
- **`leading-*` + responsive `text-*` cascade**: when a base `leading-[0.9]` is used with `lg:text-8xl` (which sets lineHeight as a side effect), the V3 cascade picks the largest breakpoint value. See `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md` for details.
- **Squarespace/Wix/Webflow exports**: need a cleanup pass before conversion (proprietary component systems, attribute-selector CSS).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). For internal development details (directory layout, fixture catalog, design decisions, verification workflow), see [`DEV.md`](./DEV.md).

## License

MIT
