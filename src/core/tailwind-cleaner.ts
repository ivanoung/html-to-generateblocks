import * as cheerio from "cheerio";

export interface CleanResult {
  html: string;
  warnings: string[];
}

const BLOCK_TAGS = new Set(["section", "div", "header", "footer", "nav", "main", "article", "aside"]);
const WALKER_TAGS = ["section", "div", "header", "footer", "nav", "main", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "img", "svg"];

export function cleanTailwindSource(rawHtml: string): CleanResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml, { decodeEntities: false, xmlMode: false });

  // Inject data-gb-path on walker-processed elements.
  // These paths are used by: (a) the inliner to capture computed styles,
  // (b) the DOM walker to match elements against classified computed styles.
  const pathCounters: Record<string, number> = {};
  WALKER_TAGS.forEach(tag => {
    $(tag).each((_, el) => {
      const $el = $(el);
      const id = $el.attr("id");
      const classes = $el.attr("class");
      let path: string;
      if (id) {
        path = `${tag}#${id}`;
      } else if (classes) {
        const firstClass = classes.split(/\s+/)[0];
        const key = `${tag}.${firstClass}`;
        pathCounters[key] = (pathCounters[key] || 0) + 1;
        path = `${tag}.${firstClass}.${pathCounters[key] - 1}`;
      } else {
        pathCounters[tag] = (pathCounters[tag] || 0) + 1;
        path = `${tag}:nth-of-type(${pathCounters[tag]})`;
      }
      $el.attr("data-gb-path", path);
    });
  });

  // Detect bare text nodes (WARNING only, no transformation)
  $("*").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    if (!tag || !BLOCK_TAGS.has(tag)) return;
    const childNodes = (el as any).childNodes || [];
    for (const child of childNodes) {
      if (child.type === "text") {
        const text = ((child as any).data || "").trim();
        if (text.length === 0) continue;
        warnings.push(`Bare text in <${tag}>: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}" — consider wrapping in <p> or <span>`);
      }
    }
  });

  return { html: $.html(), warnings };
}
