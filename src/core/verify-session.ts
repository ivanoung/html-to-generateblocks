// ── Verify Session ──────────────────────────────────────────
//
// Manages the output/.verify-session.json file for the
// wp-upload-verify workflow. Survives agent crashes.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface SessionPost {
  slug: string;
  postId?: number;
  url?: string;
  status: "pending" | "created" | "failed";
  error?: string;
}

export interface VerifySession {
  runId: string;
  wpUrl: string;
  pass: 1 | 2;
  projectDir: string;
  createdPosts: SessionPost[];
  sandboxFile: string;
  status: "preparing" | "awaiting_review" | "complete" | "failed";
  startedAt: string;
}

const SESSION_PATH = resolve(process.cwd(), "output", ".verify-session.json");

/** Create a new session file. Returns the session object. */
export function createSession(
  wpUrl: string,
  pass: 1 | 2,
  projectDir: string,
): VerifySession {
  const runId = randomUUID().slice(0, 8);
  const session: VerifySession = {
    runId,
    wpUrl,
    pass,
    projectDir,
    createdPosts: [],
    sandboxFile: `novamira-sandbox/gb-verify-${runId}.php`,
    status: "preparing",
    startedAt: new Date().toISOString(),
  };
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2) + "\n", "utf-8");
  return session;
}

/** Read the current session file. Returns null if none exists. */
export function readSession(): VerifySession | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as VerifySession;
  } catch {
    return null;
  }
}

/** Update the session file with partial changes. */
export function updateSession(partial: Partial<VerifySession>): VerifySession | null {
  const session = readSession();
  if (!session) return null;
  const updated = { ...session, ...partial };
  writeFileSync(SESSION_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  return updated;
}

/** Delete the session file after successful cleanup. */
export function deleteSession(): void {
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
}

/** Check if the session file indicates an active (unfinished) verification. */
export function hasActiveSession(): boolean {
  const s = readSession();
  return s !== null && s.status !== "complete" && s.status !== "failed";
}

/** Validate required environment variables are set. Returns error message or null. */
export function validateEnv(): string | null {
  const missing: string[] = [];
  if (!process.env.GB_WP_URL) missing.push("GB_WP_URL");
  if (!process.env.GB_WP_USER) missing.push("GB_WP_USER");
  if (!process.env.GB_WP_PASS) missing.push("GB_WP_PASS");
  if (missing.length > 0) {
    return `Missing environment variables: ${missing.join(", ")}. Set GB_WP_URL, GB_WP_USER, GB_WP_PASS.`;
  }
  const url = process.env.GB_WP_URL!;
  if (!/staging|dev|local|test/.test(url)) {
    return `GB_WP_URL (${url}) does not appear to be a staging/dev site. Set GB_WP_URL to a staging URL.`;
  }
  return null;
}

/** Check if the WP URL looks like a staging/dev site. Returns warning or null. */
export function checkStagingUrl(): string | null {
  const url = process.env.GB_WP_URL || "";
  if (!url) return null;
  if (!/staging|dev|local|test/.test(url)) {
    return `WARNING: GB_WP_URL (${url}) does not appear to be a staging/dev site. Proceed with caution.`;
  }
  return null;
}
