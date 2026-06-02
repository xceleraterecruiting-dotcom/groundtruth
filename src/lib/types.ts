// ============================================================================
// GroundTruth — Core Types
// Launch Gate for Permission-Safe Enterprise Agents
// ============================================================================
//
// Design note (defendable in interview):
//   - `Doc` is the authored corpus record. It carries ACL + freshness metadata.
//   - `IndexedDoc` is a `Doc` after the embedding step. Retrieval operates ONLY
//     on IndexedDoc[], so the embedding field is always present at the type
//     level where it is used (fixes "embedding!" non-null assertion smell).
//   - Sensitivity tiers and categories are closed unions so the compiler
//     catches typos and so eval coverage can be checked per-category.
// ============================================================================

import { z } from "zod";

// ---- Closed unions ---------------------------------------------------------

export const ROLES = [
  "employee",
  "eng",
  "eng_manager",
  "hr_admin",
  "sales",
  "legal",
  "finance_admin",
] as const;
export type Role = (typeof ROLES)[number];

export const SENSITIVITY = ["public", "internal", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITY)[number];

// Categories are used for (a) intent classification and (b) per-category
// launch approval. Keep them ASCII, stable, and exhaustive.
export const CATEGORIES = [
  "hr_policy",
  "compensation",
  "performance", // PIP / reviews
  "workforce", // layoff / org planning
  "eng_docs",
  "eng_incident",
  "runbook",
  "sales_crm",
  "legal_confidential",
  "legal_template",
  "finance_confidential",
  "finance_policy",
  "general",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOURCES = [
  "hr_system",
  "eng_wiki",
  "crm",
  "legal_repo",
  "finance_system",
  "marketing",
] as const;
export type SourceSystem = (typeof SOURCES)[number];

// ---- Document schema (Zod = single source of truth) ------------------------

export const DocSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_]+$/, "ASCII id only"),
  title: z.string(),
  sourceSystem: z.enum(SOURCES),
  category: z.enum(CATEGORIES),
  sensitivity: z.enum(SENSITIVITY),
  // allowedRoles: roles that may read this doc. For `public`/`internal`,
  // this is informational; the resolver grants by tier. For `restricted`,
  // this is the authoritative allow-list.
  allowedRoles: z.array(z.enum(ROLES)),
  // owner present for traceability; orphaned owner => orphaned ACL edge case.
  owner: z.string().nullable(),
  // freshness metadata. `deprecated` is NOT an access signal (blocker 3).
  updatedAt: z.string(), // ISO date
  deprecated: z.boolean().default(false),
  // `supersededBy` lets the conflict resolver prefer the canonical doc.
  supersededBy: z.string().nullable().default(null),
  body: z.string(),
  // Optional embedding present only after indexing.
  embedding: z.array(z.number()).optional(),
});

export type Doc = z.infer<typeof DocSchema>;

// A Doc guaranteed to carry an embedding. Retrieval consumes these.
export type IndexedDoc = Doc & { embedding: number[] };

// ---- Personas --------------------------------------------------------------

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  roles: z.array(z.enum(ROLES)),
});
export type Persona = z.infer<typeof PersonaSchema>;

// ---- Access decision -------------------------------------------------------

export interface AccessDecision {
  ok: boolean;
  reason:
    | "public-tier"
    | "internal-tier"
    | "internal-requires-employee"
    | "restricted-role-match"
    | "restricted-no-role"
    | "orphaned-acl";
}

// ---- Retrieval trace -------------------------------------------------------

export interface ScoredDoc {
  doc: IndexedDoc;
  score: number;
}

export interface RetrievalTrace {
  topKConsidered: ScoredDoc[]; // full scored candidate window (for the trace)
  allowedTopK: ScoredDoc[]; // docs that passed ACL -> may enter context
  deniedTopK: Array<{ doc: IndexedDoc; score: number; reason: string }>; // blocked
  conflictsResolved: Array<{ keptId: string; droppedId: string; why: string }>;
  staleDropped: string[]; // doc ids dropped for being deprecated/superseded
}

// ---- Answer / citations ----------------------------------------------------

export interface Claim {
  text: string;
  citation: { sourceId: string; quote: string } | null;
}

export interface Answer {
  abstained: boolean;
  text: string;
  claims: Claim[];
  escalationPath?: string; // e.g. "Contact People Ops via #ask-hr"
  estCostUsd?: number; // real cost from the LLM call; 0 on cache hit or abstain
}

// ---- Intent ----------------------------------------------------------------

export interface Intent {
  sensitive: boolean;
  categories: Category[];
  injectionDetected: boolean;
}

// ---- Full audit trace (one per query) --------------------------------------

export interface AuditTrace {
  queryId: string;
  query: string;
  persona: Persona;
  intent: Intent;
  retrieval: RetrievalTrace;
  contextSourceIds: string[]; // docs that actually entered model context
  answer: Answer;
  latencyMs: number;
  estCostUsd: number;
  timestamp: string;
}

// ---- Validators ------------------------------------------------------------

export interface LeakValidation {
  pass: boolean;
  // Any restricted doc id that entered context for a persona not allowed it.
  leakedSourceIds: string[];
  // Any restricted content phrase detected in answer text.
  leakedPhrases: string[];
}

export interface CitationValidation {
  // coverage = claims with a valid, source-grounded citation / total claims
  coverage: number;
  // groundedness = claims whose cited quote is actually present in the source
  groundedness: number;
  invalidClaims: number;
}