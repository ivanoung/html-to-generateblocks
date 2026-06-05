# Embed Block Support — Design Spec

**Date:** 2026-06-05
**Status:** Design — pending review

---

## Problem

When a section manifest marks an element with `role: "embed"` (e.g., code-diff component, contact form), the `html-to-ir.ts` converter creates an IRNode with raw HTML in the `html` field and `fallbackPolicy: "core"`. However, `ir-planner.ts` has no code path for `core/html` blocks — it falls through to `planContainer()` which produces an empty `generateblocks/element` with no content.

**Result:** Embed sections render as empty containers. All content is lost.

## Solution

Add a check in `planContainer()`: if the node has `fallbackPolicy === "core"` and carries an `html` payload, route to a new `planCoreHtml()` function that produces a `core/html` block.

### Code changes

**File:** `src/core/ir-planner.ts` (only file changed)

**Add:** `planCoreHtml()` function (~15 lines)
**Modify:** `planContainer()` — add early-return gate at top (~5 lines)

### `planContainer` gate

```typescript
function planContainer(node: IRNode, errors: string[]): PlanResult {
  // Route embed containers to core/html
  if (node.fallbackPolicy === "core" && node.html) {
    return planCoreHtml(node, errors);
  }
  // ... existing container logic unchanged
}
```

### `planCoreHtml` function

```typescript
function planCoreHtml(node: IRNode, errors: string[]): PlanResult {
  // Collect HTML from self and direct children with html payloads
  const htmlFragments: string[] = [];
  if (node.html) htmlFragments.push(node.html);
  for (const child of node.children) {
    if (child.html) htmlFragments.push(child.html);
  }

  return {
    blocks: [{
      blockName: "core/html",
      uniqueId: nextId("core"),
      html: htmlFragments.join("\n"),
      styles: {},
      css: "",
      innerBlocks: [],
      idGenType: "core",
    }],
    errors,
  };
}
```

### Why `block.html` not `block.content`

The existing serializer (`serializer.ts:376`) reads `block.html` for `core/html` blocks via `renderCoreHtmlHtml()`. Using `block.content` would be silently ignored.

### Existing support in serializer

Already verified:
- `case "core/html"` at line 375 → routes to `renderCoreHtmlHtml()`
- `renderCoreHtmlHtml(block)` at line 303 → returns `block.html ?? ""`
- Line 389: `core/html` blocks with empty JSON attrs get clean `<!-- wp:core/html -->` delimiters

No serializer changes needed.

## Edge cases

| Input | Behavior |
|---|---|
| Container with `html` on self | Embed self.html |
| Container with `html` on child nodes | Collect and join with newlines |
| Container with no `html` (normal GB element) | Falls through to existing `planContainer` |
| Container where html is empty string `""` | Empty `core/html` block (harmless) |
| Nested containers with mixed html/non-html children | Only html-carrying children embedded |

## Testing

### Unit test

Feed an IRNode with `fallbackPolicy: "core"` and `html: "<div>test</div>"` into `planBlocks()` — expect output block with `blockName: "core/html"` and `html: "<div>test</div>"`.

### Integration test

Re-run MINO page conversion. Verify:
- `hero` section: right-column code-diff embed appears as `core/html` block with resolved inline styles
- `contact` section: terminal form appears as `core/html` block
- `services` section: `iconify-icon` embeds produce `core/html` blocks

## Non-goals

- Not adding a new `IRNodeType` — uses existing `container` type
- Not changing the serializer
- Not changing `html-to-ir.ts`
- Not handling CSS variable resolution in embeds (separate gap)
