# GroundTruth — Launch Gate for Permission-Safe Enterprise Agents

A launch gate that decides whether an enterprise AI support agent is **safe to
pilot**, by enforcing pre-context ACL filtering, validating citations, running
adversarial permission-leak probes, and emitting a **scoped** go/no-go decision.

> **Synthetic data only.** This project never connects to Glean, any customer
> system, or any private data. All documents, personas, and ACLs are invented.

## What this demonstrates — read this first

GroundTruth is a **reference architecture with a reproducible gate**, not a
benchmark result. Two things are worth separating clearly, because they carry
very different weight:

**The architecture is the point, and it is real.** Access is decided in one
place (`permissions.ts`), enforced *before* retrieval hands anything to the
model (`retrieve.ts`), and re-checked defensively in the validators. The ACL is
genuinely role-differentiated: an external auditor with no employee role sees
almost nothing; an HR admin sees the compensation doc she's authorized for and
no others; a salesperson sees his deal data and no others. Restricted documents
a persona isn't cleared for **never enter model context** — so there is nothing
for a prompt injection to exfiltrate. That is the defensible, transferable idea.

**The headline numbers prove the plumbing, not model quality — and they're
generated against data this repo controls.** `npm run verify` reproduces
`16/16 golden, 0/20 leak → PASS_FOR_LIMITED_PILOT`. Be precise about what that
does and doesn't show:

- **`0/20 leak` is a structural result.** Leak prevention lives in the ACL
  filter, which runs before generation, so it doesn't depend on the model
  behaving. That's the good news. The caveat: the corpus, the personas, and the
  20 adversarial probes are all authored here, so zero leaks proves the filter
  is *wired correctly on controlled inputs* — not that it withstands a novel
  real-world adversary.
- **`16/16 golden` is close to tautological in the default offline mode.** To
  stay deterministic with no API key, `seed-cache.ts` synthesizes each "correct"
  answer by quoting the expected source sentences, and the offline eval replays
  those. So the golden score exercises retrieval + citation validation against
  answers built to pass; it is not a measure of live generation quality.

Everything the numbers *can't* show is stated in [Honest
limitations](#honest-limitations). The whole repo is an application of its own
evidence-sufficiency rule: say what the evidence supports, and no more.

## Quick start

```bash
npm install
npm run verify
```

`npm run verify` runs, in order: `seed-cache → typecheck → test → evals`.
Individual scripts: `npm run seed-cache`, `npm run typecheck`, `npm test`,
`npm run evals`, `npm run export-ui-data`.

## Expected verification output

Reproduce the same **safety and quality gates** exactly:

- `npm run typecheck` — clean (no errors)
- `npm test` — **18 passed, 0 failed**
- `npm run evals` — 16/16 golden, **0/20 leak**, 18/18 abstention, 2/2 no-answer,
  2/2 conflict → **PASS_FOR_LIMITED_PILOT**, exit 0

Harness latency reflects retrieval + orchestration only, not model inference,
which is not measured in offline replay.

## How generation works (important — read before judging the LLM)

- **Live mode** (`ANTHROPIC_API_KEY` set, `MODE` unset): the agent calls the
  Anthropic API and caches every completion to `data/llm-cache`, keyed by a hash
  of the exact generation prompt.
- **Offline mode** (`MODE=offline`, set automatically inside `evals/run.ts`): the
  agent **replays cached completions**. A cache miss is a **hard error** — we
  never silently hit the network during an eval. This is what makes the eval
  scores deterministic and reproducible.
- **`scripts/seed-cache.ts`** populates the cache by synthesizing grounded
  answers keyed to the exact prompts, so the repo runs with no API key. These
  seeded answers are what the offline golden eval scores against — they stand in
  for a correct model, they are not the model.

> The local fallback in `src/lib/llm.ts` is a scaffold safety path, not an
> evaluated generation path. Evaluated offline runs use the deterministic cache.
> Live mode calls the Anthropic API when a key is present; the gate runs offline
> so results are reproducible.

## Key defensible properties

- **Pre-context ACL enforcement.** Restricted documents *never enter model
  context*. The full corpus is scored so the trace can show what was considered
  and what was blocked, but only ACL-allowed docs reach the LLM. This is not
  post-hoc redaction — by the time you redact, the secret is already in the
  context window and is both a leak surface and an injection target.
- **Access decided in one place.** Retrieval, generation, and evals all call the
  same `canAccess()`. There is no second, looser path.
- **Deprecation is not access.** Freshness is handled separately from ACL; a
  deprecated restricted doc is still restricted.
- **Least privilege.** Internal docs require an `employee` role (an external
  auditor with no employee role is denied). Restricted tier is allow-list only;
  empty `allowedRoles` means default-deny (orphaned-ACL edge case).
- **Intent-aware abstention before the LLM** on sensitive-category probes with
  no in-scope accessible context.
- **Structural prompt-injection defense.** A malicious instruction inside an
  *allowed* document may enter context, but restricted docs never do — so the
  model has nothing restricted to source-ground or exfiltrate. Precise claim:
  **"prompt injection detected; restricted data unavailable to exfiltrate;
  output validated for leak and citation safety"** — *not* "prompt injection
  prevented."
- **Scoped launch decision, never a blanket approval.** A benign category is
  approved only with golden proof of correct answers **and** zero adversarial
  contamination. Sensitive categories are always blocked by policy. Categories
  with no golden proof are blocked, not silently approved.
- **Deterministic eval gate.** Same input → same vectors → same scores, offline,
  no network. (Determinism is what makes the gate reproducible; it is also why
  the golden number can't stand in for live quality — see above.)

## Demo console

`demo/groundtruth-console.html` is a single self-contained file (open it with a
double-click — no server, no build, no network). It renders the launch review in
three sections: **Pilot Decision**, **Trace Replay**, and **Evidence**, reading
real data exported by `npm run export-ui-data`.

The **Verified Probe Replay** steps through six recorded traces — ordinary
allowed answer, prompt-injection + ACL denial, authorized compensation
disclosure, stale/conflict resolution, authorized finance disclosure, and an
external-auditor least-privilege denial.

> **Deterministic traces from the verified harness. No live model calls in this
> console.** The traces are recorded backend output exported for review; the
> launch decision still comes from `npm run verify`.

## Honest limitations

- **Focused synthetic pilot corpus** (24 docs, 9 restricted), not
  enterprise-scale. The adversarial suite is authored here; passing it proves the
  wiring, not robustness to an unseen adversary. Extend by adding rows in
  `data/corpus.ts` and cases in `evals/cases.ts`.
- **Embeddings are deterministic local hashed-lexical vectors** (256-dim FNV over
  token unigrams + bigrams), not semantic embeddings. Production swaps for a real
  embedding model + vector store + reranker.
- **Groundedness is a deterministic quote-support proxy** (does the cited quote
  appear in the cited source?), not semantic entailment. Production adds
  LLM-as-judge plus human spot checks.
- **Offline golden scores measure retrieval + validation against seeded answers,
  not live generation.** Run live mode with a real key to evaluate the model.
- **Latency reported is harness latency** (retrieval + orchestration), not model
  inference. Cost is reported as an est-live figure alongside the true
  offline-replay cost of $0.

## Architecture

```
types → permissions → embeddings → retrieve → intent → llm →
generate → agent → validators → decision → evals/run

Per-query pipeline (structured tool calls):
resolve_permissions → classify_intent → retrieve(ACL pre-context filter)
→ generate(intent-aware abstention) → assemble AuditTrace
```

## Layout

- `src/lib/` — the engine (types, permissions, embeddings, retrieve, intent, llm,
  generate, agent, validators, thresholds, decision)
- `data/` — `corpus.ts`, `personas.ts` (synthetic)
- `evals/` — `cases.ts` (golden / adversarial / conflict / no-answer), `run.ts`
- `scripts/` — `seed-cache.ts`, `test.ts`, `export-ui-data.ts`, `redteam.ts`
- `docs/` — `ADR-001-pre-context-acl.md`, `THREAT_MODEL.md`

## License

MIT
