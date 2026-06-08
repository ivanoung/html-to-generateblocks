import { describe, it } from "node:test";
import assert from "node:assert";
import { preprocess } from "../src/core/preprocessor.js";

describe("preprocess customCss output", () => {
  it("includes simple class CSS rules in customCss", () => {
    const html = `<!DOCTYPE html><html><head>
      <style>
        body { background: #fff; }
        .clip-hex { clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
        .blueprint-bg { background-size: 40px 40px; background-image: linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px); }
        .hover-shadow-md:hover { box-shadow: 0 0 0 1px rgba(0,0,0,0.06); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      </style>
    </head><body><div class="clip-hex">test</div></body></html>`;

    const result = preprocess(html);

    // Simple class CSS should appear in customCss
    assert.ok(
      result.customCss.includes("clip-hex"),
      "clip-hex should be in customCss",
    );
    assert.ok(
      result.customCss.includes("blueprint-bg"),
      "blueprint-bg should be in customCss",
    );

    // Pseudo-class rules should still be in customCss
    assert.ok(
      result.customCss.includes("hover-shadow-md"),
      "hover-shadow-md should be in customCss",
    );
    assert.ok(
      result.customCss.includes("no-scrollbar"),
      "no-scrollbar should be in customCss",
    );

    // Non-class rules should still be in customCss
    assert.ok(
      result.customCss.includes("body"),
      "body rule should be in customCss",
    );

    // Simple classes should ALSO be in classNameToProperties for GB globalClasses
    assert.ok(
      result.classNameToProperties.has("clip-hex"),
      "clip-hex should be in classNameToProperties",
    );
  });

  it("does not duplicate customCss entries", () => {
    const html = `<!DOCTYPE html><html><head>
      <style>
        .simple { color: red; }
      </style>
    </head><body></body></html>`;

    const result = preprocess(html);
    const occurrences = (result.customCss.match(/\.simple/g) || []).length;
    assert.strictEqual(
      occurrences,
      1,
      ".simple should appear exactly once in customCss",
    );
  });
});
