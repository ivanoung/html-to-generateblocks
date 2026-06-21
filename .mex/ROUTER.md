---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/tailwind-mapping.md
    condition: when mapping a Tailwind utility to GB styles or debugging class coverage
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-06-21
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**Working:**
- Dual-output pipeline (fallback + processed) for Tailwind and vanilla CSS sites — v0.2.
- Tailwind utility → GB inline `styles` mapping (layout, spacing, sizing, positioning, borders, typography, effects).
- CSS split into `tailwind-utilities.css` (unmapped) + `styles-unique.css` (processed pass, `--split`).
- GB blocks: `element`, `text`, `media`, `shape`; core blocks: `image`, `embed`, `list`, `quote`, `html`.
- Self-verification (`src/cli/verify.ts`): layout fidelity + CSS coverage.
- 17 fixtures + M1 snapshots passing regression.
- Iconify `<iconify-icon>` → inline SVG resolution (with core/html fallback).
- `data-gb-wrap="core-html"` marker to preserve raw HTML as a core/html block.

**Not yet built / out of scope:**
- Squarespace / Wix / Webflow export support (need a human cleanup pass first).
- Colour classes (`bg-*`/`text-*`/`border-*` using `--tw-*` vars) → stay as utilities by design.
- State modifiers (`hover:`/`focus:`/`group-hover:`/`peer-*`) → no GB inline equivalent, by design.
- Transition/animation classes (`transition-*`/`duration-*`/`animate-*`) → stay as utilities.
- Tailwind config font families (`font-display`/`font-mono`) → stay in `globalClasses`.

**Known issues:**
- `leading-*` combined with responsive `text-*` (which sets lineHeight as a side effect): the V3 cascade picks the largest breakpoint value. See `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`.
- CONTRIBUTING.md's "Vitest" note is stale — all test files use `node:test`; run via `node --import tsx --test tests/*.test.ts`.
- **Fixture-based CLI commands are broken** — `regression`, `fixtures:run`, `fixtures:run-all`, `validate`, `report:update` need fixtures/*.json and snapshots/m1/*.html, both gitignored (`.gitignore` lines 11–12) and not in the repo. They throw ENOENT. Use `convert` + `verify.ts` + the test suite instead.
- **Pre-existing `tsc` errors** — `npm run build` fails on `src/core/tailwind-inliner.ts` (tsconfig `lib` lacks `dom`, so `document`/`Element` are undefined) and `src/core/tailwind-layout-mapper.ts` (circular `GbStyles` type alias). These pre-date the mex adoption and do not block the `tsx` runtime workflow.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Mapping a Tailwind utility to GB styles / debugging class coverage | `context/tailwind-mapping.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Narrate what you load: "Loading architecture context..."
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. If the why matters, run `mex log --type decision "<what changed and why>"` or `mex log "<note>"`.
