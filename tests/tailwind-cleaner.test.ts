import { describe, it } from "node:test";
import assert from "node:assert";
import { cleanTailwindSource } from "../src/core/tailwind-cleaner.js";

describe("cleanTailwindSource", () => {
  it("wraps bare text nodes inside div with span (< 60 chars)", () => {
    const input = '<div>Hello world</div>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes("<span>Hello world</span>"), "bare text should be wrapped in span for <60 chars");
  });

  it("wraps longer bare text in <p> (>= 60 chars)", () => {
    const longText = "This is a much longer piece of text that should be wrapped in a paragraph tag instead of a span because it exceeds sixty characters in length";
    const input = `<div>${longText}</div>`;
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes(`<p>${longText}</p>`), "longer text should be wrapped in <p>");
  });

  it("does not touch already-wrapped text", () => {
    const input = '<section><p>Already wrapped</p></section>';
    const result = cleanTailwindSource(input);
    // The <p> gets data-gb-path injected but the content is unchanged
    assert.ok(result.html.includes("Already wrapped</p>"), "already-wrapped text preserved");
  });

  it("injects data-gb-path on target elements", () => {
    const input = '<section id="hero" class="px-8"><h1>Title</h1></section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes('data-gb-path="section#hero"'), "section should get path with id");
    assert.ok(result.html.includes('data-gb-path="h1:nth-of-type(1)"'), "h1 should get fallback path");
  });

  it("strips empty div elements", () => {
    const input = '<div></div><section>content</section>';
    const result = cleanTailwindSource(input);
    assert.ok(!result.html.includes('<div></div>'), "empty div should be removed");
    assert.ok(result.html.includes("content"), "section should remain");
  });

  it("does not inject data-gb-path on wrapper spans created by cleaner", () => {
    const input = '<div>bare text</div>';
    const result = cleanTailwindSource(input);
    // The div gets a path, but the wrapper span should NOT
    const spansWithPath = (result.html.match(/<span[^>]*data-gb-path/g) || []).length;
    assert.strictEqual(spansWithPath, 0, "wrapper spans should not have data-gb-path");
  });
});
