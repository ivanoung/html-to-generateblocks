# Iconify Resolver & Mixed Content Hard-Fail

**Date:** 2026-06-07
**Status:** Approved

## Problem

The `convert` command produces excessive `core/html` fallback blocks on sites that use
`<iconify-icon>` web components or have mixed content divs (raw text alongside block
children). On the MINO Digital site (fast-seo.html): 134 core/html blocks, 49
mixed-content warnings.

Root causes:
1. `<iconify-icon>` triggers "mixed content → core/html" because the DOM walker sees
   an unknown inline element + text and can't decompose.
2. Divs and semantic containers with raw text at the same level as block children
   silently fall back to core/html instead of surfacing the source problem.

## Design

Two changes, both in the `convert` pipeline:

### 1. Iconify Resolver (`src/core/iconify-resolver.ts`)

New async module inserted **between Tailwind inliner and preprocessor** in the
orchestrator. Finds all `<iconify-icon>` elements, fetches their SVG markup from
the Iconify API, and replaces them in-place so the DOM walker sees plain `<svg>`
elements.

```
rawHtml → [Tailwind inliner] → [Iconify resolver] → [Preprocess] → [DOM walk]
```

#### API

```
POST / https://api.iconify.design/{prefix}/{name}.svg
```

No auth required. Returns a plain `<svg>` element.

#### Algorithm

1. Parse HTML with cheerio, find all `<iconify-icon>` elements
2. For each, extract `icon` attribute (format: `prefix:name`, e.g. `solar:rocket`)
3. Skip if no `icon` attribute — leave element as-is
4. Check in-memory cache (`Map<string, string>`) — if cached, use cached SVG
5. Fetch `https://api.iconify.design/{prefix}/{name}.svg` (5s timeout)
6. On success: cache the SVG markup, insert into cheerio DOM replacing the
   `<iconify-icon>` node. Transfer `width`, `height`, `class`, and `style`
   attributes from `<iconify-icon>` to the `<svg>` wrapper.
7. On failure (timeout, 404, network error): leave element as-is — existing
   preprocessor logic wraps it in `core/html` as fallback
8. Return modified HTML string + warnings for any failed resolutions

#### Caching

In-memory `Map<string, string>` per conversion invocation. Same icon used
N times = 1 API call. Cache persists across the `_setup` page but not across
separate CLI invocations (acceptable — setup is one process).

#### Signature

```typescript
export interface IconifyResult {
  html: string;
  resolved: number;
  failed: string[];  // icon names that couldn't be resolved
}

export async function resolveIconifyIcons(rawHtml: string): Promise<IconifyResult>;
```

#### Attribute transfer

Original `<iconify-icon icon="solar:rocket" width="18" class="my-icon">`:
- Fetch SVG from `solar/rocket`
- Wrap in `<svg>` or use raw SVG
- Apply `width="18"` and `class="my-icon"` to outermost `<svg>`
- Ignore iconify-specific attributes (`rotate`, `flip`, `inline`)

### 2. Mixed Content → Hard Fail (DOM walker change)

Modify `walkElement` in `src/core/dom-walker.ts`. Two trigger points:

#### Path 3: Div with text + block children

Current behavior (`makeCoreHtmlFallback`): silently wraps in core/html.
New behavior: emit a `FIX_SOURCE` hard fail, skip the element entirely.

```typescript
if (hasBlockChildren && hasTextOrInline && tag === "div") {
  warnings.push(
    `FIX_SOURCE: <div> contains raw text mixed with block children. ` +
    `Wrap bare text in <span> or <p>. First 60 chars: "${textPreview}"`
  );
  return []; // produce no blocks — skips the element
}
```

#### Path 4: Semantic container with only text

Current behavior: `makeCoreHtmlFallback` when a `<section>`/`<article>`/`<header>`/
`<main>` has only text/inline content (no block children).
New behavior: same `FIX_SOURCE` hard fail, skip the element.

```typescript
if (!hasBlockChildren && (hasMeaningfulText || hasInlineElements)) {
  if (SEMANTIC_CONTAINER_TAGS.has(tag)) {
    warnings.push(
      `FIX_SOURCE: <${tag}> contains only raw text/inline content. ` +
      `Wrap text in <p> or other block tag. First 60 chars: "${textPreview}"`
    );
    return []; // produce no blocks — skips the element
  }
}
```

#### Validator integration

The existing validator already checks `hardFails.length > 0` to set
`overallStatus: "partial"`. Add a specific `FIX_SOURCE` error code that
the validator recognizes. Reports will show the exact element and text
preview so the user can locate and fix it.

### Pipeline Order (updated)

```
Stage 0: Tailwind inliner (async, Playwright)
Stage 0.5: Iconify resolver (async, fetch)
Stage 1: Preprocess (sync, cheerio)
Stage 2: Global styles collector registration (sync)
Stage 3: DOM walk (sync, cheerio) ← mixed-content hard-fail lives here
Stage 4: Serialize (sync)
Stage 5: Validate (sync)
```

All core/html fallback paths that remain after this change are intentional:
- `data-gb-wrap="core-html"` markers (preprocessor + user-placed)
- `<form>`, `<style>`, unresolvable `<iconify-icon>` (preprocessor)
- `<iframe>`, `<video>`, `<audio>`, `<canvas>`, `<picture>`, `<table>` (CORE_HTML_TAGS)
- Unrecognized tags like `<path>`, `<polygon>`, `<line>` (SVG children)

## Source Cleanup (User Responsibility)

Before conversion, clean the source HTML using this prompt (documented in README):

> Scan all HTML files. Find any element (section, article, aside, header, main,
> div) where raw text sits at the same level as block children — i.e., text not
> wrapped in `<p>`, `<span>`, `<h1>`–`<h6>`, or other tags. For each, wrap the
> bare text in the smallest appropriate tag: `<span>` for short inline phrases,
> `<p>` for sentences and paragraphs. Do not touch elements where all text is
> already properly wrapped. Show each change as a diff before applying.

## Marker System (`data-gb-wrap="core-html"`)

Users can explicitly mark any element to be preserved as raw HTML by adding
`data-gb-wrap="core-html"` to the source. The DOM walker treats these as
core/html passthrough blocks — no decomposition, no warnings. This is already
implemented and works; it just needs documentation.

## Expected Impact (MINO Digital)

| Before | After |
|---|---|
| iconify-icon → mixed content | iconify-icon → SVG → gb/shape |
| Div mixing text + blocks → silent core/html | → `FIX_SOURCE` hard fail, user fixes source |
| Section with bare text → silent core/html | → `FIX_SOURCE` hard fail, user fixes source |
| 134 core/html blocks (fast-seo) | ~40 (only intentional: forms, iframes, markers) |
| 49 mixed-content warnings | 0 (hard fails replace them) |

## Files Changed

| File | Change |
|---|---|
| `src/core/iconify-resolver.ts` | New module — Iconify API integration |
| `src/core/orchestrator.ts` | Insert resolver call between Stage 0 and Stage 1 |
| `src/core/dom-walker.ts` | Replace silent fallback with hard fail for Path 3 + 4 |
| `README.md` | Add Pre-Conversion Checklist section with cleanup prompt and marker docs |

## Out of Scope / Future

- **Broader mixed-content decomposition**: teaching the walker to decompose
  mixed divs instead of hard-failing. This is complex (requires understanding
  implicit structure borders) and error-prone with heuristics. Future
  consideration: LLM-as-judge reviewing walker output for structural correctness.
- **Disk caching for Iconify API**: icons persist across CLI invocations.
- **Other web components** (`<fa-icon>`, `<custom-badge>`, etc.): same problem
  pattern. The iconify resolver could be generalized to a web-component resolver
  later, but the marker system handles these today.
