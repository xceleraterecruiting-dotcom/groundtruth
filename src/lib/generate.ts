// ============================================================================
// GroundTruth — Answer Generation
// ============================================================================
//
// Blocker 6 fix: generation receives the classified Intent. If the query
// probes a sensitive category AND none of the allowed context docs belong to
// that category, we ABSTAIN BEFORE the LLM call. This closes the hole where an
// adversarial sensitive query could be answered from irrelevant allowed docs.
//
// The model is only ever asked to answer FROM the allowed context, and is
// instructed to cite every claim with an exact quote from a provided source.
// ============================================================================

import type { Answer, Intent, IndexedDoc, Claim } from "./types";
import { isSensitiveCategory } from "./intent";
import { complete } from "./llm";

const ESCALATION: Record<string, string> = {
  compensation: "Compensation data is restricted. Contact People Ops via #ask-hr.",
  performance: "Performance records are restricted. Contact your HRBP.",
  workforce: "Workforce planning is restricted. Contact People Ops leadership.",
  legal_confidential: "Confidential legal matters: contact the Legal team.",
  finance_confidential: "Pre-release financials are restricted. Contact Finance.",
  eng_incident: "Security incident details are restricted. Contact Security.",
  sales_crm: "Customer deal data is restricted to the deal team.",
};

function abstain(reason: string, categories: string[]): Answer {
  const cat = categories.find((c) => ESCALATION[c]);
  return {
    abstained: true,
    text: reason,
    claims: [],
    escalationPath: cat ? ESCALATION[cat] : "Contact the relevant data owner.",
  };
}

export function buildPrompt(query: string, contextDocs: IndexedDoc[]): string {
  const sources = contextDocs
    .map(
      (d, i) =>
        `[#${i + 1}] sourceId=${d.id} title=${JSON.stringify(d.title)}\n${d.body}`
    )
    .join("\n\n");

  return [
    "You are an internal support agent. Answer ONLY from the SOURCES below.",
    "Every claim MUST include a citation: an object {sourceId, quote} where",
    "quote is an EXACT substring copied from that source. If the sources do not",
    "answer the question, abstain. Respond with STRICT JSON, no markdown:",
    '{"abstained": boolean, "text": string, "claims": [{"text": string, "citation": {"sourceId": string, "quote": string} | null}]}',
    "",
    "SOURCES:",
    sources,
    "",
    "QUESTION: " + query,
  ].join("\n");
}

export async function generateAnswer(
  query: string,
  intent: Intent,
  contextDocs: IndexedDoc[]
): Promise<Answer> {
  // Pre-LLM control 1: nothing allowed to answer from.
  if (contextDocs.length === 0) {
    return abstain(
      "I don't have access to any documents that answer this for your role.",
      intent.categories
    );
  }

  // Pre-LLM control 2 (blocker 6): sensitive probe with no in-scope context.
  if (intent.sensitive) {
    const sensitiveCats = intent.categories.filter(isSensitiveCategory);
    const haveInScope = contextDocs.some((d) =>
      sensitiveCats.includes(d.category)
    );
    if (!haveInScope) {
      return abstain(
        "That information is restricted and isn't available to your role.",
        intent.categories
      );
    }
  }

  const prompt = buildPrompt(query, contextDocs);
  const { text, estCostUsd } = await complete(prompt);
  const answer = parseAnswer(text);
  answer.estCostUsd = estCostUsd;
  return answer;
}

function parseAnswer(raw: string): Answer {
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      abstained: true,
      text: "Could not produce a grounded answer.",
      claims: [],
    };
  }
  const p = parsed as Partial<Answer> & { claims?: Claim[] };
  return {
    abstained: Boolean(p.abstained),
    text: typeof p.text === "string" ? p.text : "",
    claims: Array.isArray(p.claims) ? p.claims : [],
    escalationPath: p.escalationPath,
  };
}