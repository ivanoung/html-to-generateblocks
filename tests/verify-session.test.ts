import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSession,
  readSession,
  updateSession,
  deleteSession,
  hasActiveSession,
  validateEnv,
  type VerifySession,
} from "../src/core/verify-session.js";

const SESSION_PATH = resolve(process.cwd(), "output", ".verify-session.json");

// ── Helpers ────────────────────────────────────────────────

function cleanup() {
  try { unlinkSync(SESSION_PATH); } catch {}
}

function clearEnv() {
  delete process.env.GB_WP_URL;
  delete process.env.GB_WP_USER;
  delete process.env.GB_WP_PASS;
}

function setEnv(vars: Record<string, string>) {
  clearEnv(); // always start from clean slate
  for (const [k, v] of Object.entries(vars)) {
    if (v) process.env[k] = v;
  }
}

// ── Tests ───────────────────────────────────────────────────

describe("verify-session", () => {
  beforeEach(cleanup);
  afterEach(() => {
    cleanup();
    clearEnv();
  });

  // Round-trip: create → read
  it("createSession then readSession returns same data", () => {
    const created = createSession("https://staging.example.com", 1, "test-project");
    assert.ok(created.runId.length === 8, "runId should be 8 chars");
    assert.strictEqual(created.pass, 1);
    assert.strictEqual(created.projectDir, "test-project");
    assert.strictEqual(created.status, "preparing");
    assert.ok(existsSync(SESSION_PATH), "session file should exist");

    const read = readSession();
    assert.ok(read !== null, "readSession should return non-null");
    assert.strictEqual(read!.runId, created.runId);
    assert.strictEqual(read!.wpUrl, created.wpUrl);
    assert.strictEqual(read!.pass, created.pass);
    assert.strictEqual(read!.projectDir, created.projectDir);
    assert.strictEqual(read!.status, created.status);
    assert.strictEqual(read!.sandboxFile, created.sandboxFile);
  });

  // Update merges partial fields
  it("updateSession merges partial fields correctly", () => {
    const created = createSession("https://staging.example.com", 1, "test-project");

    const updated = updateSession({ status: "awaiting_review" });
    assert.ok(updated !== null, "updateSession should return non-null");
    assert.strictEqual(updated!.status, "awaiting_review");
    // Other fields unchanged
    assert.strictEqual(updated!.runId, created.runId);
    assert.strictEqual(updated!.wpUrl, created.wpUrl);
    assert.strictEqual(updated!.pass, created.pass);

    // Update with posts
    const updated2 = updateSession({
      createdPosts: [{ slug: "index", status: "pending" }],
      status: "awaiting_review",
    });
    assert.ok(updated2 !== null);
    assert.strictEqual(updated2!.createdPosts.length, 1);
    assert.strictEqual(updated2!.createdPosts[0].slug, "index");

    // Update non-existent session
    deleteSession();
    const missing = updateSession({ status: "awaiting_review" });
    assert.strictEqual(missing, null);
  });

  // hasActiveSession status checks
  it("hasActiveSession returns true for active statuses, false for terminal", () => {
    // No session yet
    assert.strictEqual(hasActiveSession(), false);

    // Active statuses
    createSession("https://staging.example.com", 1, "test");
    assert.strictEqual(hasActiveSession(), true, "preparing should be active");

    updateSession({ status: "awaiting_review" });
    assert.strictEqual(hasActiveSession(), true, "awaiting_review should be active");

    // Terminal statuses
    updateSession({ status: "complete" });
    assert.strictEqual(hasActiveSession(), false, "complete should not be active");

    updateSession({ status: "failed" });
    assert.strictEqual(hasActiveSession(), false, "failed should not be active");
  });

  // deleteSession cleans up
  it("deleteSession removes file, readSession returns null after", () => {
    createSession("https://staging.example.com", 1, "test");
    assert.ok(existsSync(SESSION_PATH));

    deleteSession();
    assert.strictEqual(existsSync(SESSION_PATH), false);
    assert.strictEqual(readSession(), null);
  });

  // readSession returns null when file doesn't exist
  it("readSession returns null when file does not exist", () => {
    assert.strictEqual(existsSync(SESSION_PATH), false);
    assert.strictEqual(readSession(), null);
  });

  // validateEnv: all vars set + staging URL
  it("validateEnv returns null when all vars set and URL contains staging", () => {
    setEnv({
      GB_WP_URL: "https://staging.example.com",
      GB_WP_USER: "testuser",
      GB_WP_PASS: "testpass",
    });
    assert.strictEqual(validateEnv(), null);
  });

  // validateEnv: missing vars
  it("validateEnv returns error when vars are missing", () => {
    clearEnv();
    const err = validateEnv();
    assert.ok(err !== null, "should return error");
    assert.ok(err!.startsWith("Missing"), "should say Missing");

    // Only GB_WP_URL set: should still fail because USER and PASS are missing
    setEnv({ GB_WP_URL: "https://staging.example.com" });
    const err2 = validateEnv();
    assert.ok(err2 !== null, "should return error when only URL is set");
    assert.ok(err2!.startsWith("Missing"), "should still say Missing");
  });

  // validateEnv: non-staging URL
  it("validateEnv returns error when URL does not contain staging/dev/local/test", () => {
    setEnv({
      GB_WP_URL: "https://myproductionsite.com",
      GB_WP_USER: "testuser",
      GB_WP_PASS: "testpass",
    });
    const err = validateEnv();
    assert.ok(err !== null, "should return error for production URL");
    assert.ok(err!.includes("does not appear to be a staging/dev site"));

    // URLs that should pass (all three env vars required)
    const passOpts = { GB_WP_USER: "u", GB_WP_PASS: "p" };
    setEnv({ GB_WP_URL: "https://dev.example.com", ...passOpts });
    assert.strictEqual(validateEnv(), null, "dev should pass");

    setEnv({ GB_WP_URL: "https://example.local", ...passOpts });
    assert.strictEqual(validateEnv(), null, "local should pass");

    setEnv({ GB_WP_URL: "https://test.example.com", ...passOpts });
    assert.strictEqual(validateEnv(), null, "test should pass");
  });
});
