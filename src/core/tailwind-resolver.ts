// ── Tailwind Resolver ──────────────────────────────────────
//
// Extracts tailwind.config from HTML <script> blocks and compiles
// the Tailwind CSS for the page. Outputs a minified CSS file.



/**
 * Extract tailwind.config = {...} from raw HTML.
 * Returns the config object string, or null if not found.
 */
export function extractTailwindConfig(rawHtml: string): string | null {
  const startMatch = rawHtml.match(/tailwind\.config\s*=\s*/);
  if (!startMatch) return null;

  // Parse balanced braces starting from the opening {
  let startIdx = (startMatch.index || 0) + startMatch[0].length;
  if (rawHtml[startIdx] !== "{") return null;

  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < rawHtml.length; i++) {
    if (rawHtml[i] === "{") depth++;
    else if (rawHtml[i] === "}") {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  let config = rawHtml.substring(startIdx, endIdx);
  // Remove trailing commas (invalid in CJS module.exports)
  config = config.replace(/,(\s*[}\]])/g, "$1");
  return config;
}


