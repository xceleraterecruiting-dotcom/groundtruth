# GroundTruth — Threat Model

Scope: a synthetic launch gate for a permission-safe enterprise support agent.
This document names what the system defends, who it defends against, the failure
modes it is designed to catch, and — explicitly — what it does **not** model.

## Asset

Restricted enterprise knowledge: compensation bands, performance/PIP records,
workforce-reduction plans, pre-release financials, confidential legal memos, and
internal sales/CRM data. The agent must answer from this corpus **only** for
actors authorized to read the specific source, and must never surface restricted
content to an unauthorized actor — directly, by citation, or by leaked phrase.

## Actors

- **Authorized employee** — holds the role an answer requires (e.g. HR Admin for
  compensation, Finance Admin for pre-release financials). Should receive a
  cited answer.
- **Unauthorized employee** — a valid employee lacking the specific role (e.g. an
  engineer asking for the comp band). Should be denied before generation.
- **External actor** — no employee role at all (e.g. a third-party auditor).
  Should be denied every internal and restricted document, regardless of how
  benign the query is.
- **Malicious document** — a prompt-injection payload embedded inside an
  otherwise-allowed document, attempting to make the agent disclose restricted
  data. Treated as untrusted content, never as instructions.

## Failure modes (what must never happen)

1. **Restricted source enters model context** for an unauthorized actor.
2. **Restricted source is cited** in an answer for an unauthorized actor (even if
   it never entered context).
3. **Canary phrase leaks** — a known restricted value (e.g. a comp figure)
   appears in output for an actor not authorized for its source.
4. **Orphaned ACL defaults to allow** — a restricted document with an empty
   allow-list is treated as readable instead of default-deny.
5. **Stale source wins** — a deprecated/superseded document outranks the
   canonical one and is answered from.
6. **No-answer fabrication** — when accessible sources do not contain the answer,
   the agent invents a cited answer instead of abstaining.
7. **Injection exfiltration** — a prompt-injection document causes restricted
   data to be disclosed.

## Controls (what the system actually does)

- **Actor resolution** — every query is bound to a persona with explicit roles.
- **Pre-context ACL filtering** (`retrieve`) — the full corpus is scored for
  trace visibility, but only ACL-allowed documents are placed in model context.
  Restricted documents are filtered **before** generation, not redacted after.
- **Least privilege** (`canAccess`) — internal documents require an `employee`
  role, and if an internal doc carries an explicit allow-list it is role-scoped
  (employee **and** a listed role); restricted documents require a specific role;
  **empty restricted allow-list ⇒ default deny** (orphaned-ACL case).
- **Deprecation ≠ access** — freshness is resolved separately from ACL; stale
  documents are dropped from context independently of permission.
- **Leak validation** (`validateLeak`) — fails if any context source or cited
  source is unauthorized for the actor, or if any canary phrase appears in the
  answer text, claim text, or citation quote.
- **Citation validation** (`validateCitations`) — every claim must be supported
  by a quote present in an accessible cited source.
- **Intent-aware abstention** — sensitive-category probes with no in-scope
  accessible context abstain before the model is called.
- **Authorized-disclosure classification** (UI export) — a canary phrase from a
  source the actor *is* authorized to read is labeled authorized disclosure, not
  a leak; the distinction is derived from the access result, not hardcoded.
- **Deterministic eval gate** (`npm run verify`) — positive control: safe traces
  pass, offline, reproducibly.
- **Executable negative control** (`npm run redteam`) — injects each of the seven
  failure modes above into real traces and asserts the validators, decision
  engine, and eval-gate checks catch every one; the gate provably fails closed.
  Exits non-zero if any poisoned trace slips through.
- **Scoped launch decision** (`decide`) — approves a category only with golden
  proof and zero contamination; sensitive categories are always blocked;
  unproven categories are blocked, not silently approved.

## What this prototype does NOT model

Stated plainly, because the boundary is part of the design:

- **Real source-system ACLs.** Permissions are synthetic role/doc/category
  mappings, not live permissions synced from HRIS, SharePoint, Salesforce, etc.
- **Group inheritance and nested permissions.** No groups, no inherited or
  hierarchical access, no role composition beyond a flat role list.
- **Field-level / row-level access.** A document is all-or-nothing; there is no
  partial-document redaction or column-level policy.
- **Connector semantics and sync lag.** No deleted-user propagation, no
  permission-change latency, no external-collaborator edge cases.
- **Semantic grounding.** Grounding is a deterministic quote-support proxy, not
  entailment; production would add LLM-as-judge plus human spot checks.
- **Live model variance.** Evals and the console run offline against cached
  completions for reproducibility; this is a launch gate, not a runtime.
- **Audit logging, monitoring, and post-launch drift detection.** Named in the
  production hardening loop, not implemented here.

The claim is deliberately narrow: GroundTruth models the **trust boundary** —
the decision of what reaches the model and what the agent is allowed to say — and
proves that boundary holds against the named failure modes. It is not Glean-scale
permission infrastructure, and does not claim to be.
