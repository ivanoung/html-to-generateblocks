// ── Iconify Resolver ─────────────────────────────────────────
//
// Finds <iconify-icon> elements in HTML, fetches their SVG
// markup from the Iconify API, and replaces them in-place.
// Inserted between the Tailwind inliner and preprocessor
// in the convert pipeline.
//
// Caches SVGs in-memory per invocation. Falls back to
// leaving the tag if the API is unreachable — the
// preprocessor wraps unresolved tags in core/html.

import * as cheerio from "cheerio";

export interface IconifyResult {
  html: string;
  resolved: number;
  failed: string[];  // icon names that couldn't be resolved
}

const ICONIFY_API = "https://api.iconify.design";
const FETCH_TIMEOUT_MS = 5000;

export async function resolveIconifyIcons(rawHtml: string): Promise<IconifyResult> {
  const failed: string[] = [];
  let resolved = 0;

  const $ = cheerio.load(rawHtml);
  const icons = $("iconify-icon").toArray();

  if (icons.length === 0) {
    return { html: rawHtml, resolved: 0, failed: [] };
  }

  // In-memory cache for this invocation
  const cache = new Map<string, string>();

  for (const el of icons) {
    const $el = $(el);
    const iconAttr = ($el.attr("icon") || "").trim();

    if (!iconAttr) {
      failed.push("(missing icon attribute)");
      continue;
    }

    const colonIdx = iconAttr.indexOf(":");
    if (colonIdx === -1) {
      failed.push(iconAttr);
      continue;
    }

    const prefix = iconAttr.substring(0, colonIdx);
    const name = iconAttr.substring(colonIdx + 1);
    const cacheKey = `${prefix}:${name}`;

    try {
      let svgText: string;

      if (cache.has(cacheKey)) {
        svgText = cache.get(cacheKey)!;
      } else {
        const url = `${ICONIFY_API}/${prefix}/${name}.svg`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          failed.push(cacheKey);
          continue;
        }

        svgText = await response.text();
        cache.set(cacheKey, svgText);
      }

      // Transfer attributes from <iconify-icon> to <svg>
      const $svg = cheerio.load(svgText)("svg");
      if ($svg.length === 0) {
        failed.push(cacheKey);
        continue;
      }

      // Copy width, height, class, style from iconify-icon
      const width = $el.attr("width");
      const height = $el.attr("height");
      const cls = $el.attr("class");
      const style = $el.attr("style");

      if (width && !$svg.attr("width")) $svg.attr("width", width);
      if (height && !$svg.attr("height")) $svg.attr("height", height);
      if (cls) {
        const existingClass = $svg.attr("class") || "";
        $svg.attr("class", [existingClass, cls].filter(Boolean).join(" "));
      }
      if (style) {
        const existingStyle = $svg.attr("style") || "";
        $svg.attr("style", [existingStyle, style].filter(Boolean).join(";"));
      }

      // Replace <iconify-icon> with <svg>
      $el.replaceWith($.html($svg));
      resolved++;
    } catch {
      // Network error, timeout, or invalid SVG — leave tag as-is
      failed.push(cacheKey);
    }
  }

  // Return the modified HTML (entire document, not just body)
  return {
    html: $.html(),
    resolved,
    failed,
  };
}
