// ── Structure Parser (Phase 2) ─────────────────────────────────
//
// Takes a raw HTML page and splits it into section snippets.
// Strips nav, footer, scripts. Detects section boundaries.

import * as cheerio from "cheerio";
import type { SectionSnippet, PageMeta } from "../types/manifest.js";

const STRIP_TAGS = ["nav", "footer", "script", "style", "link"];

/** CSS unit value → pixels at 16px base. Returns NaN for unresolvable values. */
function toPx(value: string): number {
  const v = value.trim();
  if (v.endsWith("px")) return parseFloat(v);
  if (v.endsWith("rem")) return parseFloat(v) * 16;
  if (v.endsWith("em")) return parseFloat(v) * 16;
  const num = parseFloat(v);
  return isNaN(num) ? NaN : num;
}

export interface ParseStructureResult {
  snippets: SectionSnippet[];
  pageMeta: PageMeta;
  warnings: string[];
}

export function parseStructure(rawHtml: string): ParseStructureResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml);

  // Extract page metadata
  const pageMeta: PageMeta = {
    title: $("title").first().text() || "",
    fontFamilies: [],
    description: $('meta[name="description"]').attr("content") || "",
  };

  // Extract font families from Google Fonts links
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const families = href.match(/family=([^&]+)/);
    if (families) {
      const decoded = decodeURIComponent(families[1]);
      decoded.split("|").forEach((f) => {
        const name = f.split(":")[0].replace(/\+/g, " ");
        pageMeta.fontFamilies.push(name);
      });
    }
  });

  // Strip non-content elements
  for (const tag of STRIP_TAGS) {
    $(tag).remove();
  }

  const $body = $("body");
  if ($body.length === 0) {
    return { snippets: [], pageMeta, warnings: ["No <body> found"] };
  }

  const snippets: SectionSnippet[] = [];

  // Priority 1: <section> tags with id
  const $sections = $body.find("section[id]");
  if ($sections.length > 0) {
    $sections.each((_, el) => {
      const $el = $(el);
      const id = $el.attr("id") || `section-${snippets.length + 1}`;
      const childCount = $el.find("*").length;
      snippets.push({
        sectionId: id,
        html: $.html(el),
        elementCount: childCount,
        isDecorative: false,
      });
    });

    // Attach decorative dividers (aria-hidden) to adjacent sections
    $body.children().each((i, el) => {
      const $el = $(el);
      if ($el.attr("aria-hidden") === "true" && !$el.is("section[id]")) {
        // Attach to preceding section if it exists
        const prevSnippet = snippets.find((s) => {
          const prevEl = $body.find(`section[id="${s.sectionId}"]`).prev();
          return prevEl.length && $.html(prevEl) === $.html(el);
        });
        if (prevSnippet) {
          prevSnippet.html += "\n" + $.html(el);
        }
      }
    });

    // Merge very short sections (< 2 elements) with previous
    for (let i = snippets.length - 1; i > 0; i--) {
      if (snippets[i].elementCount < 2 && !snippets[i].isDecorative) {
        snippets[i - 1].html += "\n" + snippets[i].html;
        snippets[i - 1].elementCount += snippets[i].elementCount;
        snippets.splice(i, 1);
      }
    }

    return { snippets, pageMeta, warnings };
  }

  // Priority 2: <div> elements with structural styles
  // (padding ≥ 64px, min-height ≥ 50vh, or margin-top ≥ 64px)
  const candidates: { el: cheerio.Cheerio<any>; id: string }[] = [];
  $body.find("div[style]").each((_, el) => {
    const style = $(el).attr("style") || "";
    const pt = style.match(/padding-top\s*:\s*([^;]+)/);
    const pb = style.match(/padding-bottom\s*:\s*([^;]+)/);
    const mh = style.match(/min-height\s*:\s*([^;]+)/);
    const mt = style.match(/margin-top\s*:\s*([^;]+)/);

    const ptPx = pt ? toPx(pt[1]) : 0;
    const pbPx = pb ? toPx(pb[1]) : 0;
    const mhVh = mh ? (mh[1].includes("vh") ? parseFloat(mh[1]) : 0) : 0;
    const mtPx = mt ? toPx(mt[1]) : 0;

    if (ptPx >= 64 || pbPx >= 64 || mhVh >= 50 || mtPx >= 64) {
      const id = $(el).attr("id") || `section-${candidates.length + 1}`;
      candidates.push({ el: $(el), id });
    }
  });

  if (candidates.length > 0) {
    for (const { el, id } of candidates) {
      snippets.push({
        sectionId: id,
        html: $.html(el),
        elementCount: el.find("*").length,
        isDecorative: false,
      });
    }
    return { snippets, pageMeta, warnings };
  }

  // Priority 3: Fallback — wrap entire <main> as one section
  const $main = $body.find("main");
  if ($main.length > 0) {
    snippets.push({
      sectionId: "main",
      html: $.html($main),
      elementCount: $main.find("*").length,
      isDecorative: false,
    });
    return { snippets, pageMeta, warnings };
  }

  // Final fallback: entire body
  if ($body.children().length > 0) {
    snippets.push({
      sectionId: "body",
      html: $.html($body),
      elementCount: $body.find("*").length,
      isDecorative: false,
    });
    return { snippets, pageMeta, warnings };
  }

  warnings.push("No content sections detected in page");
  return { snippets: [], pageMeta, warnings };
}
