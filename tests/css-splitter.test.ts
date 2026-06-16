import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss (canonicalized)", () => {
  it("returns uniqueCss and rejectionJson", () => {
    const css = ".pt-32{padding-top:8rem}.flex{display:flex}body{margin:0}";
    const result = splitCss(css);
    assert.strictEqual(typeof result.uniqueCss, "string");
    assert.ok(result.uniqueCss.length > 0, "uniqueCss should not be empty");
    assert.ok(result.uniqueCss.includes("body"), "body rule should be in unique css");
    assert.strictEqual(typeof result.rejectionJson, "string");
    JSON.parse(result.rejectionJson); // should not throw
  });

  it("routes non-class selectors to uniqueCss", () => {
    const css = "body{background:#eee}::selection{color:green}";
    const result = splitCss(css);
    assert.ok(result.uniqueCss.includes("body"));
    assert.ok(result.uniqueCss.includes("selection"));
  });

  it("routes transform rules to uniqueCss", () => {
    const css = ".rotate-6{transform:rotate(6deg)}";
    const result = splitCss(css);
    assert.ok(result.uniqueCss.includes("rotate-6"), "transform rule should be in unique css");
  });

  it("produces valid rejectionJson", () => {
    const css = ".text-orange{--tw-text-opacity:1;color:rgb(255 127 89 / var(--tw-text-opacity, 1))}";
    const result = splitCss(css);
    const rejection = JSON.parse(result.rejectionJson);
    assert.strictEqual(typeof rejection.version, "string");
    assert.strictEqual(typeof rejection.totalRules, "number");
    assert.strictEqual(typeof rejection.rejectedRules, "number");
    assert.strictEqual(typeof rejection.rejectionRate, "string");
    assert.ok(Array.isArray(rejection.rejections));
    assert.strictEqual(typeof rejection.summaryByReason, "object");
  });

  it("canonicalizes --tw-text-opacity in class rules (they go to globalStyles, not unique)", () => {
    const css = ".text-orange{--tw-text-opacity:1;color:rgb(255 127 89 / var(--tw-text-opacity, 1))}";
    const result = splitCss(css);
    // The class is canonicalized and fully GB-compatible, so it should NOT appear in unique CSS
    assert.ok(!result.uniqueCss.includes("text-orange"), "canonicalized class should not be in unique css");
  });
});
