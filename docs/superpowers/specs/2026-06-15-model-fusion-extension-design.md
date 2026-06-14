# Model Fusion Extension for Pi

**Date:** 2026-06-15
**Status:** Design approved, awaiting implementation

## Overview

A Pi extension that replicates OpenRouter's Model Fusion capability: multi-model deliberation with a judge. When the user invokes `/fusion <prompt>`, a panel of models answers in parallel, a judge model compares their responses and returns structured analysis (consensus, contradictions, blind spots, unique insights, and a recommendation), and the primary LLM uses that analysis to produce a better final answer.

## Architecture

The extension lives at `~/.pi/agent/extensions/model-fusion/` as a directory-style extension:

```
~/.pi/agent/extensions/model-fusion/
├── index.ts          # Entry point: registers command + tool
├── config.ts         # Panel/judge model presets and prompt templates
├── fusion.ts         # Core fusion logic (parallel panel queries, judge call)
└── types.ts          # TypeScript types for config, results, etc.
```

### Components

| Component | Role |
|---|---|
| `/fusion` command | User-facing trigger. Sends prompt to primary LLM with instructions to invoke `model_fusion` |
| `model_fusion` tool | Registered tool the LLM calls. Takes prompt → runs panel → judge → returns structured analysis |
| `fusion.ts` | Orchestration logic: parallel panel calls, judge invocation, error handling, progress streaming |
| `config.ts` | Hardcoded panel/judge model presets, judge prompt template, timeouts |

## Data Flow

```
User: /fusion "Should I use Rust or Go for this CLI tool?"

    1. /fusion command handler fires
       → Sends prompt to primary LLM with system instruction:
         "Use the model_fusion tool to deliberate before answering"

    2. Primary LLM calls model_fusion(prompt, context?)

    3. Extension executes fusion():
       ┌─────────────────────────────────────────┐
       │  Panel phase (parallel)                 │
       │  DeepSeek V4 Pro ──→ response ──┐       │
       │  Kimi K2.6         ──→ response ──┤     │
       │  Gemini 3 Flash    ──→ response ──┘     │
       │           ↓                             │
       │  Judge phase                            │
       │  all responses → Claude Opus 4.8 → JSON │
       │                                         │
       │  Returns to primary LLM:                │
       │  { consensus, contradictions,           │
       │    blind_spots, unique_insights,        │
       │    recommendation }                     │
       └─────────────────────────────────────────┘

    4. Primary LLM receives analysis and writes final answer
```

## Configuration

Panel models (queried in parallel):
- **DeepSeek V4 Pro** — provider: `deepseek`, model: `deepseek-v4-pro`
- **Kimi K2.6** — provider: `openrouter`, model: `moonshotai/kimi-k2.6`
- **Gemini 3 Flash** — provider: `openrouter`, model: `google/gemini-3-flash-preview`

Judge model:
- **Claude Opus 4.8** — provider: `openrouter`, model: `anthropic/claude-opus-4.8`

### Judge Prompt Template

The judge receives all panel responses and the original prompt. It returns structured JSON with:
- `consensus` — points all or most models agree on (higher confidence)
- `contradictions` — points where models disagree
- `blind_spots` — important aspects no model addressed
- `unique_insights` — valuable points from individual models not echoed by others
- `recommendation` — synthesized answer combining the best of all responses

### Timeouts
- Panel model call: 120s per model
- Judge call: 180s

## Tool Interface

### Parameters
```typescript
{
  prompt: string;       // The prompt to deliberate on (self-contained)
  context?: string;     // Optional additional context
}
```

### Return
The tool returns structured content to the LLM:

```markdown
## Fusion Analysis

### Consensus (high confidence)
- Points most models agree on

### Contradictions
- Points where models disagree, with attribution

### Blind Spots
- Important aspects no model addressed

### Unique Insights
- Valuable individual model contributions

### Recommendation
- Synthesized answer
```

Machine-readable details (cost, timing, raw JSON) are stored in the `details` field for debugging.

## Error Handling

- **Panel model fails**: Slot marked as errored in the analysis sent to the judge. Judge notes the failure in its analysis.
- **Multiple panel models fail**: If 2+ panel models fail, tool returns an error to the primary LLM with partial results.
- **Judge fails**: Tool returns raw panel responses as fallback, so the primary LLM can still synthesize.
- **Timeout**: Each model call has an independent timeout. Timeouts are surfaced in the analysis.

## Progress Streaming

During execution, the tool streams progress updates:
- "Querying panel model 1/3: DeepSeek V4 Pro..."
- "Querying panel model 2/3: Kimi K2.6..."
- "Panel complete. Judge analyzing..."
- "Fusion complete."

## Out of Scope (v1)

- Per-invocation model overrides (fixed preset only)
- Web search integration for panel/judge models
- Caching of panel responses
- Automatic trigger (manual `/fusion` command only)
- Config file / settings UI (edit `config.ts` directly)
