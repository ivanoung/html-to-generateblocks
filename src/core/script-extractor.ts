// ── Script Extractor ─────────────────────────────────────────
//
// Extracts all <script> tags from HTML pages and produces a single
// global.js file with external references (as enqueue comments)
// and inline content preserved.

export interface ScriptEntry {
  type: "external" | "inline";
  src?: string;
  content: string;
  sourcePage: string;
}

/**
 * Extract all <script> tags from an HTML string.
 */
export function extractScripts(
  html: string,
  pageName: string,
): ScriptEntry[] {
  const scripts: ScriptEntry[] = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2].trim();

    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    if (srcMatch) {
      scripts.push({
        type: "external",
        src: srcMatch[1],
        content: srcMatch[1],
        sourcePage: pageName,
      });
    } else if (body.length > 0) {
      scripts.push({
        type: "inline",
        content: body,
        sourcePage: pageName,
      });
    }
  }

  return scripts;
}

/**
 * Deduplicate scripts: same src URL or same normalized inline content.
 * Preserves first occurrence order.
 */
export function deduplicateScripts(allScripts: ScriptEntry[]): ScriptEntry[] {
  const seen = new Set<string>();
  const result: ScriptEntry[] = [];

  for (const script of allScripts) {
    const key =
      script.type === "external"
        ? `ext:${script.src}`
        : `inline:${script.content.replace(/\s+/g, " ").trim()}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(script);
    }
  }

  return result;
}

/**
 * Generate a slug from a URL for wp_enqueue_script handle.
 */
function slugFromUrl(url: string): string {
  const name = url.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "-") || "script";
  return name.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Format scripts as a global.js file.
 * External scripts become enqueue comments. Inline scripts are preserved as-is.
 */
export function formatGlobalJs(scripts: ScriptEntry[]): string {
  const externals = scripts.filter((s) => s.type === "external");
  const inlines = scripts.filter((s) => s.type === "inline");

  const lines: string[] = [];

  if (externals.length > 0) {
    lines.push("// === External Scripts ===");
    lines.push("// These are loaded as <script> tags directly.");
    lines.push("// For proper WP integration, enqueue in functions.php:");
    lines.push("//");
    for (const s of externals) {
      const handle = slugFromUrl(s.src!);
      lines.push(`document.write('<script src="${s.src}"><\\/script>');`);
      lines.push(`//   wp_enqueue_script('${handle}', '${s.src}', [], null, true);`);
      lines.push("");
    }
    lines.push("");
  }

  if (inlines.length > 0) {
    lines.push("// === Inline Scripts ===");
    lines.push("");
    for (const s of inlines) {
      lines.push(`// -- From ${s.sourcePage}.html --`);
      lines.push(s.content);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}
