import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import { captureFullPage } from "../src/core/screenshotter.js";
import { resolve } from "node:path";

const FIXTURE_HTML = resolve(process.cwd(), "fixtures/verify/good-simple-output/pages/good-simple.rendered.html");

describe("captureFullPage", () => {
  it("captures a full-page screenshot as PNG", async () => {
    // First ensure rendered HTML exists
    if (!existsSync(FIXTURE_HTML)) {
      throw new Error(`Fixture not found: ${FIXTURE_HTML}. Run render command first.`);
    }

    const outPath = resolve(process.cwd(), "fixtures/verify/tmp/screenshotter-test.png");
    const result = await captureFullPage(FIXTURE_HTML, outPath, { width: 1440, height: 900 });

    assert.ok(existsSync(outPath), "screenshot file should exist");
    assert.ok(result.width > 0, "should have positive width");
    assert.ok(result.height > 0, "should have positive height");
    assert.strictEqual(result.status, "ok");

    // Cleanup
    try { unlinkSync(outPath); } catch {}
  });

  it("reports error status when page fails to load", async () => {
    const result = await captureFullPage(
      "/nonexistent/file.html",
      "/tmp/should-not-exist.png",
      { width: 1440, height: 900 },
    );
    assert.strictEqual(result.status, "error");
    assert.ok(result.error, "should have error message");
  });
});
