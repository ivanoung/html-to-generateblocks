# Contributing to gb-converter

Thanks for helping improve gb-converter! This document explains how to set up, test, and contribute.

## Prerequisites

- **Node.js 22+** (tested on v22.22.3)
- **npm** (comes with Node.js)

## Setup

```bash
git clone https://github.com/your-username/gb-converter.git
cd gb-converter
npm install
```

## Project Structure

```
src/core/          — Core conversion logic (mapper, serializer, CSS splitter, etc.)
src/cli/           — CLI entry point
tests/             — Test files (Node test runner + Vitest)
docs/superpowers/  — Design specs, architecture docs, implementation plans
inputs/            — Sample input HTML pages for testing
output/            — Converted output (gitignored)
```

## Running Tests

The project uses two test runners:

**Layout mapper tests (Vitest):**
```bash
npx vitest run tests/tailwind-layout-mapper.test.ts
```

**All other tests (Node.js built-in test runner):**
```bash
node --test tests/*.test.ts
```

Make sure all tests pass before submitting a PR.

## Running the Converter

```bash
# Basic conversion
npx tsx src/cli/index.ts -i inputs/mino/index.html -o output/mino

# With CSS splitting (recommended)
npx tsx src/cli/index.ts -i inputs/mino/index.html -o output/mino --split
```

The converter produces GenerateBlocks-compatible block JSON output ready for WordPress paste-import.

## Code Style

- **TypeScript strict mode** — no implicit `any`, no unchecked nulls
- **No unrequested abstractions** — one implementation? No interface. One caller? No factory.
- **YAGNI** — only build what's needed now
- **Tests required** — any new mapping logic needs a test case
- Follow existing patterns in `src/core/` for naming and structure

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write your code and tests
4. Run the test suite and verify it passes
5. Commit with a descriptive message
6. Push and open a Pull Request

PRs are reviewed for correctness, test coverage, and code style before merging.
