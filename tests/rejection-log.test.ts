import { describe, it } from "node:test";
import assert from "node:assert";
import { RejectionLog } from "../src/core/rejection-log.js";

describe("RejectionLog", () => {
  it("starts empty", () => {
    const log = new RejectionLog();
    assert.strictEqual(log.count, 0);
  });
  it("records a rejection with reason code", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected");
    assert.strictEqual(log.count, 1);
  });
  it("accumulates multiple rejections", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".scale-110", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".color-mix", "UNSUPPORTED_FUNCTION", "color", "warning");
    assert.strictEqual(log.count, 3);
  });
  it("serializes to JSON with summary", () => {
    const log = new RejectionLog();
    log.add(".rotate-6", "UNSUPPORTED_PROPERTY", "transform", "expected");
    log.add(".scale-110", "UNSUPPORTED_PROPERTY", "transform", "expected");
    const json = log.toJSON(100);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.totalRules, 100);
    assert.strictEqual(parsed.rejectedRules, 2);
    assert.strictEqual(parsed.rejectionRate, "2.0%");
    assert.strictEqual(parsed.summaryByReason["UNSUPPORTED_PROPERTY"], 2);
  });
  it("serializes empty log", () => {
    const log = new RejectionLog();
    const json = log.toJSON(10);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.rejectedRules, 0);
    assert.deepStrictEqual(parsed.summaryByReason, {});
    assert.deepStrictEqual(parsed.rejections, []);
  });
});
