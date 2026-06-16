# WP Upload Verification Assistant — Design Spec

**Date:** 2026-06-16
**Status:** Approved

## Overview

Add a `verify` CLI command to the gb-converter that uploads converted block markup and CSS to a staging WordPress site via Novamira Pro MCP. The user visually verifies the results by browsing the live WP pages. No automated screenshot or computed-style comparison — the agent handles the upload, the human handles the judgment.

## Motivation

Currently verification is fully manual: copy block markup from output files, paste into WordPress code editor, save, reload, confirm no "Attempt Recovery." This works but is tedious for projects with 10+ pages across two verification passes (styles.css pass + split CSS pass).

Novamira Pro MCP gives the agent direct WordPress access (execute PHP, write/read files). This eliminates the need to build custom REST endpoints or modify the WP site permanently.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Agent (pi)                                              │
│                                                          │
│  1. Read converted output files                          │
│  2. Novamira MCP → write-file sandbox loader             │
│  3. Novamira MCP → enable-file sandbox loader            │
│  4. Novamira MCP → execute-php wp_insert_post() per page │
│  5. Novamira MCP → execute-php set_transient() with CSS  │
│  6. Report WP page URLs to user                          │
│  7. Wait for user to confirm pass/fail                   │
│  8. Cleanup: delete posts, delete transient, disable file│
└──────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌──────────────────┐
│  Novamira MCP   │  │  Playwright       │
│  (WP access)    │  │  (not used for    │
│                 │  │   verification —  │
│  execute-php    │  │   only for CSS    │
│  write-file     │  │   compilation)    │
│  enable-file    │  │                   │
│  disable-file   │  │                   │
└─────────────────┘  └──────────────────┘
```

## Components

### 1. Session File (`output/.verify-session.json`)

A local JSON file persisted during verification to survive agent crashes:

```json
{
  "run_id": "abc123",
  "wp_url": "https://staging.example.com",
  "pass": 1,
  "created_posts": [{"slug": "index", "post_id": 42, "url": "..."}],
  "sandbox_file": "novamira-sandbox/gb-verify-abc123.php",
  "status": "awaiting_review"
}
```

This enables:
- **`verify status`** — reads the session file and shows what's live on WP
- **`verify cleanup`** — tears down everything from the session file (recovery from agent crash)
- **Orphan cleaner** — at start of every new `verify`, scan for stale transients, posts, and sandbox files from previous crashed runs; offer to clean them

### 2. Sandbox Loader (`gb-verify-loader.php`)

A single PHP file written to `wp-content/novamira-sandbox/` that:
- Hooks `wp_head` at priority 1
- Reads `get_transient('gb_verify_css_{run_id}')` 
- If set, outputs `<style id="gb-verify">` with the CSS
- The `run_id` is passed via query param `?gb_verify={run_id}` on the WP page URL

Per-run isolation: each verification run generates a unique `run_id` (UUID). The transient key and query param are scoped to this ID, preventing concurrent runs from colliding.

```php
add_action('wp_head', function() {
    $run_id = $_GET['gb_verify'] ?? '';
    $nonce  = $_GET['_nonce'] ?? '';
    if (!$run_id || !$nonce) return;
    // Capability check: only users who can edit posts + valid nonce
    if (!current_user_can('edit_posts')) return;
    $expected = wp_create_nonce('gb_verify_' . $run_id);
    if (!hash_equals($expected, $nonce)) return;
    $css = get_transient("gb_verify_css_{$run_id}");
    if ($css) {
        echo '<style id="gb-verify">' . wp_strip_all_tags($css) . '</style>';
    }
}, 1);
```

### 3. CLI Command (`verify`)

```
npx tsx src/cli/index.ts verify <inputs/project/> [options]

Options:
  --pass <1|2>         Verification pass (default: 1)
  --publish            Publish pages publicly (default: draft to avoid sitemap pollution)

Credentials via environment variables:
  GB_WP_URL            WordPress site URL
  GB_WP_USER           WordPress username
  GB_WP_PASS           WordPress application password

Subcommands:
  verify status         Show active verification session
  verify cleanup        Tear down all content from session file
```

The command:
1. Runs the conversion pipeline (Phase 1 always; Phase 2 if `--pass 2`)
2. Reads the session file; if a previous session exists, offers orphan cleanup
3. Writes the sandbox loader to `novamira-sandbox/gb-verify-{run_id}.php`
4. Enables the sandbox file
5. Creates WP pages via `wp_insert_post()` with draft status (or publish if `--publish`)
6. **Validates each post** — checks `post_content` in response matches input; fails per-page, not whole-run
7. Sets the CSS transient (styles.css for pass 1, combined split CSS for pass 2)
8. Generates a WP nonce for the run and appends `?gb_verify={run_id}&_nonce={nonce}` to each URL
9. Writes session file with all created post IDs and status
10. Outputs WP page URLs with query params
11. Prompts user for pass/fail per page
12. On quit or completion, cleans up: deletes posts, deletes transient, disables sandbox file, removes session file

**Transactional rollback:** If any step fails (e.g., `wp_insert_post` after `enable-file`), undo all prior steps before reporting the error. The session file tracks partial state for rollback.

### 4. MCP Integration

The verify command calls Novamira MCP tools directly (not through CLI flags — the agent orchestrates):

| Step | MCP Tool | What it does |
|---|---|---|
| Setup loader | `write-file` | Create `novamira-sandbox/gb-verify-{run_id}.php` |
| Enable loader | `enable-file` | Activate the sandbox file |
| Create pages | `execute-php` | `wp_insert_post()` with block markup, draft status |
| Validate posts | `execute-php` | `get_post()` verify `post_content` matches input |
| Set CSS | `execute-php` | `set_transient("gb_verify_css_{run_id}", $css, 900)` |
| Cleanup pages | `execute-php` | `wp_delete_post()` for each page |
| Cleanup CSS | `execute-php` | `delete_transient("gb_verify_css_{run_id}")` |
| Remove session | `delete-file` | Delete `output/.verify-session.json` |
| Disable loader | `disable-file` | Deactivate the sandbox file |
| Delete loader | `delete-file` | Remove the sandbox file |

## Verification Flow

### Pass 1 — Verify Conversion Pipeline

```
for each page in project:
  execute-php → wp_insert_post(block_markup) → get permalink
execute-php → set_transient("gb_verify_css_{run_id}", styles.css, 900)

Output to user:
  Pass 1 — styles.css
  ✓ ai-integrations:  https://staging.example.com/?p=42&gb_verify=abc123&_nonce=x1y2z3
  ✓ index:            https://staging.example.com/?p=43&gb_verify=abc123&_nonce=x1y2z3
  ...

  Open each URL. Compare against source HTML. Confirm pass/fail:
  [P]ass / [F]ail / [S]kip / [Q]uit
```

### Pass 2 — Verify CSS Split

Only runs if user requests `--pass 2` (and assumes Pass 1 already passed).

Same flow, but CSS transient contains combined `global-styles.json` CSS rules + `styles-unique.css`. Validates that the split didn't lose any styling.

### Cleanup

After user confirms or quits:
- Delete all created WP pages
- Delete the CSS transient
- Disable the sandbox loader file
- Delete the sandbox loader file (optional — can leave for next run)

## Edge Cases

| Scenario | Handling |
|---|---|
| WP page slug collision | Append `-{run_id}` to slugs |
| Transient not loaded (caching) | Cache-busting query param `?gb_verify={run_id}` ensures fresh render |
| Font loading delay | 900s transient TTL covers multiple verification attempts |
| Agent crash mid-verification | Session file persists; `verify cleanup` or `verify status` recovers |
| Orphaned content from crashed run | Orphan cleaner runs at start of new `verify`, offers to clean |
| wp_insert_post strips content | Validate `post_content` in response matches input; fail that page individually |
| One page fails, others ok | Fail per-page, not per-run; report partial success |
| GB Pro license not active | Warn user before starting — gblocks_styles won't register without license |
| Relative URLs in CSS (`url(./image.png)`) | Warn user; CSS with relative URLs may not resolve correctly when injected as inline style |
| Credentials in shell history | Use env vars (`GB_WP_*`), not CLI flags |
| Staging vs production | Warn if WP URL doesn't contain "staging", "dev", "local", or "test" |

## What This Does NOT Do

- **No automated pass/fail judgment** — the human decides
- **No screenshot or pixel comparison** — visual verification in browser
- **No gblocks_styles creation** — CSS is injected, not imported as editable GB styles
- **No JS upload** — app.js is not deployed (static verification only)
- **No permanent WP changes** — sandbox file is temporary, all content deleted after verification

## Success Criteria

1. User can run `verify inputs/<project>/` and get live WP page URLs within 30 seconds per page
2. Each WP page renders block markup with injected CSS, matching source HTML visually
3. Both Pass 1 (styles.css) and Pass 2 (split CSS) are supported
4. Cleanup removes all created content and disables the sandbox loader
5. No permanent files or settings remain on the WP site after verification
6. Agent crash mid-verification is recoverable via `verify cleanup` or `verify status`
7. Credentials are passed via environment variables, never CLI flags
8. Pages are created as drafts by default (no sitemap pollution)
9. One failed page does not block verification of remaining pages
