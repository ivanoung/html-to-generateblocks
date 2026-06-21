---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-06-21
---

# html-to-generateblocks (gb-converter)

## What This Is

Converts clean HTML/CSS/JS sites (Tailwind or vanilla CSS) into WordPress paste-ready GenerateBlocks & Core block markup via a dual-output (fallback + processed) pipeline with self-verification.

## Non-Negotiables

- Never put `className` in GB block JSON — use the `globalClasses` array and `htmlAttributes`.
- No descendant selectors, no `transition`, and no hover rules in a block's `css` (except documented exceptions).
- Text `<a>` blocks: `href` goes in `htmlAttributes`, never in `content`.
- Captioned images → core/image, not generateblocks/media.
- Apply the four JSON escapes (`--` → `\u002d\u002d`, `&` → `\u0026`, `<` → `\u003c`, `>` → `\u003e`) and canonical key order per block type (from `plugin/generateblocks/<block>/block.json`).
- Keep `styles` (editor, camelCase) and `css` (frontend, kebab/sorted/minified) in sync — editor preview must match frontend render.
- Never map colour/state/transition Tailwind classes to inline `styles` — they stay as utilities by design (see `context/tailwind-mapping.md`).

## Commands

- Convert site: `npx tsx src/cli/index.ts convert inputs/<site>/ --split`
- Convert page: `npx tsx src/cli/index.ts convert inputs/<site>/index.html`
- Verify fidelity: `npx tsx src/cli/verify.ts --output output/<site>`
- CSS coverage: `npx tsx src/cli/verify.ts --output output/<site> --coverage`
- Regression: `npx tsx src/cli/index.ts regression`
- Tests: `node --import tsx --test tests/*.test.ts`
- Typecheck: `npm run build`

## Scaffold Growth

After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `ROUTER.md` and relevant `context/` files
- Orient: create or update a `patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

The scaffold grows from real work, not just setup. See the GROW step in `ROUTER.md` for details.

## Navigation

At the start of every session, read `ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.
