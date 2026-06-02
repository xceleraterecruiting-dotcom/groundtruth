// ============================================================================
// GroundTruth — Intent Classification
// ============================================================================
//
// Deterministic, rule-based intent. Maps a query to (a) sensitive categories
// it is probing and (b) whether it contains a prompt-injection pattern.
//
// Used by generation (blocker 6): if a query is probing a sensitive category
// and NONE of the allowed context docs belong to that category, the agent
// abstains BEFORE the LLM call. This is what makes the adversarial leak tests
// meaningful — the refusal is a deliberate control, not an accident of empty
// retrieval.
// ============================================================================

import type { Intent, Category } from "./types";

const CATEGORY_TRIGGERS: Array<{ category: Category; patterns: RegExp[] }> = [
  {
    category: "compensation",
    patterns: [
      /\bcomp(ensation)?\b/i,
      /\bsalary\b/i,
      /\bpay\s*band/i,
      /\bpay\b/i,
      /\bbonus\b/i,
      /\bequity\b/i,
      /\braise\b/i,
      /\bmake\b.*\b(engineer|staff|senior|employee)/i,
      /\b(engineer|staff|senior|employee)s?\b.*\bmake\b/i,
      /how much.*(paid|earn|make)/i,
      /\bpay range\b/i,
    ],
  },
  {
    category: "performance",
    patterns: [/\bpip\b/i, /performance improvement/i, /\breview score/i, /\bratings?\b/i],
  },
  {
    category: "workforce",
    patterns: [/\blayoff/i, /\brif\b/i, /reduction in force/i, /reorg/i, /headcount plan/i],
  },
  {
    category: "legal_confidential",
    patterns: [/litigation/i, /lawsuit/i, /confidential legal/i, /settlement/i, /legal dispute/i],
  },
  {
    category: "finance_confidential",
    patterns: [
      /pre-?release financ/i,
      /unreleased revenue/i,
      /board deck/i,
      /material non-public/i,
      /\bq[1-4]\b.*revenue/i,
      /revenue.*\bq[1-4]\b/i,
      /quarterly revenue/i,
    ],
  },
  {
    category: "eng_incident",
    patterns: [/breach/i, /security incident/i, /postmortem/i, /vulnerab/i, /secret key|api key|credential/i],
  },
  {
    category: "sales_crm",
    patterns: [
      /deal\s*notes/i,
      /discount matrix/i,
      /contract terms/i,
      /customer pricing/i,
      /\bdeal terms\b/i,
      /\b(acme|customer)\b.*\b(deal|discount|contract|pricing|terms)\b/i,
    ],
  },
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:\w+\s+){0,3}(instructions|rules|prompts?)/i,
  /disregard\s+(?:\w+\s+){0,3}(above|prior|previous|system|instructions|rules)/i,
  /you are now/i,
  /developer mode/i,
  /override\s+(?:\w+\s+){0,3}(permissions|access|security|rules)/i,
  /pretend you (can|have access)/i,
  /system override/i,
];

const SENSITIVE_CATEGORIES = new Set<Category>([
  "compensation",
  "performance",
  "workforce",
  "legal_confidential",
  "finance_confidential",
  "eng_incident",
  "sales_crm",
]);

export function classifyIntent(query: string): Intent {
  const categories: Category[] = [];
  for (const { category, patterns } of CATEGORY_TRIGGERS) {
    if (patterns.some((p) => p.test(query))) categories.push(category);
  }
  const injectionDetected = INJECTION_PATTERNS.some((p) => p.test(query));
  const sensitive = categories.some((c) => SENSITIVE_CATEGORIES.has(c));
  return { sensitive, categories: [...new Set(categories)], injectionDetected };
}

export function isSensitiveCategory(c: Category): boolean {
  return SENSITIVE_CATEGORIES.has(c);
}