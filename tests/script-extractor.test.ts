import { describe, it } from "node:test";
import assert from "node:assert";
import { extractScripts, deduplicateScripts, formatGlobalJs } from "../src/core/script-extractor.js";

describe("extractScripts", () => {
  it("extracts external and inline scripts", () => {
    const html = `<html><head>
      <script src="https://cdn.example.com/lib.js"></script>
      <script>console.log("inline");</script>
    </head><body></body></html>`;
    const result = extractScripts(html, "test");
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].type, "external");
    assert.strictEqual(result[0].src, "https://cdn.example.com/lib.js");
    assert.strictEqual(result[1].type, "inline");
    assert.ok(result[1].content.includes('console.log("inline")'));
  });

  it("skips empty inline scripts", () => {
    const html = `<script>  </script><script src="a.js"></script>`;
    const result = extractScripts(html, "test");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "external");
  });

  it("records source page name", () => {
    const result = extractScripts(`<script>a</script>`, "index");
    assert.strictEqual(result[0].sourcePage, "index");
  });
});

describe("deduplicateScripts", () => {
  it("deduplicates external scripts by src URL", () => {
    const input = [
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "index" },
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "blog" },
      { type: "external" as const, src: "https://cdn.com/b.js", content: "https://cdn.com/b.js", sourcePage: "blog" },
    ];
    const result = deduplicateScripts(input);
    assert.strictEqual(result.length, 2);
  });

  it("deduplicates inline scripts by normalized content", () => {
    const input = [
      { type: "inline" as const, content: "console.log(1)", sourcePage: "index" },
      { type: "inline" as const, content: "  console.log(1)  ", sourcePage: "blog" },
      { type: "inline" as const, content: "console.log(2)", sourcePage: "blog" },
    ];
    const result = deduplicateScripts(input);
    assert.strictEqual(result.length, 2);
  });
});

describe("formatGlobalJs", () => {
  it("formats external scripts as comments with wp_enqueue_script", () => {
    const scripts = [
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "index" },
    ];
    const output = formatGlobalJs(scripts);
    assert.ok(output.includes("External Scripts"));
    assert.ok(output.includes("cdn.com/a.js"));
    assert.ok(output.includes("wp_enqueue_script"));
  });

  it("formats inline scripts with source comment", () => {
    const scripts = [
      { type: "inline" as const, content: "console.log(1)", sourcePage: "index" },
    ];
    const output = formatGlobalJs(scripts);
    assert.ok(output.includes("Inline Scripts"));
    assert.ok(output.includes("From index.html"));
    assert.ok(output.includes("console.log(1)"));
  });
});
