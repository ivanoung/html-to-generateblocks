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

  // Check relative value reconstruction
  const hasRepeat = result.html.includes("repeat(");
  console.log("Has repeat():", hasRepeat);
  const idx = result.html.indexOf("grid-template-columns");
  if (idx >= 0) {
    console.log("Grid cols at", idx, ":", result.html.substring(idx, idx + 80));
  }

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
