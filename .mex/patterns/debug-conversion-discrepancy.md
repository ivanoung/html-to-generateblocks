---
name: debug-conversion-discrepancy
description: Diagnose verify.ts discrepancies (missing_property / value_mismatch / unused_property) or a WordPress "Attempt Recovery" prompt. Use when a conversion's processed output does not match the fallback or WP rejects the block markup.
triggers:
  - "discrepancy"
  - "verify.ts"
  - "attempt recovery"
  - "layout fidelity"
  - "mismatch"
edges:
  - target: context/conventions.md
    condition: for the Verify Checklist and the recovery rules
  - target: context/tailwind-mapping.md
    condition: when the discrepancy is about a class mapping
last_updated: 2026-06-21
---

# Debug a Conversion Discrepancy

## Context

Load `context/conventions.md` (recovery rules + Verify Checklist) and
`context/tailwind-mapping.md` (if the issue is class-mapping related).
`src/cli/verify.ts` re-runs `tailwindLayoutToGbAttributes` on each fallback
block's `globalClasses` and diffs against the processed block's `styles`. It
emits three issue types: `missing_property`, `value_mismatch`,
`unused_property`. It skips `--tw-*` variable properties and avoids rem→px
conversion by re-running the mapper on the class list.

## Steps

1. Run the verifier and read the issue types:
   ```bash
   npx tsx src/cli/verify.ts --output output/<site>
   ```
2. Triage by issue type:
   - **`missing_property`** — the mapper produced a property for the class list but the processed block lacks it. Check `src/core/mapper.ts` / `tailwind-layout-mapper.ts` for the class; likely the mapping was skipped or the class was wrongly left in `globalClasses`.
   - **`value_mismatch`** — same property, different value. Check value normalization (`rgb()`→`#hex`, `0px`→`0`), CSS variable resolution, and the desktop-first cascade inversion.
   - **`unused_property`** — the processed block has a property the mapper did not produce from the class list. Check whether a class was wrongly mapped, or a property was injected from the wrong source.
3. If WordPress fires **"Attempt Recovery"** (not a verify.ts issue), check in order:
   - The four JSON escapes (`--`, `&`, `<`, `>`).
   - Canonical key order per block type vs `plugin/generateblocks/<block>/block.json`.
   - No `className` in block JSON (must be `globalClasses`).
   - No descendant selectors, no `transition`, no hover rules in `css`.
   - `href`/attributes are in `htmlAttributes`, not `content`.
4. Bisect: remove blocks one at a time from the output HTML to isolate the failing block.
5. Fix the root cause (mapper / walker / serializer), re-convert, re-verify.

## Gotchas

- verify.ts **skips `--tw-*` variable properties** when comparing — colour classes won't show as discrepancies even though they stay in `globalClasses`.
- verify.ts re-runs the mapper on the **class list**, not the computed style, to avoid rem→px unit issues — so a "value_mismatch" is a real mapper logic difference, not a unit artifact.
- `--coverage` reports CSS coverage per DOM class against `tailwind-utilities.css`; a class with no coverage is a different problem from a layout discrepancy.
- A passing verify.ts does NOT guarantee no "Attempt Recovery" — recovery is about JSON shape/escapes/key order, which verify.ts does not check.

## Verify

- [ ] `npx tsx src/cli/verify.ts --output output/<site>` → zero discrepancies.
- [ ] `node --import tsx --test tests/*.test.ts` green (especially `tailwind-layout-mapper.test.ts` if the mapper changed).
- [ ] `npx tsx src/cli/index.ts regression` green.
- [ ] Paste/save/reload in WordPress → no "Attempt Recovery".

## Debug

Loop back to Step 1 with the narrowed block set. If the discrepancy is in the
mapper, add a failing test first (see `patterns/add-a-tailwind-class-mapping.md`
Step 5) before fixing.

## Update Scaffold

- [ ] If a new gotcha was found, add it to `context/tailwind-mapping.md` "Gotchas" or `context/conventions.md` "What Not To Do".
- [ ] If a recurring failure mode emerged, refine this pattern.
- [ ] Bump `last_updated` on changed scaffold files; run `mex log "<what broke and why>"` if the rationale matters.
