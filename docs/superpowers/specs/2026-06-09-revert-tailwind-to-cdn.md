# Revert Tailwind Compilation to CDN (Playwright)

> **Status:** Design approved — ready for implementation plan

**Goal:** Replace offline CLI-based Tailwind compilation with the original CDN-based approach (Playwright browser). The CDN compiles CSS from the live DOM, producing more complete and accurate CSS than the CLI's static content scanning.

**Architecture:** Concatenate all source HTML pages' body content into a single document, load in Playwright with Tailwind CDN script, capture compiled `<style>` blocks. Merge with preprocessor-extracted custom CSS.

---

## How It Works

1. **Concatenate pages** — strip `<html>`, `<head>`, `<body>` wrappers from each source page, keep body content with `<!-- page:name -->` markers
2. **Build CDN document** — wrap in minimal HTML with `<script src="https://cdn.tailwindcss.com">` and the extracted `tailwind.config`
3. **Load in Playwright** — wait for Tailwind CDN to compile (detect when a known utility class has computed styles)
4. **Extract CSS** — grab ALL `<style>` block text content (Tailwind compiled + any inline custom CSS)
5. **Merge** — combine with preprocessor's `customCss` (extracted from `<head>` `<style>` blocks)

## Implementation Files

### Modify: `src/core/tailwind-inliner.ts`

Add `inlineTailwindMultiPage(htmls: string[], pageNames: string[]): Promise<InlinerResult>`:

```typescript
export async function inlineTailwindMultiPage(
  pageHtmls: string[],
  pageNames: string[],
): Promise<InlinerResult> {
  // 1. Concatenate body content with markers
  const bodyParts = pageHtmls.map((html, i) => {
    // Extract body content (everything between <body> and </body>)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    return `<!-- page:${pageNames[i]} -->\n${body}`;
  });
  const combinedBody = bodyParts.join("\n\n");

  // 2. Extract tailwind config from first page
  const configJson = extractTailwindConfig(pageHtmls[0]) || "{}";

  // 3. Build CDN document
  const cdnDoc = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = ${configJson}</script>
</head><body>
${combinedBody}
</body></html>`;

  // 4. Load in Playwright and extract CSS (reuse existing logic)
  return compileWithPlaywright(cdnDoc);
}
```

Refactor existing `inlineTailwindStyles` to share the Playwright loading logic via a private `compileWithPlaywright(html: string)` function.

### Modify: `src/cli/index.ts`

In project mode, replace:
```typescript
const result = compileTailwindOffline(tailwindConfig, [contentPattern], process.cwd());
```
With:
```typescript
const compiled = await inlineTailwindMultiPage(
  pageContents.map(pc => pc.html),
  pageContents.map(pc => pc.name),
);
inlinerCss = compiled.stylesCss;
```

### Existing code unchanged

- `tailwind-resolver.ts` — `compileTailwindOffline` kept for single-page/fixture use
- `preprocessor.ts` — custom CSS extraction unchanged
- `css-splitter.ts` — split happens on the same `combinedCss` regardless of source

## Scope Boundaries

**In scope:** Revert project-mode Tailwind compilation to CDN-based approach.

**Out of scope:** Fixing slate shade config, fixing custom CSS class definitions, changing the split logic.
