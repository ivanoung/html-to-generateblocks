# WP Verify — Agent MCP Workflow

This document describes the exact Novamira MCP calls the agent makes after `verify:prepare` completes.

## Setup

1. Read session file: `cat output/.verify-session.json`
2. Extract: `run_id`, `wp_url`, `pass`, `projectDir`

## Sandbox Loader

**PHP file content** (with `{run_id}` substituted):

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
    'post_content' => '{blockMarkup escaped for PHP string}',
    'post_status'  => 'draft',
    'post_type'    => 'page',
    'post_name'    => '{slug}-{run_id}',
], true);

if (is_wp_error($post_id)) {
    return ['error' => $post_id->get_error_message()];
}

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
