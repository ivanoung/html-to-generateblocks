import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCompare } from "../src/cli/compare.js";

const FIXTURE_SOURCE = resolve(process.cwd(), "fixtures/verify/good-simple.html");
const FIXTURE_OUTPUT = resolve(process.cwd(), "fixtures/verify/good-simple-output");

describe("compare (integration)", () => {
  it("produces compare-report.json with mismatch < 5% for known-good fixture", async () => {
    // Ensure rendered HTML exists first
    const { renderStandalone } = await import("../src/core/renderer.js");
    const renderedHtml = renderStandalone(FIXTURE_OUTPUT, "good-simple");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resolve(FIXTURE_OUTPUT, "pages", "index.rendered.html"), renderedHtml, "utf-8");

    await runCompare({
      sourcePath: FIXTURE_SOURCE,
      outputDir: FIXTURE_OUTPUT,
      threshold: 5,
    });

    const reportPath = resolve(FIXTURE_OUTPUT, "verify", "compare-report.json");
    assert.ok(existsSync(reportPath), "compare-report.json should exist");

    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    assert.strictEqual(report.source.status, "ok");
    assert.strictEqual(report.rendered.status, "ok");
    assert.ok(report.diff, "should have diff results");
    assert.ok(report.diff.mismatchPct < 5, `mismatch should be <5%, got ${report.diff.mismatchPct}%`);
  });

  it("produces screenshot files", async () => {
    const verifyDir = resolve(FIXTURE_OUTPUT, "verify");
    assert.ok(existsSync(resolve(verifyDir, "source.png")), "source.png should exist");
    assert.ok(existsSync(resolve(verifyDir, "rendered.png")), "rendered.png should exist");
    assert.ok(existsSync(resolve(verifyDir, "diff.png")), "diff.png should exist");
  });
});
