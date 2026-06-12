# GroundTruth — Launch Gate for Permission-Safe Enterprise Agents

A launch gate that decides whether an enterprise AI support agent is safe to pilot. It filters documents by ACL before retrieval, validates citations, runs adversarial permission-leak evals, and emits a launch decision scoped by category.

**Scenario (synthetic):** Northstar Cloud Systems wants to launch an internal AI support agent. The CISO and Head of People block rollout until permission-leak risk is proven safe across HR, Engineering, Sales, Legal, and Finance content. GroundTruth produces that go/no-go decision, scoped by category.

> **Synthetic data only.** This project never connects to Glean, any customer system, or any private data. All documents, personas, and ACLs are invented.

## For reviewers

Fastest inspection path: `npm install && npm run verify`. Then read, in order: `src/lib/permissions.ts` (the access decision), `evals/run.ts` (the gate), and `src/lib/decision.ts` (the scoped launch call).

## Quick start

```bash
npm install
npm run verify
```

`npm run verify` runs, in order: `seed-cache → typecheck → test → evals`. Individual scripts: `npm run seed-cache`, `npm run typecheck`, `npm test`, `npm run evals`, `npm run export-ui-data`. (`@types/node` is in `devDependencies`, so `npm install` is all you need.)

## Expected verification output

- `npm run typecheck` — clean (no errors)
- `npm test` — 22 passed, 0 failed
- `npm run evals` — 16/16 golden, 0/20 leak, 18/18 abstention, 2/2 no-answer, 2/2 conflict, PASS_FOR_LIMITED_PILOT, exit 0

Harness latency varies by machine but stays below the configured threshold (`maxP95LatencyMs`). It reflects retrieval and orchestration only, not model inference.

## Demo console

`demo/groundtruth-console.html` is a single self-contained file (double-click to open; no server, build, or network). It renders the launch review in three sections (Pilot Decision, Trace Replay, Evidence) from data exported by `npm run export-ui-data`.

The Verified Probe Replay in Trace Replay steps through six recorded traces: an ordinary allowed answer, prompt-injection plus ACL denial, authorized compensation disclosure, stale/conflict resolution, authorized finance disclosure, and an external-auditor least-privilege denial. These are deterministic traces recorded from the harness; the console makes no live model calls, and the launch decision still comes from `npm run verify`.

To refresh the console after changing the corpus or cases, run `npm run export-ui-data` to regenerate `data/ui-data.json`, then rebuild the HTML.

## How generation works

- Live mode (`ANTHROPIC_API_KEY` set, `MODE` unset): the agent calls the Anthropic API and caches every completion to `data/llm-cache`, keyed by a hash of the exact prompt.
- Offline mode (`MODE=offline`, set automatically in `evals/run.ts`): the agent replays cached completions. A cache miss is a hard error, so an eval never silently hits the network. This is what makes the scores deterministic.
- `scripts/seed-cache.ts` populates the cache by synthesizing grounded answers keyed to the exact prompts, so the repo reproduces with no API key.

The local fallback in `src/lib/llm.ts` is a scaffold path so the repo runs without a key; it is not the evaluated generation path. Evaluated runs use the cached completions.

## What it enforces

- **Pre-context ACL enforcement.** Restricted documents never enter model context. The full corpus is scored so the trace can show what was considered and what was blocked, but only ACL-allowed docs reach the LLM. This is not post-hoc redaction — by the time you redact, the secret is already in the context window and is both a leak surface and an injection target.
- **Deprecation is not access.** Freshness is handled separately from ACL; a deprecated restricted doc is still restricted.
- **Least privilege.** Internal docs require an `employee` role (an external auditor with no employee role is denied). Restricted tier is allow-list only; an empty `allowedRoles` is default-deny (the orphaned-ACL edge case).
- **Intent-aware abstention** before the LLM on sensitive-category probes with no in-scope accessible context.
- **Prompt-injection handling.** A malicious instruction inside an allowed document can enter context, but restricted docs never do, so the model has nothing restricted to ground on or exfiltrate. The correct behavior is to answer from the safe content and ignore the embedded instruction. What is true here is narrower than "injection prevented": the injection is detected, nothing restricted is available to exfiltrate, and the output is still checked for leaks and citations.
- **Scoped launch decision.** Never a blanket approval. A benign category is approved only with golden proof of correct answers and zero adversarial contamination. Sensitive categories are always blocked by policy. Categories with no golden proof are blocked, not silently approved.
- **Deterministic eval gate.** Same input, same vectors, same scores, offline, no network.

## Limitations

- Focused synthetic pilot corpus (24 docs), not enterprise-scale. Extend by adding rows in `data/corpus.ts`.
- Embeddings are deterministic local hashed-lexical vectors, not semantic embeddings. Production swaps for a real embedding model, vector store, and reranker.
- Groundedness is a deterministic quote-support proxy, not semantic entailment. Production adds LLM-as-judge plus human spot checks.
- Latency reported is harness latency (retrieval and orchestration), not model inference, which is not measured in offline replay. Cost is reported as an est-live figure alongside the true offline-replay cost of $0.

## Architecture

```
types → permissions → embeddings → retrieve → intent → llm →
generate → agent → validators → decision → evals/run

Per-query pipeline (structured tool calls):
resolve_permissions → classify_intent → retrieve(ACL pre-context filter)
→ generate(intent-aware abstention) → assemble AuditTrace
```

## Layout

- `src/lib/` — the engine (types, permissions, embeddings, retrieve, intent, llm, generate, agent, validators, thresholds, decision)
- `data/` — `corpus.ts`, `personas.ts` (synthetic)
- `evals/` — `cases.ts` (golden / adversarial / conflict / no-answer), `run.ts`
- `scripts/` — `seed-cache.ts`, `test.ts`, `export-ui-data.ts`
