// ============================================================================
// GroundTruth — LLM Adapter (hybrid: live + deterministic cache)
// ============================================================================
//
// Blocker 5 fix: offline mode is checked at CALL TIME, not frozen at import.
// `process.env.MODE` is read inside isOffline() every call, so the eval runner
// can set MODE=offline before invoking the agent and have it honored even
// though this module was imported earlier.
//
// Determinism contract:
//   - Every live completion is cached to disk keyed by a hash of the full
//     prompt. Re-runs replay the cache.
//   - In offline mode, a cache miss is a HARD ERROR (we never silently call the
//     network during an eval), guaranteeing reproducible eval numbers.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), "data", "llm-cache");

export function isOffline(): boolean {
  return process.env.MODE === "offline";
}

function cacheKey(prompt: string, model: string): string {
  return createHash("sha256").update(model + "\u0000" + prompt).digest("hex");
}

function cachePath(key: string): string {
  return join(CACHE_DIR, key + ".json");
}

function readCache(key: string): string | null {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")).completion as string;
  } catch {
    return null;
  }
}

function writeCache(key: string, prompt: string, completion: string): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify({ prompt, completion }, null, 2));
}

export interface CompleteResult {
  text: string;
  fromCache: boolean;
  estCostUsd: number;
}

const MODEL = "claude-sonnet-4-20250514";
export const EST_COST_PER_LIVE_CALL = 0.003; // labeled estimate; offline replay cost is 0

export async function complete(prompt: string): Promise<CompleteResult> {
  const key = cacheKey(prompt, MODEL);
  const cached = readCache(key);
  if (cached !== null) {
    return { text: cached, fromCache: true, estCostUsd: 0 };
  }

  if (isOffline()) {
    throw new Error(
      `[GroundTruth] Offline mode cache miss for key ${key.slice(0, 12)}…. ` +
        `Evals must run against cached completions for determinism. ` +
        `Run once in live mode to populate the cache.`
    );
  }

  // Live call. (Wired to Anthropic API in the deployed app; in this scaffold
  // we guard so the repo runs without a key by falling back to a deterministic
  // local generator. The real route uses fetch() to api.anthropic.com.)
  const text = await liveOrLocal(prompt);
  writeCache(key, prompt, text);
  return { text, fromCache: false, estCostUsd: EST_COST_PER_LIVE_CALL };
}

async function liveOrLocal(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  // Deterministic local fallback so the scaffold is runnable with no key.
  // The real generation prompt asks for strict JSON; we emit a minimal,
  // schema-valid "could not generate" envelope that downstream parsing
  // handles as an abstain. Tests rely on cache, not this path.
  return JSON.stringify({
    abstained: true,
    text: "[local-fallback] No API key configured; abstaining.",
    claims: [],
  });
}