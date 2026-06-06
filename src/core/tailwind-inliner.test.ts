import { inlineTailwindStyles, usesTailwind } from "./tailwind-inliner.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  // Test with the real Mino page (has inline tailwind.config, reliable)
  const html = readFileSync(
    resolve(process.cwd(), "inputs/mino/index.html"),
    "utf-8",
  );

  console.log("usesTailwind:", usesTailwind(html));

  const start = Date.now();
  const result = await inlineTailwindStyles(html);
  console.log("elapsed:", Date.now() - start, "ms");
  console.log("elementCount:", result.elementCount);
  console.log("warnings:", result.warnings);
  console.log("classList count:", Object.keys(result.classListPerElement).length);
  console.log("styleBlocks count:", result.styleBlocks.length);

  // The result should have NO Tailwind classes
  const hasTailwindAfter =
    /class="[^"]*(?:pt-32|lg:pt-48|text-5xl|lg:text-8xl|font-display|text-surface|flex|grid-cols-1|gap-12)/.test(
      result.html,
    );
  console.log("still has Tailwind classes:", hasTailwindAfter);

  // The result should have inline styles
  const hasInlineStyles = /style="[^"]{30,}"/.test(result.html);
  console.log("has inline styles:", hasInlineStyles);

  // No script/link tags
  const hasCdnRefs = /<script|<link/.test(result.html);
  console.log("has CDN refs:", hasCdnRefs);

  // Output size comparison
  console.log("input size:", html.length, "bytes");
  console.log("output size:", result.html.length, "bytes");

  // Find grid-cols elements
  let foundGC = false;
  for (const [idx, cls] of Object.entries(result.classListPerElement)) {
    const clsStr = String(cls || "");
    if (clsStr.includes("grid-cols")) {
      foundGC = true;
      console.log(clsStr.substring(0, 80), "at idx", idx);
      const re = new RegExp('data-gb-idx="' + idx + '"[^>]*style="([^"]*)"');
      const m = result.html.match(re);
      if (m) {
        const tc = (m[1] || "").match(/grid-template-columns[^;]*/);
        console.log("  grid-template-columns:", tc ? tc[0].substring(0, 80) : "NOT FOUND");
      }
    }
  }
  if (!foundGC) console.log("grid-cols-*: NOT FOUND in any class list");

  if (hasTailwindAfter || !hasInlineStyles || hasCdnRefs) {
    console.error("\n❌ Checks failed");
    process.exit(1);
  }

  // Write output for inspection
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    resolve(process.cwd(), "output/mino/index-inlined-test.html"),
    result.html,
    "utf-8",
  );
  console.log("\n✅ All checks passed — inlined output written to output/mino/index-inlined-test.html");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
