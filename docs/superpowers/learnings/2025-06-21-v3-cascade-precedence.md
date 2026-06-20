# Learning: V3 Cascade Precedence Fix — Post-Mortem

**Date**: 2025-06-21
**Status**: Reverted, needs rethink

## The Problem

`leading-[0.9]` (base class) sets `lineHeight: 0.9`. `lg:text-8xl` sets `lineHeight: 96px` as a side effect. The V3 cascade picks the largest-breakpoint value for All Screens → `96px`, not `0.9`. In actual Tailwind CSS, `leading-[0.9]` would win because it's compiled later in CSS source order.

## Attempts

### v1: Base-Exclusive Family (reverted)
- Rule: if a class family (e.g., "leading") appears only at base (no bp-prefixed siblings), its properties win at all breakpoints.
- **Broke**: `flex md:hidden`. "flex" is base-exclusive → `display:flex` forced everywhere, blocking `md:hidden`.

### v2: Source-Order Precedence (reverted)
- Rule: if the base token's source position is later than ALL bp-specific tokens, base wins.
- **Broke**: layout regressions. The source-order check was correct for single-property cases but had subtle interactions with multi-property classes (e.g., `text-8xl` sets BOTH `fontSize` AND `lineHeight`) across the cascade.

## Why This Is Hard

The V3 cascade inverts Tailwind's mobile-first system (min-width) into GenerateBlocks' desktop-first system (max-width). Tailwind uses CSS source order to resolve conflicts between base and responsive utilities. The mapper splits tokens by breakpoint, losing the source-order relationship across breakpoints.

**Core tension**: Some base classes should win (like `leading-[0.9]` — intentional line-height override), but others should NOT win (like `flex` — should yield to `md:hidden`). No single mechanical rule distinguishes the two without understanding **intent**.

## Key Insight

The problem only exists when a class sets a property as a **side effect**:
- `text-8xl` → `fontSize` (primary) + `lineHeight` (side effect)
- `leading-[0.9]` → `lineHeight` (primary)

A separate class (`leading-[0.9]`) intentionally overrides the side effect. But the mapper can't distinguish primary from side-effect automatically — it only sees two classes setting the same property.

## Possible Future Approaches

1. **Hardcode known side-effect properties**: Track which TW classes have multi-property side effects (e.g., `text-*` also sets `lineHeight`, `p-*` sets four directional properties). When a side-effect property is overridden by a base-only class, let the base-only class win.

2. **Post-process against styles.css**: After generating the cascade, compare the mapper's `lineHeight` against what `styles.css` would produce. If there's a mismatch, fix it.

3. **Accept the limitation**: Document that `leading-*` classes used with responsive `text-*` classes need the developer to also use responsive `md:leading-*` and `lg:leading-*` variants. Most Tailwind developers do this anyway.

4. **Emit both values**: At All Screens, emit the base value for the side-effect property AND let the bp-specific value apply at its breakpoint. This covers both cases but may cause CSS bloat.

## What We Preserved

The revert keeps us at the stable `e926449` state with:
- All 6 mapper gaps fixed (textTransform, fontStyle, textDecoration, border sides, border-style, max-w-container)
- Side-specific border resets in PROPERTY_RESETS
- Self-verification script (0 issues across 3 projects)
- 216/216 tests
