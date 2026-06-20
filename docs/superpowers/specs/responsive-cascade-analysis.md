# Responsive Cascade: GB Tier Capability Analysis

## GB's Cascade (desktop-first, max-width)

```
All Screens → base, applies everywhere
Tablet & Mobile (≤1024px, max-width: 1024px) → overrides AS at 0-1024
Mobile (≤767px, max-width: 767px) → overrides T&M and AS at 0-767
```

Priority: Mobile > T&M > All Screens (more specific = higher priority)

## Key invariant

**Mobile acts as a "seal" at 0-767px.** When Mobile has a value, it blocks T&M from applying at 0-767. Without a Mobile value, T&M (≤1024) also applies at 0-767.

## Golden Case: default + md + lg (3-tier)

T&M's max-width (1024) must align with the transition out of md and into desktop. This ONLY works when lg takes over at 1024.

| TW | Step function | GB tiers | At 0-767 | At 768-1023 | At 1024+ |
|---|---|---|---|---|---|
| p-4, md:p-8, lg:p-12 | [0-767:16, 768-1023:32, 1024+:48] | AS:48, T&M:32, M:16 | M=16 ✓ | T&M=32 ✓ | AS=48 ✓ |

✓ Mobile "seals" 0-767 → T&M only active at 768-1023 → AS at 1024+.
✓ md's range ends at 1024 where lg begins — perfect alignment with T&M's max-width.

### Why xl/2xl break the golden case

```
default=p-4, md:p-8, xl:p-12  (no lg)
TW: [0-767:16, 768-1279:32, 1280+:48]
GB: AS=48, T&M=32, M=16
At 1025-1279: T&M inactive (>1024), AS=48  ✗  (expected md=32)
```

T&M stops at 1024, but md's range extends to 1279 (no lg to take over). The gap at 1025-1279 gets AS's xl value instead of md's value.

```
default=p-4, md:p-8, lg:p-12, xl:p-16
TW: [0-767:16, 768-1023:32, 1024-1279:48, 1280+:64]
GB: AS=64, T&M=32, M=16
At 1025-1279: T&M inactive, AS=64  ✗  (expected lg=48)
```

T&M stops at 1024, so lg's value at 1024-1279 gets overridden by AS's xl value.

**Conclusion:** xl/2xl ONLY work in Path A when they EQUAL lg. If xl differs from lg, use Path B.

## Golden Case 2: default + lg (2-tier, no md)

When md is not set, the default value applies at 0-1023, and lg applies at 1024+. T&M (≤1024) perfectly covers 0-1023.

| TW | Step function | GB tiers | At 0-1023 | At 1024+ |
|---|---|---|---|---|
| p-4, lg:p-12 | [0-1023:16, 1024+:48] | AS:48, T&M:16 | T&M=16 ✓ | AS=48 ✓ |

✓ Works with AS + T&M only. No Mobile needed. AS may be lg/xl/2xl (the highest applicable).

## When GB Tiers Break (all other patterns)

### 2-step: default + md (no lg)

| TW | Step function | GB naive | Problem |
|---|---|---|---|
| p-4, md:p-8 | [0-767:16, 768+:32] | AS:32, T&M:16 | T&M=16 at 768-1023 ✗ (expected 32) |

T&M (≤1024) covers 768-1023 where value should be md=32.
Custom fix: AS=16, @768=32.

### 2-step: default + sm

sm at 640px splits the default range. GB's Mobile is ≤767 — can't distinguish 0-639 vs 640-767.
Custom fix: AS=default_value, @640=sm_value.

### 2-step: md + lg (no default)

| TW | Step function |
|---|---|
| md:flex, lg:grid | [0-767:none, 768-1023:flex, 1024+:grid] |

No default to use as All Screens base. AS can't be "nothing" for 0-767.
Custom fix: @768=flex, @1024=grid (no AS).

### 1-step: any single breakpoint only

| TW | Custom fix |
|---|---|
| sm:only | @640 |
| md:only | @768 |
| lg:only | @1024 |
| xl:only | @1280 |
| 2xl:only | @1536 |

### 4+ step: any patterns with >3 distinct value groups

GB has only 3 tiers. Extra breakpoints (sm, xl, 2xl) beyond the golden case use custom @media.

## Summary: Path Routing

### Path A (GB native tiers)

| Sub-path | Condition | Output |
|---|---|---|
| A1 (trivial) | default only | AS only |
| A2 (2-tier) | default + lg/xl/2xl (no md, no sm) | AS=lg+, T&M=default |
| A3 (3-tier, golden) | default + md + lg (xl ok if =lg, 2xl ok if =lg) | AS=lg+, T&M=md, M=default |

### Path B (custom @media)

All other patterns. Uses exact Tailwind px breakpoints (640/768/1024/1280/1536).
Emit AS=base (if base exists), then @media(min-width:Npx) at each breakpoint where value differs from previous.

## Coverage

| # | default | sm | md | lg | xl | 2xl | Path | Output |
|---|---|---|---|---|---|---|---|---|
| 1 | ✓ | — | — | — | — | — | A1 | AS only |
| 2 | ✓ | ✓ | — | — | — | — | B | AS + @640 |
| 3 | ✓ | ✓ | — | ✓ | — | — | B | AS + @640 + @1024 |
| 4 | ✓ | ✓ | ✓ | ✓ | — | — | B | AS + @640/768/1024 |
| 5 | ✓ | ✓ | ✓ | ✓ | ✓ | — | B | AS + @640/768/1024/1280 |
| 6 | ✓ | — | ✓ | ✓ | — | — | **A3** | AS + T&M + M |
| 7 | ✓ | — | ✓ | ✓ | = lg | — | **A3** | AS + T&M + M |
| 8 | ✓ | — | ✓ | ✓ | ≠ lg | — | B | AS + @768/1024/1280 |
| 9 | ✓ | — | ✓ | — | — | — | B | AS + @768 |
| 10 | ✓ | — | ✓ | — | ✓ | — | B | AS + @768 + @1280 |
| 11 | ✓ | — | — | ✓ | — | — | **A2** | AS + T&M |
| 12 | ✓ | — | — | ✓ | ✓ | = lg | **A2** | AS + T&M |
| 13 | ✓ | — | — | — | ✓ | — | B | AS + @1280 |
| 14 | — | — | ✓ | ✓ | — | — | B | @768 + @1024 |
| 15 | — | — | ✓ | — | — | — | B | @768 |
| 16 | — | — | — | ✓ | — | — | B | @1024 |
| 17 | — | — | — | — | ✓ | — | B | @1280 |
| 18 | — | — | — | — | — | ✓ | B | @1536 |
| 19 | — | ✓ | — | — | — | — | B | @640 |
| 20 | — | ✓ | ✓ | ✓ | — | — | B | @640/768/1024 |

100% coverage. 6 patterns use GB tiers (A). 14 use custom @media (B). Zero leakage.
