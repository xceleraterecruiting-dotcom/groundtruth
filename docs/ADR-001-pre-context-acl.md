# ADR-001: Enforce ACL before model context

**Status:** Accepted
**Context:** GroundTruth — permission-safe enterprise agent launch gate

## Decision

The agent enforces document-level access control **before** any document enters
the model's context window. The full corpus is scored for retrieval relevance so
the audit trace can show what was considered, but only ACL-allowed documents are
placed in context. Restricted documents are filtered out before generation.

## Rejected alternative: post-hoc redaction

The common shortcut is to retrieve broadly, let the model see everything relevant,
generate an answer, and then redact or refuse if the output looks like it contains
restricted data. We reject this.

**Rationale:** once restricted text is in the context window, the leak has already
happened — to the model, and to anything that can observe or influence the model.
Post-hoc redaction has three structural problems:

1. **The secret is already present.** Redacting the *output* does nothing about
   the fact that restricted content was loaded into context. Any logging, caching,
   error path, or side channel that captures context now captures the secret.
2. **It is an injection target.** If restricted data is in context, a prompt
   injection inside an *allowed* document can attempt to exfiltrate it. Pre-context
   filtering removes the target entirely: with no restricted document in context,
   a successful injection has nothing to steal. (This is exactly the
   `Engineer · injection + compensation denied` trace — injection detected, but
   the comp record was never in context, so there was no source-grounded
   restricted data available to disclose.)
3. **Redaction is a classification problem with false negatives.** Catching every
   restricted value in free-text output is an open-ended, model-dependent task.
   Access control on a known document set is a closed, deterministic check.

Filtering at the boundary turns a hard output-classification problem into a simple
access-control decision made against structured metadata.

## What this prototype models

- Actor → role resolution against a synthetic persona set.
- Document-level ACL: `public` (anyone), `internal` (requires `employee`),
  `restricted` (requires a specific role; empty allow-list ⇒ default-deny).
- Pre-context filtering with a visible considered/denied/in-context trace.
- Freshness handled separately from access (deprecation is not a permission).
- Leak and citation validation as independent post-checks (defense in depth).
- A deterministic positive control (`npm run verify`) and an executable negative
  control (`npm run redteam`) that proves the gate fails closed.

## What this prototype does NOT model

(See `THREAT_MODEL.md` for the full list.) In short: real source-system ACL sync,
group inheritance and nested permissions, field/row-level access, connector
semantics and permission-change lag, deleted-user propagation, semantic-entailment
grounding, audit logging, and live runtime serving. The claim is scoped to the
**trust boundary**, not to production permission infrastructure.

## Production path

To take this from prototype to production:

1. Replace synthetic ACLs with permissions synced from source systems through
   connectors, including group/role inheritance and field-level policy.
2. Add audit logging of every access decision and context-assembly event.
3. Replace the quote-support proxy with semantic grounding (LLM-as-judge plus
   human spot checks).
4. Add approval gates before any write/action tool, not just read answers.
5. Promote categories one at a time as adversarial coverage and monitoring mature.
6. Monitor permission-change lag, drift, and feedback after launch.

## Consequence

The architecture's central guarantee is stated as a boundary, not a behavior:
**restricted documents never enter model context for an unauthorized actor.**
Because the guarantee is positional (enforced before generation) rather than
corrective (cleaned up after), it is deterministic, testable, and provable by
negative control — which is what makes the launch decision defensible rather than
cosmetic.
