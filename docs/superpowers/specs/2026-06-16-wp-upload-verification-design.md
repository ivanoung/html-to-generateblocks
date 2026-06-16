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

### 1. Sandbox Loader (`gb-verify-loader.php`)

A single PHP file written to `wp-content/novamira-sandbox/` that:
- Hooks `wp_head` at priority 1
- Reads `get_transient('gb_verify_css_{run_id}')` 
- If set, outputs `<style id="gb-verify">` with the CSS
- The `run_id` is passed via query param `?gb_verify={run_id}` on the WP page URL

Per-run isolation: each verification run generates a unique `run_id` (UUID). The transient key and query param are scoped to this ID, preventing concurrent runs from colliding.

```php
add_action('wp_head', function() {
    $run_id = $_GET['gb_verify'] ?? '';
    if (!$run_id) return;
    $css = get_transient("gb_verify_css_{$run_id}");
    if ($css) {
        echo '<style id="gb-verify">' . wp_strip_all_tags($css) . '</style>';
    }
}, 1);
```

### 2. CLI Command (`verify`)

```
npx tsx src/cli/index.ts verify <inputs/project/> [options]

Options:
  --pass <1|2>         Verification pass (default: 1)
  --wp-url <url>        WordPress site URL
  --wp-user <username>  WordPress username
  --wp-pass <password>  WordPress application password
```

The command:
1. Runs the conversion pipeline (Phase 1 always; Phase 2 if `--pass 2`)
2. Generates a unique `run_id`
3. Writes and enables the sandbox loader
4. Creates WP pages via `wp_insert_post()` for each converted HTML page
5. Sets the CSS transient (styles.css for pass 1, combined split CSS for pass 2)
6. Outputs WP page URLs with `?gb_verify={run_id}` appended
7. Prompts user for pass/fail per page
8. Cleans up: deletes posts, deletes transient, disables sandbox file

### 3. MCP Integration

The verify command calls Novamira MCP tools directly (not through CLI flags — the agent orchestrates):

| Step | MCP Tool | What it does |
|---|---|---|
| Setup loader | `write-file` | Create `novamira-sandbox/gb-verify-{run_id}.php` |
| Enable loader | `enable-file` | Activate the sandbox file |
| Create pages | `execute-php` | `wp_insert_post()` with block markup, publish |
| Set CSS | `execute-php` | `set_transient("gb_verify_css_{run_id}", $css, 900)` |
| Cleanup pages | `execute-php` | `wp_delete_post()` for each page |
| Cleanup CSS | `execute-php` | `delete_transient("gb_verify_css_{run_id}")` |
| Disable loader | `disable-file` | Deactivate the sandbox file |
| Delete loader | `delete-file` | Remove the sandbox file |

## Verification Flow

### Pass 1 — Verify Conversion Pipeline

```
for each page in project:
  execute-php → wp_insert_post(block_markup) → get permalink
execute-php → set_transient("gb_verify_css_{run_id}", styles.css, 900)

Output to user:
  ✓ ai-integrations:  https://staging.example.com/ai-integrations/?gb_verify=abc123
  ✓ index:            https://staging.example.com/index/?gb_verify=abc123
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
| Agent crash mid-verification | Short TTL auto-expires transients; sandbox file is inert without query param |
| wp_insert_post strips content | Verify `post_content` in response matches input; warn user if truncated |
| GB Pro license not active | Warn user before starting — gblocks_styles won't register without license |
| Relative URLs in CSS (`url(./image.png)`) | Warn user; CSS with relative URLs may not resolve correctly when injected as inline style |

## What This Does NOT Do

- **No automated pass/fail judgment** — the human decides
- **No screenshot or pixel comparison** — visual verification in browser
- **No gblocks_styles creation** — CSS is injected, not imported as editable GB styles
- **No JS upload** — app.js is not deployed (static verification only)
- **No permanent WP changes** — sandbox file is temporary, all content deleted after verification

## Success Criteria

1. User can run `verify inputs/<project>/` and get live WP page URLs within 30 seconds
2. Each WP page renders block markup with injected CSS, matching source HTML visually
3. Both Pass 1 (styles.css) and Pass 2 (split CSS) are supported
4. Cleanup removes all created content and disables the sandbox loader
5. No permanent files or settings remain on the WP site after verification
