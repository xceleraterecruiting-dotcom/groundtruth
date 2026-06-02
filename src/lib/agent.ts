// ============================================================================
// GroundTruth — Agent Orchestrator
// ============================================================================
//
// Wires the structured tool calls into one governed run and emits a complete
// AuditTrace. Tool order is the security argument made executable:
//
//   resolve_permissions -> classify_intent -> retrieve(ACL pre-context filter)
//   -> generate(intent-aware abstention) -> assemble trace
//
// contextSourceIds records EXACTLY which docs crossed the model-context
// boundary. The leak validator checks this set against the persona's ACL.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { Persona, IndexedDoc, AuditTrace } from "./types";
import { classifyIntent } from "./intent";
import { retrieve } from "./retrieve";
import { generateAnswer } from "./generate";

export async function runAgent(
  query: string,
  persona: Persona,
  corpus: IndexedDoc[]
): Promise<AuditTrace> {
  const t0 = Date.now();

  // Tool 1: classify intent (also flags injection).
  const intent = classifyIntent(query);

  // Tool 2: retrieve with pre-context ACL enforcement.
  const retrieval = retrieve(query, persona, corpus);
  const contextDocs = retrieval.allowedTopK.map((s) => s.doc);
  const contextSourceIds = contextDocs.map((d) => d.id);

  // Tool 3: generate (intent-aware; abstains before LLM when appropriate).
  const answer = await generateAnswer(query, intent, contextDocs);

  const latencyMs = Date.now() - t0;

  return {
    queryId: randomUUID(),
    query,
    persona,
    intent,
    retrieval,
    contextSourceIds,
    answer,
    latencyMs,
    estCostUsd: answer.estCostUsd ?? 0,
    timestamp: new Date().toISOString(),
  };
}