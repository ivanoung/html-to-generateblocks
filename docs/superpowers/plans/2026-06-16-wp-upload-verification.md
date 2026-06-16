# WP Upload Verification Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `verify:prepare` CLI command that prepares converted project data for WP upload, plus `verify:status` and `verify:cleanup` for session recovery. The agent orchestrates the actual Novamira MCP WP upload.

**Architecture:** CLI commands do local work (conversion, data prep, session file). The agent reads the prepared data and makes MCP calls (execute-php, write-file, enable-file) to upload to WordPress. No MCP integration code in the converter itself — the agent is the bridge.

**Tech Stack:** TypeScript (same as converter), Node.js fs/path/crypto, Novamira MCP (agent side)

---

### Task 1: Session File Module

**Files:**
- Create: `src/core/verify-session.ts`

This module manages the `output/.verify-session.json` file that survives agent crashes and enables recovery.

- [ ] **Step 1: Write the module with all exports**

```typescript
// src/core/verify-session.ts
// ── Verify Session ──────────────────────────────────────────
//
// Manages the output/.verify-session.json file for the
// wp-upload-verify workflow. Survives agent crashes.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface SessionPost {
  slug: string;
  postId?: number;
  url?: string;
  status: "pending" | "created" | "failed";
  error?: string;
}

export interface VerifySession {
  runId: string;
  wpUrl: string;
  pass: 1 | 2;
  projectDir: string;
  createdPosts: SessionPost[];
  sandboxFile: string;
  status: "preparing" | "awaiting_review" | "complete" | "failed";
  startedAt: string;
}

const SESSION_PATH = resolve(process.cwd(), "output", ".verify-session.json");

/** Create a new session file. Returns the session object. */
export function createSession(
  wpUrl: string,
  pass: 1 | 2,
  projectDir: string,
): VerifySession {
  const runId = randomUUID().slice(0, 8);
  const session: VerifySession = {
    runId,
    wpUrl,
    pass,
    projectDir,
    createdPosts: [],
    sandboxFile: `novamira-sandbox/gb-verify-${runId}.php`,
    status: "preparing",
    startedAt: new Date().toISOString(),
  };
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2) + "\n", "utf-8");
  return session;
}

/** Read the current session file. Returns null if none exists. */
export function readSession(): VerifySession | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as VerifySession;
  } catch {
    return null;
  }
}

/** Update the session file with partial changes. */
export function updateSession(partial: Partial<VerifySession>): VerifySession | null {
  const session = readSession();
  if (!session) return null;
  const updated = { ...session, ...partial };
  writeFileSync(SESSION_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  return updated;
}

/** Delete the session file after successful cleanup. */
export function deleteSession(): void {
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
}

/** Check if the session file indicates an active (unfinished) verification. */
export function hasActiveSession(): boolean {
  const s = readSession();
  return s !== null && s.status !== "complete" && s.status !== "failed";
}

/** Validate required environment variables are set. Returns error message or null. */
export function validateEnv(): string | null {
  const missing: string[] = [];
  if (!process.env.GB_WP_URL) missing.push("GB_WP_URL");
  if (!process.env.GB_WP_USER) missing.push("GB_WP_USER");
  if (!process.env.GB_WP_PASS) missing.push("GB_WP_PASS");
  if (missing.length > 0) {
    return `Missing environment variables: ${missing.join(", ")}. Set GB_WP_URL, GB_WP_USER, GB_WP_PASS.`;
  }
  const url = process.env.GB_WP_URL!;
  if (!/staging|dev|local|test/.test(url)) {
    return `GB_WP_URL (${url}) does not appear to be a staging/dev site. Set GB_WP_URL to a staging URL.`;
  }
  return null;
}

/** Check if the WP URL looks like a staging/dev site. Returns warning or null. */
export function checkStagingUrl(): string | null {
  const url = process.env.GB_WP_URL || "";
  if (!url) return null;
  if (!/staging|dev|local|test/.test(url)) {
    return `WARNING: GB_WP_URL (${url}) does not appear to be a staging/dev site. Proceed with caution.`;
  }
  return null;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsx -e "import './src/core/verify-session.js'; console.log('OK')"
```

Expected: `OK` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/verify-session.ts
git commit -m "feat: add verify session file module (create, read, update, delete, env validation)"
```

---

### Task 2: Verify Prepare Module

**Files:**
- Create: `src/core/verify-prepare.ts`

This module reads the converted project output and builds the data payloads the agent needs for MCP calls.

- [ ] **Step 1: Write the module**

```typescript
// src/core/verify-prepare.ts
// ── Verify Prepare ──────────────────────────────────────────
//
// Reads converted project output and builds data payloads
// for the agent to upload via Novamira MCP.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { VerifySession, SessionPost } from "./verify-session.js";

export interface PagePayload {
  slug: string;
  postTitle: string;
  blockMarkup: string;
  report: Record<string, unknown>;
}

export interface VerifyPrepareResult {
  pages: PagePayload[];
  cssPayload: string;
  cssSource: string; // "styles.css" or "split CSS"
  warnings: string[];
}

/**
 * Prepare verification data from a converted project.
 * Reads pages/*.html block markup and styles.css from output/<projectDir>/.
 * For pass 2, also reads setup/global-styles.json and setup/styles-unique.css.
 */
export function prepareVerification(
  session: VerifySession,
): VerifyPrepareResult {
  const outDir = resolve(process.cwd(), "output", session.projectDir);
  const pagesDir = resolve(outDir, "pages");
  const warnings: string[] = [];

  // Collect page markup
  const pages: PagePayload[] = [];
  if (!existsSync(pagesDir)) {
    throw new Error(`Pages directory not found: ${pagesDir}. Run conversion first.`);
  }

  const htmlFiles = readdirSync(pagesDir)
    .filter((f: string) => f.endsWith(".html"))
    .sort();

  for (const file of htmlFiles) {
    const slug = basename(file, ".html");

    // Skip setup pseudo-page if present
    if (slug === "_setup") continue;

    const blockMarkup = readFileSync(resolve(pagesDir, file), "utf-8");
    const reportPath = resolve(pagesDir, `${slug}.report.json`);

    let report: Record<string, unknown> = {};
    if (existsSync(reportPath)) {
      try {
        report = JSON.parse(readFileSync(reportPath, "utf-8"));
      } catch {
        warnings.push(`Could not parse report for ${slug}`);
      }
    }

    // Check for hard fails
    const hardFails = (report.hardFails as unknown[]) || [];
    if (hardFails.length > 0) {
      warnings.push(`${slug}: ${hardFails.length} hard fail(s) — block markup may not render correctly`);
    }

    pages.push({
      slug,
      postTitle: `${session.projectDir} — ${slug} [verify ${session.runId}]`,
      blockMarkup,
      report,
    });
  }

  if (pages.length === 0) {
    throw new Error(`No .html pages found in ${pagesDir}`);
  }

  // Collect CSS based on pass
  let cssPayload = "";
  let cssSource = "";

  if (session.pass === 1) {
    // Pass 1: styles.css (master fallback)
    const cssPath = resolve(outDir, "styles.css");
    if (!existsSync(cssPath)) {
      throw new Error(`styles.css not found: ${cssPath}`);
    }
    cssPayload = readFileSync(cssPath, "utf-8");
    cssSource = "styles.css";

    // Warn about relative URLs
    if (/url\(\s*['"]?(?!https?:|\/\/|data:)/.test(cssPayload)) {
      warnings.push("styles.css contains relative url() references — these may not resolve when injected as inline CSS");
    }
  } else {
    // Pass 2: combined global-styles.json CSS + styles-unique.css
    const setupDir = resolve(outDir, "setup");

    // Read global-styles.json and extract CSS from structured entries
    const gsPath = resolve(setupDir, "global-styles.json");
    const uniquePath = resolve(setupDir, "styles-unique.css");

    if (!existsSync(gsPath)) {
      throw new Error(`global-styles.json not found: ${gsPath}. Run Phase 2 first.`);
    }
    if (!existsSync(uniquePath)) {
      throw new Error(`styles-unique.css not found: ${uniquePath}. Run Phase 2 first.`);
    }

    // Build CSS from global-styles.json entries (structured gb_style_data)
    // For verification we convert the structured data back to flat CSS
    const gsData = JSON.parse(readFileSync(gsPath, "utf-8"));
    const styleEntries = gsData.styles || [];
    const gsCssParts: string[] = [];

    for (const entry of styleEntries) {
      if (!entry.selector || !entry.styles) continue;
      const rules = stylesToCss(entry.styles as Record<string, unknown>, "");
      if (rules) {
        gsCssParts.push(`${entry.selector} { ${rules} }`);
      }
    }

    const uniqueCss = readFileSync(uniquePath, "utf-8");
    cssPayload = gsCssParts.join("\n") + "\n" + uniqueCss;
    cssSource = "global-styles.json + styles-unique.css";
  }

  return { pages, cssPayload, cssSource, warnings };
}

/**
 * Convert a gb_style_data styles object to a CSS declarations string.
 * Handles nested @media and :pseudo rules.
 */
function stylesToCss(
  styles: Record<string, unknown>,
  indent: string,
): string {
  const declarations: string[] = [];
  const nested: string[] = [];

  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // Nested rule: @media or :pseudo
      const inner = stylesToCss(value as Record<string, unknown>, indent + "  ");
      if (inner) {
        if (key.startsWith("@media")) {
          nested.push(`${key} { ${inner} }`);
        } else {
          // Pseudo-class: wrap the selector later
          nested.push(`${key} { ${inner} }`);
        }
      }
    } else if (value !== null && value !== undefined && value !== "") {
      // kebab-case the camelCase property
      const cssProp = key.replace(/[A-Z]/g, (m: string) => "-" + m.toLowerCase());
      declarations.push(`${cssProp}: ${value}`);
    }
  }

  const result = declarations.join("; ") + (declarations.length > 0 ? ";" : "");
  if (nested.length > 0) {
    return result + " " + nested.join(" ");
  }
  return result;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsx -e "import './src/core/verify-prepare.js'; console.log('OK')"
```

Expected: `OK` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/verify-prepare.ts
git commit -m "feat: add verify prepare module — read project output, build MCP payloads"
```

---

### Task 3: CLI Commands

**Files:**
- Modify: `src/cli/index.ts` (add verify commands)

Add three new CLI commands: `verify:prepare`, `verify:status`, `verify:cleanup`.

- [ ] **Step 1: Add imports at top of CLI**

In `src/cli/index.ts`, add after existing imports:

```typescript
import { createSession, readSession, updateSession, deleteSession, hasActiveSession, validateEnv, checkStagingUrl } from "../core/verify-session.js";
import { prepareVerification } from "../core/verify-prepare.js";
```

- [ ] **Step 2: Add verify:prepare command**

Insert before the `// ── convert ──` section (or at the end before `// ── Unknown command`):

```typescript
  // ── verify:prepare ──────────────────────────────────────
  if (cmd === "verify:prepare") {
    const inputPath = args[1];
    if (!inputPath) {
      console.error("Usage: verify:prepare <inputs/project/> [--pass 2]");
      process.exit(1);
    }

    // Validate environment
    const envError = validateEnv();
    if (envError) {
      console.error(`ERROR: ${envError}`);
      process.exit(1);
    }

    const stagingWarning = checkStagingUrl();
    if (stagingWarning) console.log(stagingWarning);

    // Check for active session
    if (hasActiveSession()) {
      console.log("An active verification session exists. Run 'verify:cleanup' first or 'verify:status' to inspect.");
      process.exit(1);
    }

    // Parse options
    const passNum = args.includes("--pass") && args[args.indexOf("--pass") + 1] === "2" ? 2 : 1;
    const wpUrl = process.env.GB_WP_URL!;

    // Derive project dir from input path
    const projectDir = inputPath.replace(/^inputs\//, "").replace(/\/$/, "");

    // Create session
    const session = createSession(wpUrl, passNum as 1 | 2, projectDir);

    // Run conversion if output doesn't exist
    const outDir = `output/${projectDir}`;
    const { existsSync: es } = await import("node:fs");
    if (!es(resolve(process.cwd(), outDir, "pages"))) {
      console.log(`Running conversion for ${projectDir}...`);
      // Re-invoke same CLI for convert (the conversion pipeline)
      // This is handled by the agent — print instruction
      console.log(`Run: npx tsx src/cli/index.ts convert inputs/${projectDir}/`);
      console.log("Then re-run verify:prepare.");
      deleteSession();
      process.exit(1);
    }

    // Prepare verification data
    console.log(`Preparing Pass ${passNum} verification for ${projectDir}...`);

    let prepResult;
    try {
      prepResult = prepareVerification(session);
    } catch (err: any) {
      console.error(`ERROR: ${err.message}`);
      deleteSession();
      process.exit(1);
    }

    // Print warnings
    if (prepResult.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const w of prepResult.warnings) console.log(`  ⚠ ${w}`);
    }

    // Update session with page list
    const sessionPosts = prepResult.pages.map((p) => ({
      slug: p.slug,
      status: "pending" as const,
    }));
    updateSession({ createdPosts: sessionPosts, status: "awaiting_review" });

    // Output structured data for agent
    const output = {
      session_file: "output/.verify-session.json",
      run_id: session.runId,
      wp_url: wpUrl,
      wp_user: process.env.GB_WP_USER,
      wp_pass: "***",
      pass: passNum,
      css_source: prepResult.cssSource,
      css_size: prepResult.cssPayload.length,
      pages: prepResult.pages.map((p) => ({
        slug: p.slug,
        title: p.postTitle,
        block_size: p.blockMarkup.length,
        hard_fails: ((p.report.hardFails as unknown[]) || []).length,
      })),
      instructions: [
        "1. Read output/.verify-session.json for run_id",
        "2. Upload sandbox loader: write-file to novamira-sandbox/gb-verify-{run_id}.php",
        "3. Enable sandbox loader: enable-file",
        "4. For each page: execute-php wp_insert_post() with block markup",
        "5. Update session file with post IDs",
        "6. Set CSS transient: execute-php set_transient()",
        "7. Generate nonce: execute-php wp_create_nonce()",
        "8. Report URLs to user with ?gb_verify={run_id}&_nonce={nonce}",
      ],
    };

    console.log(JSON.stringify(output, null, 2));
    return;
  }
```

- [ ] **Step 3: Add verify:status command**

```typescript
  // ── verify:status ─────────────────────────────────────
  if (cmd === "verify:status") {
    const session = readSession();
    if (!session) {
      console.log("No active verification session.");
      process.exit(0);
    }

    console.log(`Session: ${session.runId}`);
    console.log(`Status:  ${session.status}`);
    console.log(`Pass:    ${session.pass}`);
    console.log(`Project: ${session.projectDir}`);
    console.log(`Started: ${session.startedAt}`);
    console.log(`\nPages (${session.createdPosts.length}):`);
    for (const p of session.createdPosts) {
      const icon = p.status === "created" ? "✓" : p.status === "failed" ? "✗" : "◌";
      console.log(`  ${icon} ${p.slug}${p.url ? ` → ${p.url}` : ""}${p.error ? ` (${p.error})` : ""}`);
    }
    return;
  }
```

- [ ] **Step 4: Add verify:cleanup command**

```typescript
  // ── verify:cleanup ────────────────────────────────────
  if (cmd === "verify:cleanup") {
    const session = readSession();
    if (!session) {
      console.log("No session to clean up.");
      process.exit(0);
    }

    console.log(`Cleaning up session ${session.runId}...`);
    console.log(`  ${session.createdPosts.length} post(s) to delete`);
    console.log(`  Sandbox file: ${session.sandboxFile}`);
    console.log(`  Transient: gb_verify_css_${session.runId}`);

    // Instructions for agent
    console.log(JSON.stringify({
      cleanup_steps: [
        { step: "delete_posts", postIds: session.createdPosts.filter(p => p.postId).map(p => p.postId) },
        { step: "delete_transient", key: `gb_verify_css_${session.runId}` },
        { step: "disable_file", path: session.sandboxFile },
        { step: "delete_file", path: session.sandboxFile },
        { step: "delete_session", file: "output/.verify-session.json" },
      ],
    }, null, 2));

    return;
  }
```

- [ ] **Step 5: Verify all commands parse without errors**

```bash
npx tsx src/cli/index.ts 2>&1 | grep -c "verify"
```

Expected: Outputs usage with verify commands listed.

- [ ] **Step 6: Test verify:prepare with mino project**

First ensure output exists:
```bash
npx tsx src/cli/index.ts convert inputs/mino/ 2>&1 | tail -3
```

Then test prepare:
```bash
GB_WP_URL=https://staging.example.com GB_WP_USER=test GB_WP_PASS="test pass" npx tsx src/cli/index.ts verify:prepare inputs/mino/ 2>&1 | head -20
```

Expected: JSON output with run_id, pages list, css_source, instructions. No errors.

- [ ] **Step 7: Test verify:status and verify:cleanup**

```bash
npx tsx src/cli/index.ts verify:status 2>&1
```

Expected: Shows session details with pending pages.

```bash
npx tsx src/cli/index.ts verify:cleanup 2>&1
```

Expected: Shows cleanup instructions.

Delete session after test:
```bash
rm output/.verify-session.json
```

- [ ] **Step 8: Test env validation rejects production URLs**

```bash
GB_WP_URL=https://myproductionsite.com GB_WP_USER=test GB_WP_PASS="test pass" npx tsx src/cli/index.ts verify:prepare inputs/mino/ 2>&1
```

Expected: Warning about non-staging URL.

- [ ] **Step 9: Test env validation rejects missing vars**

```bash
unset GB_WP_URL GB_WP_USER GB_WP_PASS
npx tsx src/cli/index.ts verify:prepare inputs/mino/ 2>&1
```

Expected: Error about missing environment variables.

- [ ] **Step 10: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add verify:prepare, verify:status, verify:cleanup CLI commands"
```

---

### Task 4: End-to-End Dry Run

Manual validation of the full pipeline: prepare → inspect output → verify data is correct.

- [ ] **Step 1: Convert a project to ensure fresh output**

```bash
rm -rf output/pattern2-demo
npx tsx src/cli/index.ts convert inputs/pattern2-demo/ 2>&1 | tail -3
```

Expected: Pattern2 demo converts successfully.

- [ ] **Step 2: Run verify:prepare for Pass 1**

```bash
GB_WP_URL=https://staging.example.com GB_WP_USER=test GB_WP_PASS="test pass" npx tsx src/cli/index.ts verify:prepare inputs/pattern2-demo/ 2>&1
```

Expected: JSON output. Verify:
- `run_id` is 8 chars
- `pages` has 2 entries (index, about)
- `css_source` is "styles.css"
- `css_size` > 0
- Session file created at `output/.verify-session.json`

- [ ] **Step 3: Run verify:prepare for Pass 2**

```bash
rm output/.verify-session.json
GB_WP_URL=https://staging.example.com GB_WP_USER=test GB_WP_PASS="test pass" npx tsx src/cli/index.ts verify:prepare inputs/pattern2-demo/ --pass 2 2>&1
```

Expected: JSON output. Verify:
- `css_source` is "global-styles.json + styles-unique.css"
- `css_size` > 0 (combined from global-styles + unique CSS)

- [ ] **Step 4: Verify session file content**

```bash
cat output/.verify-session.json | head -20
```

Expected: Valid JSON with runId, pass, status: "awaiting_review", createdPosts array.

- [ ] **Step 5: Test verify:status shows active session**

```bash
npx tsx src/cli/index.ts verify:status 2>&1
```

Expected: Shows session details with 2 pending pages.

- [ ] **Step 6: Test verify:cleanup produces cleanup instructions**

```bash
npx tsx src/cli/index.ts verify:cleanup 2>&1
```

Expected: JSON with cleanup_steps array.

- [ ] **Step 7: Clean up session file**

```bash
rm output/.verify-session.json
npx tsx src/cli/index.ts verify:status 2>&1
```

Expected: "No active verification session."

- [ ] **Step 8: Verify existing commands still work**

```bash
npx tsx src/cli/index.ts fixtures:list 2>&1 | head -5
npx tsx src/cli/index.ts regression 2>&1 | tail -3
```

Expected: Fixture list works, regression passes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: verify prepare pipeline end-to-end dry run"
```

---

### Task 5: Agent Workflow (MCP Integration)

This is the agent-orchestrated workflow, not code. Document the exact MCP calls the agent makes.

- [ ] **Step 1: Write the agent workflow document**

Create `docs/superpowers/specs/2026-06-16-wp-verify-agent-workflow.md`:

```markdown
# WP Verify — Agent MCP Workflow

This document describes the exact Novamira MCP calls the agent makes after `verify:prepare` completes.

## Setup

1. Read session file: `cat output/.verify-session.json`
2. Extract: `run_id`, `wp_url`, `pass`, `projectDir`

## Sandbox Loader

**PHP file content** (from spec, with `{run_id}` substituted):

```php
<?php
add_action('wp_head', function() {
    $run_id = $_GET['gb_verify'] ?? '';
    $nonce  = $_GET['_nonce'] ?? '';
    if (!$run_id || !$nonce) return;
    if (!current_user_can('edit_posts')) return;
    $expected = wp_create_nonce('gb_verify_' . $run_id);
    if (!hash_equals($expected, $nonce)) return;
    $css = get_transient("gb_verify_css_{$run_id}");
    if ($css) {
        echo '<style id="gb-verify">' . wp_strip_all_tags($css) . '</style>';
    }
}, 1);
```

**MCP calls:**
1. `write-file` → path: `novamira-sandbox/gb-verify-{run_id}.php`, content: (above PHP)
2. `enable-file` → path: `novamira-sandbox/gb-verify-{run_id}.php`

## Create Pages

For each page in session.created_posts where status is "pending":

3. `execute-php`:
```php
$post_id = wp_insert_post([
    'post_title'   => '{projectDir} — {slug} [verify {run_id}]',
    'post_content' => '{blockMarkup}',
    'post_status'  => 'draft',
    'post_type'    => 'page',
    'post_name'    => '{slug}-{run_id}',
], true);

if (is_wp_error($post_id)) {
    return ['error' => $post_id->get_error_message()];
}

// Validate content wasn't stripped
$saved = get_post($post_id);
$content_match = $saved && trim($saved->post_content) === trim('{blockMarkup}');
$permalink = get_permalink($post_id);

return [
    'post_id' => $post_id,
    'permalink' => $permalink,
    'content_match' => $content_match,
];
```

4. Update session file with post_id, url, status ("created" or "failed")

## Set CSS Transient

5. `execute-php`:
```php
$css = '{cssPayload escaped for PHP string}';
return ['set' => set_transient('gb_verify_css_{run_id}', $css, 900)];
```

## Generate Nonce

6. `execute-php`:
```php
return ['nonce' => wp_create_nonce('gb_verify_{run_id}')];
```

## Report to User

7. Build URL for each created page:
```
{permalink}?gb_verify={run_id}&_nonce={nonce}
```

8. Output to user with prompt for pass/fail per page.

## Cleanup

After user confirms or quits:

9. For each post: `execute-php` → `wp_delete_post({post_id}, true)`
10. `execute-php` → `delete_transient('gb_verify_css_{run_id}')`
11. `disable-file` → `novamira-sandbox/gb-verify-{run_id}.php`
12. `delete-file` → `novamira-sandbox/gb-verify-{run_id}.php`
13. Delete session file: `rm output/.verify-session.json`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-16-wp-verify-agent-workflow.md
git commit -m "docs: agent MCP workflow for wp-verify upload"
```
