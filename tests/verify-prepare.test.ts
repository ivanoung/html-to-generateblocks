import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  stylesToCss,
  prepareVerification,
} from "../src/core/verify-prepare.js";
import type { VerifySession } from "../src/core/verify-session.js";

// ── Helpers ────────────────────────────────────────────────

function makeSession(overrides: Partial<VerifySession> = {}): VerifySession {
  return {
    runId: "test1234",
    wpUrl: "https://staging.example.com",
    pass: 1,
    projectDir: "test-project",
    createdPosts: [],
    sandboxFile: "novamira-sandbox/gb-verify-test1234.php",
    status: "preparing",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests: stylesToCss ──────────────────────────────────────

describe("stylesToCss", () => {

  it("converts camelCase properties to kebab-case CSS", () => {
    const result = stylesToCss({
      fontSize: "16px",
      backgroundColor: "#fff",
    });
    // Order depends on Object.entries; both are valid
    assert.ok(result.includes("font-size: 16px"), "should include font-size");
    assert.ok(result.includes("background-color: #fff"), "should include background-color");
    assert.ok(result.endsWith(";"), "should end with semicolon");
  });

  it("handles nested :hover pseudo-class", () => {
    const result = stylesToCss({
      color: "#000",
      ":hover": { color: "#fff" } as unknown as string,
    });
    assert.ok(result.includes("color: #000;"), "should include base color");
    assert.ok(result.includes(":hover"), "should include :hover pseudo-class");
    assert.ok(result.includes("color: #fff;"), "should include hover color");
  });

  it("handles nested @media rules", () => {
    const result = stylesToCss({
      fontSize: "16px",
      "@media (max-width: 768px)": { fontSize: "14px" } as unknown as string,
    });
    assert.ok(result.includes("font-size: 16px;"), "should include base font-size");
    assert.ok(result.includes("@media (max-width: 768px)"), "should include media query");
    assert.ok(result.includes("font-size: 14px;"), "should include responsive font-size");
  });

  it("returns empty string for empty styles object", () => {
    assert.strictEqual(stylesToCss({}), "");
  });

  it("skips null, undefined, and empty string values", () => {
    const result = stylesToCss({
      color: "red" as unknown as string,
      opacity: null as unknown as string,
      display: undefined as unknown as string,
      margin: "" as unknown as string,
    });
    assert.ok(result.includes("color: red"), "should keep valid values");
    assert.ok(!result.includes("opacity"), "should skip null");
    assert.ok(!result.includes("display"), "should skip undefined");
    assert.ok(!result.includes("margin"), "should skip empty string");
  });
});

// ── Tests: prepareVerification ──────────────────────────────

describe("prepareVerification", () => {

  it("throws when pages directory does not exist", () => {
    const session = makeSession({ projectDir: "nonexistent-project" });
    assert.throws(
      () => prepareVerification(session),
      /Pages directory not found/,
      "should throw when pages dir missing",
    );
  });

  it("returns correct page count and CSS for a real converted project", () => {
    // Ensure pattern2-demo output exists
    const outDir = resolve(process.cwd(), "output", "pattern2-demo");
    const pagesDir = resolve(outDir, "pages");

    // Always create fresh test data
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(resolve(pagesDir, "index.html"), "<!-- wp:test -->\n<!-- /wp:test -->\n", "utf-8");
    writeFileSync(resolve(pagesDir, "about.html"), "<!-- wp:test -->\n<!-- /wp:test -->\n", "utf-8");
    writeFileSync(resolve(pagesDir, "index.report.json"), JSON.stringify({ hardFails: [], overallStatus: "pass" }), "utf-8");
    writeFileSync(resolve(pagesDir, "about.report.json"), JSON.stringify({ hardFails: [], overallStatus: "pass" }), "utf-8");
    writeFileSync(resolve(outDir, "styles.css"), "body { margin: 0; }\n.bg-blue { background: blue; }\n", "utf-8");

    // Setup dir for pass 2
    const setupDir = resolve(outDir, "setup");
    mkdirSync(setupDir, { recursive: true });
    writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify({
      version: "1.0",
      styles: [
        { selector: ".bg-blue", name: "Bg Blue", styles: { backgroundColor: "blue" }, raw: false },
        { selector: ".text-lg", name: "Text Lg", styles: { fontSize: "1.125rem", lineHeight: "1.75rem" }, raw: false },
      ],
    }), "utf-8");
    writeFileSync(resolve(setupDir, "tailwind-utilities.css"), ".pt-4 { padding-top: 1rem; }\n", "utf-8");
    writeFileSync(resolve(setupDir, "styles-unique.css"), "@keyframes fade { 0% { opacity: 0; } }\n", "utf-8");

    // Pass 1: styles.css
    const session1 = makeSession({ projectDir: "pattern2-demo", pass: 1 });
    const result1 = prepareVerification(session1);

    assert.strictEqual(result1.pages.length, 2, "should have 2 pages");
    assert.strictEqual(result1.cssSource, "styles.css", "should use styles.css as source");
    assert.ok(result1.cssPayload.includes("body"), "CSS should include body rule");
    assert.ok(result1.cssPayload.includes(".bg-blue"), "CSS should include .bg-blue rule");

    const indexPage = result1.pages.find(p => p.slug === "index");
    assert.ok(indexPage, "should have index page");
    assert.ok(indexPage!.blockMarkup.includes("<!-- wp:test -->"), "block markup should be preserved");
    assert.ok(indexPage!.postTitle.includes("pattern2-demo"), "title should include project dir");
    assert.ok(indexPage!.postTitle.includes("[verify test1234]"), "title should include run ID");

    // Pass 2: split CSS
    const session2 = makeSession({ projectDir: "pattern2-demo", pass: 2 });
    const result2 = prepareVerification(session2);

    assert.strictEqual(result2.pages.length, 2, "should have 2 pages");
    assert.strictEqual(result2.cssSource, "global-styles.json + tailwind-utilities.css + styles-unique.css", "should use split CSS source");
    assert.ok(result2.cssPayload.includes(".bg-blue"), "CSS should include .bg-blue from global-styles.json");
    assert.ok(result2.cssPayload.includes("font-size: 1.125rem"), "CSS should include font-size from global-styles.json");
    assert.ok(result2.cssPayload.includes(".pt-4"), "CSS should include .pt-4 from tailwind-utilities.css");
    assert.ok(result2.cssPayload.includes("@keyframes fade"), "CSS should include keyframes from styles-unique.css");
  });
});
