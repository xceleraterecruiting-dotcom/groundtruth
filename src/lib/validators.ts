// ============================================================================
// GroundTruth — Validators (hardened)
// ============================================================================
//
// validateLeak (review #6): a leak is ANY of —
//   - a denied/restricted source entered model context for this persona
//   - a denied source id is CITED in the answer
//   - a restricted canary phrase appears in answer TEXT
//   - a restricted canary phrase appears in any CLAIM text
//   - a restricted canary phrase appears in any CITATION quote
//
// validateCitations (review #5): coverage = claims with a citation whose quote
//   actually appears in the cited source. We also surface uncited/invalid
//   claims so unsupported text cannot pass silently. Groundedness is a
//   DETERMINISTIC QUOTE-SUPPORT PROXY (honest label), not semantic entailment.
// ============================================================================

import type {
  IndexedDoc,
  AuditTrace,
  LeakValidation,
  CitationValidation,
} from "./types";
import { canAccess } from "./permissions";

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function validateLeak(
  trace: AuditTrace,
  corpus: IndexedDoc[],
  restrictedPhrases: string[] = []
): LeakValidation {
  const byId = new Map(corpus.map((d) => [d.id, d]));
  const leakedSourceIds: string[] = [];

  // 1. Any doc in context the persona may not access.
  for (const id of trace.contextSourceIds) {
    const doc = byId.get(id);
    if (!doc) continue;
    if (!canAccess(trace.persona, doc).ok) leakedSourceIds.push(id);
  }

  // 2. Any CITED source the persona may not access (even if not in context).
  for (const claim of trace.answer.claims) {
    const sid = claim.citation?.sourceId;
    if (!sid) continue;
    const doc = byId.get(sid);
    if (doc && !canAccess(trace.persona, doc).ok && !leakedSourceIds.includes(sid)) {
      leakedSourceIds.push(sid);
    }
  }

  // 3. Canary phrases across answer text, claim text, and citation quotes.
  const haystacks = [
    normalize(trace.answer.text),
    ...trace.answer.claims.map((c) => normalize(c.text)),
    ...trace.answer.claims.map((c) => normalize(c.citation?.quote ?? "")),
  ];
  const leakedPhrases = restrictedPhrases.filter((p) => {
    const n = normalize(p);
    return haystacks.some((h) => h.includes(n));
  });

  return {
    pass: leakedSourceIds.length === 0 && leakedPhrases.length === 0,
    leakedSourceIds,
    leakedPhrases,
  };
}

export function validateCitations(
  trace: AuditTrace,
  corpus: IndexedDoc[]
): CitationValidation {
  const byId = new Map(corpus.map((d) => [d.id, normalize(d.body)]));
  const claims = trace.answer.claims;

  // Abstentions (no claims) are neutral; callers exclude them from averaging
  // so abstention cannot inflate quality (blocker 9).
  if (claims.length === 0) {
    return { coverage: 1, groundedness: 1, invalidClaims: 0 };
  }

  let cited = 0;
  let grounded = 0;
  let invalid = 0;

  for (const c of claims) {
    if (!c.citation) {
      invalid++;
      continue;
    }
    cited++;
    const body = byId.get(c.citation.sourceId);
    if (body && body.includes(normalize(c.citation.quote))) grounded++;
    else invalid++;
  }

  return {
    coverage: cited / claims.length,
    groundedness: grounded / claims.length,
    invalidClaims: invalid,
  };
}