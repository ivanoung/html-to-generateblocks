import { describe, it } from "node:test";
import assert from "node:assert";
import { cleanTailwindSource } from "../src/core/tailwind-cleaner.js";

describe("cleanTailwindSource", () => {
  it("warns about bare text nodes instead of wrapping them", () => {
    const input = '<div>Hello world</div>';
    const result = cleanTailwindSource(input);
    assert.ok(result.warnings.length > 0, "should produce warning for bare text");
    assert.ok(result.warnings.some(w => w.includes("Hello world")), "warning should mention the text");
    // HTML should NOT be modified
    assert.ok(result.html.includes(">Hello world<"), "HTML should not be modified");
    assert.ok(!result.html.includes("<span>"), "should not wrap in span");
  });

  it("warns about empty divs instead of removing them", () => {
    const input = '<div></div><section>content</section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.warnings.some(w => w.includes("Empty")), "should warn about empty div");
    // Empty div should remain (but may have data-gb-path injected)
    assert.ok(result.html.includes('<div'), "empty div should remain in HTML");
    assert.ok(result.html.includes("content"), "section should remain");
  });

  it("does not touch already-wrapped text", () => {
    const input = '<section><p>Already wrapped</p></section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes("Already wrapped</p>"), "already-wrapped text preserved");
    assert.strictEqual(result.warnings.length, 0, "no warnings for wrapped text");
  });

  it("injects data-gb-path on target elements", () => {
    const input = '<section id="hero" class="px-8"><h1>Title</h1></section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes('data-gb-path="section#hero"'), "section should get path with id");
    assert.ok(result.html.includes('data-gb-path="h1:nth-of-type(1)"'), "h1 should get fallback path");
  });
});
