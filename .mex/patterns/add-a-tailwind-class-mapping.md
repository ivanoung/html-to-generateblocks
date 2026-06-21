---
name: add-a-tailwind-class-mapping
description: Extend the Tailwind utility → GB inline styles mapping for a new mappable class. Use when a layout/spacing/sizing/positioning/border/typography/effects utility should resolve to inline styles but currently stays in globalClasses.
triggers:
  - "add mapping"
  - "new tailwind class"
  - "map class"
  - "gb-whitelist"
  - "tailwind-layout-mapper"
edges:
  - target: context/tailwind-mapping.md
    condition: for the full map/unmap table and gotchas before editing
  - target: context/conventions.md
    condition: for the Verify Checklist and the "what not to map" rules
  - target: patterns/debug-conversion-discrepancy.md
    condition: when the new mapping causes verify.ts discrepancies
last_updated: 2026-06-21
---

# Add a Tailwind Class Mapping

## Context

Load `context/tailwind-mapping.md` (the mapping surface) and
`context/conventions.md` (verify checklist). The mapping lives across:
`src/core/tailwind-layout-mapper.ts`
(`tailwindLayoutToGbAttributes`), `src/core/gb-whitelist.ts`
(`isGbSupported(prop, value)`), and `src/core/token-mapper.ts` (token → value).

**First confirm the class is mappable.** Colour classes (`--tw-*` vars), state
modifiers (`hover:`/`focus:`/`group-hover:`), transitions/animations, and
config font families are intentionally NOT mapped — do not add them.

## Steps

1. Identify the class category (layout/spacing/sizing/positioning/borders/typography/effects) and confirm it is in the "maps" table in `context/tailwind-mapping.md`.
2. Decide which module owns it:
   - layout utilities → `src/core/tailwind-layout-mapper.ts`
   - property support gating → `src/core/gb-whitelist.ts` (`isGbSupported`)
   - token → value resolution → `src/core/token-mapper.ts`
3. Add the mapping. Mirror the existing patterns in that file (key order, value normalization: `rgb()`→`#hex`, `0px`→`0`).
4. For responsive variants, respect the desktop-first inversion (largest breakpoint → base; smaller → `@media(max-width: N-1px)` resets) in both `styles` and `css`.
5. Add a test in `tests/tailwind-layout-mapper.test.ts` (or the relevant tests/*.test.ts) covering the new class, including a responsive case if applicable.
6. Run the test:
   ```bash
   node --import tsx --test tests/tailwind-layout-mapper.test.ts
   ```
7. Re-convert a fixture/site that uses the class and re-verify:
   ```bash
   npx tsx src/cli/verify.ts --output output/<site>
   ```
   The class should now resolve to `styles` (drop out of `globalClasses` for the mapped property) with zero discrepancies.

## Gotchas

- **Never inline the unmappable categories** (colours/states/transitions/config fonts) — they break the GB editor or cannot be expressed without CSS variables.
- **`text-*` sets `lineHeight` as a side effect** — combining with `leading-*` triggers the V3 cascade precedence quirk.
- **Keep `styles` and `css` in sync** — properties with a GB editor panel go to both.
- **Canonical key order** must follow `plugin/generateblocks/<block>/block.json`.

## Verify

- [ ] New test passes: `node --import tsx --test tests/<file>.test.ts`.
- [ ] Full suite green: `node --import tsx --test tests/*.test.ts`.
- [ ] `npx tsx src/cli/verify.ts --output output/<site>` → zero discrepancies; the class now resolves to `styles`.
- [ ] `npx tsx src/cli/verify.ts --output output/<site> --coverage` → CSS coverage reflects the change.
- [ ] `npm run build` (tsc) passes.
- [ ] `node --import tsx --test tests/*.test.ts` green.

## Debug

If verify.ts now reports `missing_property`/`value_mismatch`/`unused_property`,
see `patterns/debug-conversion-discrepancy.md`. Common causes: forgot the
desktop-first inversion, didn't mirror to `css`, or whitelisted a property GB
can't render.

## Update Scaffold

- [ ] Add the class to the "What Maps" table in `.mex/context/tailwind-mapping.md` if it is a new category entry.
- [ ] Update `.mex/ROUTER.md` "Current Project State" if mapping coverage materially changed.
- [ ] Bump `last_updated` on changed scaffold files.
