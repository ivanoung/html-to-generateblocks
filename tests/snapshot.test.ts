import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CssClassifier } from "../src/core/css-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = resolve(__dirname, "snapshots");

const minoCss = readFileSync(resolve(process.cwd(), "output/mino/styles.css"), "utf-8");

describe("Golden Snapshots — mino", () => {
  it("Tailwind utility classes are filtered to raw CSS, not structured", () => {
    const result = CssClassifier.classify(minoCss);

    // These are Tailwind utilities — should be in rawCss, NOT structured
    assert.ok(result.rawCss.includes(".text-orange"), "text-orange should be in raw CSS (utility)");
    assert.ok(result.rawCss.includes(".bg-primary"), "bg-primary should be in raw CSS (utility)");
    assert.ok(result.rawCss.includes(".text-surface"), "text-surface should be in raw CSS (utility)");

    // Verify they are NOT in structured styles
    assert.ok(!result.structuredStyles.find((s) => s.selector === ".text-orange"), "text-orange should not be structured");
    assert.ok(!result.structuredStyles.find((s) => s.selector === ".bg-primary"), "bg-primary should not be structured");
  });

  it("custom design component classes ARE structured (not utilities)", () => {
    const result = CssClassifier.classify(minoCss);

    // Custom design classes should be in structured styles
    const blueprint = result.structuredStyles.find((s) => s.selector === ".blueprint-bg");
    if (blueprint) {
      // Verify no --tw-* variables leak into styles
      const vals = JSON.stringify(blueprint.styles);
      assert.ok(!vals.includes("--tw-"), "blueprint-bg should not contain --tw-* variables");
    }
  });

  it("structured styles count is reasonable (< 100, utilities filtered)", () => {
    const result = CssClassifier.classify(minoCss);
    assert.ok(result.structuredStyles.length < 100, `should have <100 structured styles after utility filtering, got ${result.structuredStyles.length}`);
    assert.ok(result.structuredStyles.length > 0, "should have at least some structured styles");
  });

  it("TAILWIND_UTILITY is the dominant rejection reason", () => {
    const result = CssClassifier.classify(minoCss);
    const summary = result.rejectionLog.toJSON(0);
    const parsed = JSON.parse(summary);
    assert.ok(parsed.summaryByReason.TAILWIND_UTILITY > 100, `expected >100 TAILWIND_UTILITY rejections, got ${parsed.summaryByReason.TAILWIND_UTILITY || 0}`);
  });
});
