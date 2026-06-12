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

  // Step 1: Inject data-gb-path on walker-processed elements FIRST
  // (so wrapper spans created later don't get paths)
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
        path = `${tag}.${firstClass}`;
      } else {
        pathCounters[tag] = (pathCounters[tag] || 0) + 1;
        path = `${tag}:nth-of-type(${pathCounters[tag]})`;
      }
      $el.attr("data-gb-path", path);
    });
  });

  // Step 2: Detect bare text nodes (WARNING only, no transformation)
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

  // Step 3: Detect empty divs (WARNING only, no removal)
  $("div").each((_, el) => {
    const $el = $(el);
    const html = $el.html();
    if (!html || html.trim().length === 0) {
      warnings.push(`Empty <div> detected — consider removing from source`);
    }
  });

  return { html: $.html(), warnings };
}
