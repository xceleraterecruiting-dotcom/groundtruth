// ============================================================================
// GroundTruth — Retrieval (pre-context ACL enforcement)
// ============================================================================
//
// THE KEY ARCHITECTURAL CLAIM, stated precisely (per review note):
//
//   "Pre-context ACL enforcement" — restricted documents NEVER enter model
//   context. We score the full corpus for the trace (so we can SHOW what was
//   considered and what was blocked), but only ACL-allowed docs are passed to
//   generation. The model is never trusted with data the user can't see.
//
// Why not post-hoc redaction? Because by the time you redact, the restricted
// text is already in the context window: it is a leak surface AND a
// prompt-injection target. Pre-context filtering removes the data before the
// model can be manipulated into revealing it.
//
// Blocker 4 fix: we compute allowed-top-K and denied-top-K from the FULL scored
// list independently, so good allowed docs ranked #7-#12 are not starved out by
// restricted docs occupying the naive top-K window.
// ============================================================================

import type {
  Persona,
  IndexedDoc,
  ScoredDoc,
  RetrievalTrace,
} from "./types";
import { embed, cosine } from "./embeddings";
import { canAccess } from "./permissions";

const TOP_K = 5; // docs allowed into context
const TRACE_WINDOW = 8; // how many candidates we display in the trace

export function scoreAll(query: string, corpus: IndexedDoc[]): ScoredDoc[] {
  const qv = embed(query);
  return corpus
    .map((doc) => ({ doc, score: cosine(qv, doc.embedding) }))
    .sort((a, b) => b.score - a.score);
}

// Freshness/conflict resolution — SEPARATE from ACL (blocker 3).
// Operates only on already-allowed docs. Drops deprecated docs and docs that
// have been superseded by a newer canonical doc that is also in the allowed set.
function dropStale(allowed: ScoredDoc[]): {
  kept: ScoredDoc[];
  staleDropped: string[];
  conflictsResolved: Array<{ keptId: string; droppedId: string; why: string }>;
} {
  const allowedIds = new Set(allowed.map((s) => s.doc.id));
  const staleDropped: string[] = [];
  const conflictsResolved: Array<{
    keptId: string;
    droppedId: string;
    why: string;
  }> = [];

  const kept = allowed.filter((s) => {
    if (s.doc.deprecated) {
      staleDropped.push(s.doc.id);
      return false;
    }
    // If this doc is superseded by another doc we also retrieved+allowed,
    // drop the older one in favor of the canonical newer one.
    if (s.doc.supersededBy && allowedIds.has(s.doc.supersededBy)) {
      conflictsResolved.push({
        keptId: s.doc.supersededBy,
        droppedId: s.doc.id,
        why: "superseded-by-newer-canonical",
      });
      return false;
    }
    return true;
  });

  return { kept, staleDropped, conflictsResolved };
}

export function retrieve(
  query: string,
  persona: Persona,
  corpus: IndexedDoc[]
): RetrievalTrace {
  const scoredAll = scoreAll(query, corpus);

  // Independent allowed / denied selection from the FULL ranked list.
  const allowedRanked: ScoredDoc[] = [];
  const deniedTopK: RetrievalTrace["deniedTopK"] = [];

  for (const s of scoredAll) {
    const decision = canAccess(persona, s.doc);
    if (decision.ok) {
      if (allowedRanked.length < TOP_K) allowedRanked.push(s);
    } else {
      if (deniedTopK.length < TRACE_WINDOW)
        deniedTopK.push({ doc: s.doc, score: s.score, reason: decision.reason });
    }
    if (allowedRanked.length >= TOP_K && deniedTopK.length >= TRACE_WINDOW) break;
  }

  // Apply freshness/conflict resolution to the allowed set only.
  const { kept, staleDropped, conflictsResolved } = dropStale(allowedRanked);

  return {
    topKConsidered: scoredAll.slice(0, TRACE_WINDOW),
    allowedTopK: kept,
    deniedTopK,
    conflictsResolved,
    staleDropped,
  };
}