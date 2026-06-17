# Manual Steps Reporter — Redesign

> **Status:** Spec — approved for implementation

**Goal:** Replace ~200 lines of fragile string-pushing with a step registry that auto-numbers, conditionally shows/hides steps, and is insertion-stable.

**Architecture:** A `StepRegistry` holds ordered `Step` objects. `generateReport(ctx)` filters by condition, auto-numbers, groups by category, and renders. Context carries all detection results.

---

## Step Interface

```ts
interface Step {
  id: string;                              // kebab-case, stable
  category: "import" | "enqueue" | "per-page";
  condition?: (ctx: Context) => boolean;
  render: (ctx: Context) => string[];
}
```

## Categories

| Category | Header | Purpose |
|---|---|---|
| `import` | "IMPORT — One-Time Setup" | Files to import into WordPress (Global Styles, CSS, JS, Customizer) |
| `enqueue` | "ENQUEUE — Site-Wide" | Fonts, document-level CSS — conditional on detection |
| `per-page` | "PER PAGE — For Each Page" | Paste blocks, replace images |

## Context

```ts
interface Context {
  fonts: string[];
  externalImages: string[];
  hasNav: boolean;
  hasIconify: boolean;
  inventory?: GlobalSelectorInventory;
  customizerExists: boolean;
  appJsExists: boolean;
}
```

## Step Registry (registration order = output order)

| # | ID | Category | Condition | Output |
|---|---|---|---|---|
| 1 | `import-css-import` | import | always | Import `global-styles-import.json` → GB → Global Styles |
| 2 | `import-css-unique` | import | always | Add `styles-unique.css` via WPCodeBox |
| 3 | `import-js` | import | `appJsExists` | Add `setup/global.js` via WPCodeBox |
| 4 | `import-customizer` | import | `customizerExists` | Import `customizer-import.json` → Customizer |
| 5 | `enqueue-fonts` | enqueue | `fonts.length > 0` | Google Fonts enqueue options |
| 6 | `enqueue-global-css` | enqueue | `inventory.rules.length > 0` | Document-level CSS rules |
| 7 | `per-page-blocks` | per-page | always | Paste blocks into WP code editor |
| 8 | `per-page-images` | per-page | `externalImages.length > 0` | Replace external image URLs |

## Output Format

```
============================================
  MANUAL STEPS — Post-Conversion Checklist
============================================

=== IMPORT — One-Time Setup ===

1. Import Global Styles
   Import setup/global-styles-import.json into
   GenerateBlocks → Global Styles. This imports all
   editable utility classes with color values resolved.

2. Add Remaining CSS
   Add setup/styles-unique.css via WPCodeBox (not
   Additional CSS — WordPress strips selectors like *,
   escaped colons, and some pseudo-elements).

   (conditional: 3. Add JavaScript, 4. Import Customizer)

=== ENQUEUE — Site-Wide ===

(conditional: 5. Google Fonts, 6. Global Document Styles)

=== PER PAGE — For Each Page ===

7. Paste Blocks
   Open WordPress Code Editor (Ctrl+Shift+Alt+M).
   For each page in pages/, copy contents and paste.

(conditional: 8. Replace External Images)
```

## Test Strategy

- **Step registry:** insert, remove, reorder steps — verify auto-numbering
- **Conditional rendering:** steps with false condition are excluded, numbers adjust
- **Output parity:** diff old vs new output for mino and hkvc — identical structure, improved content
