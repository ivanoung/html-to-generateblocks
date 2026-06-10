# Global CLI Install — Decision Note

**Date:** 2026-06-10
**Status:** Deferred (picking up later after conversion fidelity work)

## Goal

Turn gb-converter into an npm-globally-installable CLI (`gb-convert`) that can be
invoked from any folder. Inputs (`inputs/`) and outputs (`output/`) stay inside
the CWD project folder where the CLI is called from.

## Decisions Made

- **Install model:** npm global install (`npm i -g gb-converter`)
- **Path model:** CWD = the project being converted. `inputs/` and `output/` are
  subfolders of wherever the user runs the command.
- **Command scope:** All commands ship (fixtures, regression, convert, validate,
  report:update — everything).
- **Build approach:** tsc → dist/ + bin entry (Approach A — see below).
- **Fixtures/snapshots:** Live at the package root, loaded via a path helper that
  resolves from `__dirname` (not CWD).

## Chosen Approach (A): Path Abstraction + tsc Build

### What changes (~5 files, ~40 net new lines):

1. **`src/core/paths.ts`** (new) — exports:
   - `getPackageDir()` — resolves to package root from `__dirname`
   - `getFixturesDir()` — `resolve(getPackageDir(), "fixtures")`
   - `getSnapshotsDir()` — `resolve(getPackageDir(), "snapshots/m1")`

2. **`tsconfig.build.json`** (new) — extends tsconfig, removes `noEmit` +
   `allowImportingTsExtensions`, sets `outDir: "dist"`

3. **`package.json`** — add:
   ```json
   "bin": { "gb-convert": "./dist/cli/index.js" },
   "files": ["dist/", "fixtures/", "snapshots/"],
   "scripts": { "build": "tsc -p tsconfig.build.json" }
   ```

4. **`src/cli/index.ts`** — add shebang `#!/usr/bin/env node`; replace
   `resolve(process.cwd(), "fixtures")` with `getFixturesDir()` and same
   for snapshots.

5. **`src/runner/run-fixture.ts`** — fix `OUTPUT_DIR` (currently writes to
   `fixtures/output/`; should use CWD-relative `output/` via path helper).

### What stays the same:
- All source imports already use `.js` extensions (tsc-compatible)
- Orchestrator already uses `process.cwd()` for user-facing output
- CLI already accepts paths relative to CWD for `convert`
- No dependency changes needed

### Estimated effort: ~2–3 hours

### Why this is easy to maintain:
- All path logic is in one module (`paths.ts`); adding new commands or
  changing directory conventions is a single-file change.
- The architecture is already well-factored (core/runner/cli layers).
- Existing test infrastructure (fixtures, snapshots, regression) ports
  cleanly to the global install model.

## Revisit When

After conversion fidelity is solid (backgrounds, background-image, full GB
interface utilization, and other subtle items are addressed).
