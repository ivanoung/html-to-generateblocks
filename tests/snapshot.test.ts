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
  it("global-styles.json has key entries canonicalized (no --tw-*)", () => {
    const result = CssClassifier.classify(minoCss);

    // Verify key entries are canonicalized (no --tw-* variables)
    const textOrange = result.structuredStyles.find((s) => s.selector === ".text-orange");
    assert.ok(textOrange, "text-orange should exist");
    assert.strictEqual((textOrange!.styles as any).color, "rgb(255, 127, 89)");

    const bgPrimary = result.structuredStyles.find((s) => s.selector === ".bg-primary");
    assert.ok(bgPrimary, "bg-primary should exist");
    assert.strictEqual((bgPrimary!.styles as any).backgroundColor, "rgb(197, 255, 214)");

    const textSurface = result.structuredStyles.find((s) => s.selector === ".text-surface");
    assert.ok(textSurface, "text-surface should exist");
    assert.strictEqual((textSurface!.styles as any).color, "rgb(30, 41, 59)");

    // Verify no --tw-* variables leak into styles
    for (const s of result.structuredStyles) {
      const vals = JSON.stringify(s.styles);
      assert.ok(!vals.includes("--tw-"), `${s.selector} should not contain --tw-* variables`);
    }

    // Verify reasonable count (> 500 expected)
    assert.ok(result.structuredStyles.length > 500, `should have >500 structured styles, got ${result.structuredStyles.length}`);
  });

  it("styles-unique.css matches snapshot", () => {
    const result = CssClassifier.classify(minoCss);
    const expected = readFileSync(resolve(SNAPSHOTS, "mino-styles-unique.css"), "utf-8");
    assert.strictEqual(result.rawCss.trim(), expected.trim(), "styles-unique.css should match golden snapshot");
  });

  it("rejected.json matches snapshot (count + summary)", () => {
    const result = CssClassifier.classify(minoCss);
    // Count total rules from the CSS
    const totalRules = minoCss.match(/\{[^}]*\}/g)?.length || 0;
    const actual = JSON.parse(result.rejectionLog.toJSON(totalRules));
    const expected = JSON.parse(readFileSync(resolve(SNAPSHOTS, "mino-rejected.json"), "utf-8"));
    assert.strictEqual(actual.rejectedRules, expected.rejectedRules, "rejection count should match");
    assert.deepStrictEqual(actual.summaryByReason, expected.summaryByReason, "summary by reason should match");
  });
});
