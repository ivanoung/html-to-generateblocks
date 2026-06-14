# Model Fusion Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi extension at `~/.pi/agent/extensions/model-fusion/` that provides `/fusion <prompt>` — multi-model deliberation with a judge model, replicating OpenRouter's Model Fusion.

**Architecture:** The extension spawns isolated `pi` processes in JSON print mode for each panel model (parallel) and the judge (sequential). Each process is a stateless `pi --mode json -p --no-session --model <model>` call. Panel responses are fed to the judge, which returns structured JSON analysis. The tool returns formatted analysis to the primary LLM.

**Tech Stack:** TypeScript (Pi extension), `@earendil-works/pi-coding-agent`, `typebox`, Node.js `child_process.spawn`, `node:fs`, `node:os`, `node:path`

---

## File Structure

```
~/.pi/agent/extensions/model-fusion/
├── types.ts          # TypeScript interfaces
├── config.ts         # Panel/judge model presets, judge prompt, timeouts
├── fusion.ts         # Core: spawn pi processes, parallel panel, judge call
└── index.ts          # Entry point: registers /fusion command + model_fusion tool
```

| File | Responsibility |
|---|---|
| `types.ts` | All interfaces: `FusionConfig`, `PanelModel`, `PanelResult`, `FusionAnalysis`, `FusionResult` |
| `config.ts` | Hardcoded preset for 3 panel models + judge model, judge prompt template, timeouts |
| `fusion.ts` | `runFusion(prompt, signal, onUpdate)` function: spawns panel in parallel, then judge, returns analysis |
| `index.ts` | Registers `/fusion` command and `model_fusion` tool, wires everything together |

---

### Task 1: Create types.ts

**Files:**
- Create: `~/.pi/agent/extensions/model-fusion/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// types.ts — Type definitions for the Model Fusion extension

export interface PanelModel {
  /** Provider name (e.g. "deepseek", "openrouter") */
  provider: string;
  /** Model ID (e.g. "deepseek-v4-pro", "moonshotai/kimi-k2.6") */
  model: string;
  /** Display label shown in progress updates */
  label: string;
}

export interface FusionConfig {
  /** Models queried in parallel during panel phase */
  panel: PanelModel[];
  /** Model used to compare panel responses */
  judge: PanelModel;
  /** Prompt template for the judge. {prompt} and {responses} are interpolated. */
  judgePrompt: string;
  /** Timeout per panel model call in milliseconds */
  panelTimeoutMs: number;
  /** Timeout for judge call in milliseconds */
  judgeTimeoutMs: number;
}

export interface PanelResult {
  label: string;
  provider: string;
  model: string;
  text: string;
  error?: string;
  exitCode: number;
}

export interface FusionAnalysis {
  consensus: string[];
  contradictions: string[];
  blind_spots: string[];
  unique_insights: string[];
  recommendation: string;
}

export interface FusionResult {
  analysis: FusionAnalysis | null;
  panelResults: PanelResult[];
  error?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/model-fusion/types.ts
git commit -m "feat: add model-fusion types"
```

---

### Task 2: Create config.ts

**Files:**
- Create: `~/.pi/agent/extensions/model-fusion/config.ts`

- [ ] **Step 1: Write the config file**

```typescript
// config.ts — Panel and judge model presets for Model Fusion
import type { FusionConfig } from "./types.js";

export const FUSION_CONFIG: FusionConfig = {
  panel: [
    { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { provider: "openrouter", model: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
    { provider: "openrouter", model: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  ],
  judge: {
    provider: "openrouter",
    model: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8 (Judge)",
  },
  judgePrompt: `You are comparing responses from multiple AI models to the same prompt.

ORIGINAL PROMPT:
{prompt}

MODEL RESPONSES:
{responses}

Analyze these responses and return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "consensus": ["point 1 all/most agree on", "point 2 all/most agree on"],
  "contradictions": ["where models disagree: Model A says X, Model B says Y about Z"],
  "blind_spots": ["important aspect no model addressed"],
  "unique_insights": ["valuable unique contribution from a single model, with attribution"],
  "recommendation": "synthesized answer combining the best of all responses"
}

Rules:
- consensus: only include points where at least 2 of 3 models agree
- contradictions: cite which model said what
- blind_spots: things a user would genuinely need to know that were missed
- unique_insights: only include genuinely valuable points not covered by others, attribute to the model
- recommendation: write a coherent final answer that synthesizes the best parts of all responses
- Return ONLY the JSON object, no other text.`,

  panelTimeoutMs: 120_000,
  judgeTimeoutMs: 180_000,
};
```

- [ ] **Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/model-fusion/config.ts
git commit -m "feat: add model-fusion config with panel/judge presets"
```

---

### Task 3: Create fusion.ts (core orchestration)

**Files:**
- Create: `~/.pi/agent/extensions/model-fusion/fusion.ts`

- [ ] **Step 1: Write fusion.ts**

```typescript
// fusion.ts — Core fusion orchestration: spawn pi processes for panel + judge
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FUSION_CONFIG } from "./config.js";
import type { FusionAnalysis, FusionResult, PanelResult } from "./types.js";

// ── helpers ──

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (/^(node|bun)(\.exe)?$/.test(execName)) {
    return { command: "pi", args };
  }
  return { command: process.execPath, args };
}

async function runPiModel(
  provider: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PanelResult> {
  const modelId = `${provider}/${model}`;
  const args = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--model", modelId,
    `Respond concisely to the following. Do not use tools, just answer directly.\n\n${prompt}`,
  ];

  return new Promise<PanelResult>((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: os.homedir(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const messages: string[] = [];

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // Parse JSON lines for message_end events to collect text
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "message_end" && event.message?.role === "assistant") {
            for (const part of event.message.content || []) {
              if (part.type === "text") messages.push(part.text);
            }
          }
        } catch { /* ignore unparseable lines */ }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        label: model,
        provider,
        model,
        text: messages.join("\n").trim(),
        error: code !== 0 ? (stderr.trim() || `exit code ${code}`) : undefined,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        label: model,
        provider,
        model,
        text: "",
        error: err.message,
        exitCode: 1,
      });
    });

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ── public API ──

export async function runFusion(
  prompt: string,
  signal?: AbortSignal,
  onUpdate?: (msg: string) => void,
): Promise<FusionResult> {
  const config = FUSION_CONFIG;

  // Phase 1: Panel (parallel)
  onUpdate?.(`Querying panel (${config.panel.length} models)...`);
  const panelPromises = config.panel.map((pm, i) => {
    onUpdate?.(`  Panel ${i + 1}/${config.panel.length}: ${pm.label}...`);
    return runPiModel(pm.provider, pm.model, prompt, config.panelTimeoutMs, signal);
  });
  const panelResults = await Promise.all(panelPromises);
  onUpdate?.(`Panel complete. ${panelResults.filter(r => !r.error).length}/${panelResults.length} succeeded.`);

  // Build responses text for judge
  const responsesText = panelResults
    .map((r, i) => {
      const header = `### Model ${i + 1}: ${r.label}${r.error ? " [ERROR]" : ""}`;
      const body = r.error ? `ERROR: ${r.error}` : r.text || "(no response)";
      return `${header}\n${body}`;
    })
    .join("\n\n");

  const failedCount = panelResults.filter(r => !!r.error).length;

  // If 2+ panel models failed, return error with partial results
  if (failedCount >= 2) {
    return {
      analysis: null,
      panelResults,
      error: `${failedCount}/${panelResults.length} panel models failed. Cannot proceed with judge analysis.`,
    };
  }

  // Phase 2: Judge
  onUpdate?.(`Judge analyzing (${config.judge.label})...`);
  const judgePrompt = config.judgePrompt
    .replace("{prompt}", prompt)
    .replace("{responses}", responsesText);

  const judgeResult = await runPiModel(
    config.judge.provider,
    config.judge.model,
    judgePrompt,
    config.judgeTimeoutMs,
    signal,
  );

  // Parse judge JSON
  let analysis: FusionAnalysis | null = null;
  if (!judgeResult.error && judgeResult.text) {
    try {
      // Strip any markdown code fences or leading/trailing non-JSON
      const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]) as FusionAnalysis;
      }
    } catch {
      // Judge didn't return valid JSON — will fall through to error
    }
  }

  if (!analysis) {
    return {
      analysis: null,
      panelResults,
      error: judgeResult.error
        ? `Judge failed: ${judgeResult.error}`
        : `Judge did not return valid JSON. Raw: ${judgeResult.text.slice(0, 500)}`,
    };
  }

  onUpdate?.("Fusion complete.");
  return { analysis, panelResults };
}
```

- [ ] **Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/model-fusion/fusion.ts
git commit -m "feat: add model-fusion core orchestration"
```

---

### Task 4: Create index.ts (entry point)

**Files:**
- Create: `~/.pi/agent/extensions/model-fusion/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
// index.ts — Model Fusion extension entry point
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FUSION_CONFIG } from "./config.js";
import { runFusion } from "./fusion.js";
import type { PanelResult } from "./types.js";

function formatAnalysisMarkdown(
  analysis: NonNullable<ReturnType<typeof runFusion> extends Promise<infer T> ? T : never>["analysis"],
  panelResults: PanelResult[],
): string {
  const lines: string[] = ["## Fusion Analysis", ""];

  if (analysis) {
    // Consensus
    lines.push("### Consensus (high confidence)");
    if (analysis.consensus?.length) {
      for (const c of analysis.consensus) lines.push(`- ${c}`);
    } else {
      lines.push("- (no clear consensus)");
    }
    lines.push("");

    // Contradictions
    lines.push("### Contradictions");
    if (analysis.contradictions?.length) {
      for (const c of analysis.contradictions) lines.push(`- ${c}`);
    } else {
      lines.push("- (no significant contradictions)");
    }
    lines.push("");

    // Blind Spots
    lines.push("### Blind Spots");
    if (analysis.blind_spots?.length) {
      for (const b of analysis.blind_spots) lines.push(`- ${b}`);
    } else {
      lines.push("- (no blind spots identified)");
    }
    lines.push("");

    // Unique Insights
    lines.push("### Unique Insights");
    if (analysis.unique_insights?.length) {
      for (const u of analysis.unique_insights) lines.push(`- ${u}`);
    } else {
      lines.push("- (no unique insights)");
    }
    lines.push("");

    // Recommendation
    lines.push("### Recommendation");
    lines.push(analysis.recommendation || "(no recommendation)");
  }

  // Panel status footer
  const succeeded = panelResults.filter(r => !r.error).length;
  const failed = panelResults.filter(r => !!r.error).length;
  lines.push("");
  lines.push(`---`);
  lines.push(`*Panel: ${succeeded}/${panelResults.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}.*`);

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  // Register the model_fusion tool
  pi.registerTool({
    name: "model_fusion",
    label: "Model Fusion",
    description:
      "Deliberate a prompt through a panel of models in parallel, then have a judge model compare responses and return structured analysis (consensus, contradictions, blind spots, unique insights, recommendation). Use when the user invokes /fusion or asks for multi-model deliberation.",
    promptSnippet: "Deliberate a prompt across DeepSeek V4 Pro, Kimi K2.6, and Gemini 3 Flash, judged by Claude Opus 4.8",
    promptGuidelines: [
      "Use model_fusion when the user invokes /fusion or explicitly requests multi-model deliberation.",
      "Pass the user's exact prompt as the prompt parameter. Include any code or error context in the context parameter.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "The prompt to deliberate on. Be specific and self-contained." }),
      context: Type.Optional(
        Type.String({ description: "Optional additional context (code snippets, error messages, etc.)" }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const fullPrompt = params.context
        ? `${params.prompt}\n\nAdditional context:\n${params.context}`
        : params.prompt;

      const result = await runFusion(fullPrompt, signal, (msg) => {
        onUpdate?.({ content: [{ type: "text", text: msg }] });
      });

      if (result.error && !result.analysis) {
        // Judge failed or 2+ panel failures — return partial results
        const panelText = result.panelResults
          .map(r => `**${r.label}:** ${r.error ? `ERROR: ${r.error}` : r.text || "(no response)"}`)
          .join("\n\n");

        return {
          content: [{
            type: "text",
            text: `## Fusion Error\n\n${result.error}\n\n### Raw Panel Responses\n\n${panelText}`,
          }],
          details: {
            panelModels: FUSION_CONFIG.panel.map(p => `${p.provider}/${p.model}`),
            judgeModel: `${FUSION_CONFIG.judge.provider}/${FUSION_CONFIG.judge.model}`,
            panelResults: result.panelResults,
            error: result.error,
          },
        };
      }

      const markdown = formatAnalysisMarkdown(result.analysis, result.panelResults);

      return {
        content: [{ type: "text", text: markdown }],
        details: {
          panelModels: FUSION_CONFIG.panel.map(p => `${p.provider}/${p.model}`),
          judgeModel: `${FUSION_CONFIG.judge.provider}/${FUSION_CONFIG.judge.model}`,
          panelResults: result.panelResults,
          analysis: result.analysis,
        },
      };
    },
  });

  // Register the /fusion command
  pi.registerCommand("fusion", {
    description: "Multi-model deliberation with a judge. Usage: /fusion <your prompt>",
    handler: async (args, ctx) => {
      const prompt = args.trim();
      if (!prompt) {
        ctx.ui.notify("Usage: /fusion <prompt>", "warning");
        return;
      }

      // Send a message that instructs the LLM to use the model_fusion tool
      const instruction = [
        { type: "text" as const, text: `The user wants multi-model deliberation on this prompt:` },
        { type: "text" as const, text: prompt },
        { type: "text" as const, text: `\nUse the model_fusion tool to deliberate on this prompt. Pass the prompt exactly as provided. After receiving the fusion analysis, synthesize a comprehensive final answer for the user.` },
      ];

      if (ctx.isIdle()) {
        pi.sendUserMessage(instruction);
      } else {
        pi.sendUserMessage(instruction, { deliverAs: "steer" });
      }
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/model-fusion/index.ts
git commit -m "feat: add model-fusion extension entry point with /fusion command and model_fusion tool"
```

---

### Task 5: Verify and test

**Files:**
- None (verification only)

- [ ] **Step 1: Verify extension loads without errors**

```bash
pi -e ~/.pi/agent/extensions/model-fusion/index.ts --list-models 2>&1 | head -5
```

Expected: Extension loads silently, normal model list appears. No crash, no stack trace.

- [ ] **Step 2: Test the /fusion command with a simple prompt**

Start pi with the extension:
```bash
pi -e ~/.pi/agent/extensions/model-fusion/index.ts
```

Type:
```
/fusion What is 2+2?
```

Expected behavior:
- Progress updates stream: "Querying panel (3 models)...", "Panel 1/3: DeepSeek V4 Pro...", etc.
- Judge analyzes
- LLM receives fusion analysis and responds with a synthesized answer
- The answer incorporates the multi-model analysis

- [ ] **Step 3: Test error handling — verify graceful degradation**

Temporarily change one panel model ID to an invalid one in config.ts:

```typescript
{ provider: "openrouter", model: "moonshotai/kimi-NONEXISTENT", label: "Kimi K2.6 (broken)" },
```

Run `/fusion` again. Expected:
- 2/3 panel models succeed, 1 fails
- Judge still runs with available responses
- Analysis notes the failed model
- No crash

Restore config after test.

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git commit -m "verify: model-fusion extension loads and functions correctly"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections covered — architecture (4 files), data flow (spawn pi → panel → judge → return), configuration (DeepSeek/Kimi/Gemini panel + Opus judge), tool interface (prompt + context params, structured markdown return), error handling (per-model isolation, 2+ failure cutoff, judge fallback), progress streaming (onUpdate messages)
- [x] **Placeholder scan:** No TBD, TODO, or "implement later". Every step has complete code.
- [x] **Type consistency:** `FusionConfig` matches `config.ts`. `PanelResult` matches what `runPiModel` returns. `FusionAnalysis` matches judge JSON schema. Tool parameters match `runFusion` signature. All imports are correct relative paths with `.js` extensions.
