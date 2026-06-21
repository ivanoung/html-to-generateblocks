---
name: add-a-new-gb-block-type
description: Extend the DOM walker to emit a new GenerateBlocks or core block type for a tag. Use when a source tag should produce a specific GB/core block but is currently stripped or misclassified.
triggers:
  - "new block"
  - "gb block"
  - "dom walker"
  - "tag mapping"
  - "core block"
edges:
  - target: context/architecture.md
    condition: for the tag → block table and where dom-walker fits in the pipeline
  - target: context/conventions.md
    condition: for canonical key order and the `<a>`/image rules
last_updated: 2026-06-21
---

# Add a New GB Block Type

## Context

Load `context/architecture.md` (the tag → block table and pipeline) and
`context/conventions.md` (canonical key order, `<a>` and captioned-image rules).
Mapping lives in `src/core/dom-walker.ts`; canonical key order comes from
`plugin/generateblocks/<block>/block.json` (or the core block reference).
`src/core/gb-whitelist.ts` gates which properties may appear in `styles`.

## Steps

1. Confirm the tag is not already mapped (see the table in `context/architecture.md`). If it is currently stripped with a warning, that is the signal to add it.
2. Decide the target block: `generateblocks/{element,text,media,shape}` or `core/{image,embed,list,quote,html}`.
3. Add the tag → block mapping in `src/core/dom-walker.ts`, following the existing tag-rule style.
4. Enforce canonical key order from `plugin/generateblocks/<block>/block.json`. Never invent an order.
5. If the block exposes new style properties, gate them in `src/core/gb-whitelist.ts` (`isGbSupported`).
6. Add a fixture in `fixtures/` (M1 `FixtureNode` or fidelity `inputHtml`) that exercises the tag, with an `expect` block (`shouldPass`, `hardFailCount`, `blockCount`).
7. If M1, add a snapshot under `tests/snapshots/` (run once to generate, then commit).
8. Run the fixture and regression:
   ```bash
   npx tsx src/cli/index.ts fixtures:run <name>
   npx tsx src/cli/index.ts regression
   ```
9. Run the relevant tests:
   ```bash
   node --import tsx --test tests/<relevant>.test.ts
   ```

## Gotchas

- **Captioned images** (`<figure>` + `<figcaption>`) → core/image, NOT generateblocks/media.
- **`<a>` handling** — text-only `<a>` → generateblocks/text (`href` in `htmlAttributes`, never `content`); `<a>` with inner blocks → generateblocks/element (tagName `a`).
- **Unknown/unsupported tags** are stripped with a warning by default — only map tags that have a real GB/core equivalent.
- **`<form>`** → core/html fallback (no GB form block).
- **Canonical key order** violations trigger WordPress "Attempt Recovery".

## Verify

- [ ] Fixture output `blockCount` matches `expect`.
- [ ] `npx tsx src/cli/index.ts regression` green (new snapshot committed).
- [ ] `node --import tsx --test tests/*.test.ts` green.
- [ ] `npm run build` (tsc) passes.
- [ ] No recovery-rule violations: no `className` in JSON, four escapes applied, canonical key order, `styles`/`css` in sync.
- [ ] Paste/save/reload in WordPress → no "Attempt Recovery".

## Debug

If the block triggers "Attempt Recovery" or fails validation, check canonical
key order against `plugin/generateblocks/<block>/block.json`, the four JSON
escapes, and that `href`/attributes are in `htmlAttributes`. Bisect by removing
blocks to isolate the failing one.

## Update Scaffold

- [ ] Add the tag → block row to `context/architecture.md` "Key Components"/DOM walker list.
- [ ] Update the Block Coverage table in README.md / DEV.md if user-facing.
- [ ] Update `.mex/ROUTER.md` "Current Project State" (Working) if a new block type now works.
- [ ] Bump `last_updated` on changed scaffold files.
