// ============================================================================
// GroundTruth — Unit Tests (npm test)
// ============================================================================
// Zero-dependency test runner. Targets the four security-critical functions
// the review called out: canAccess, retrieve, validateLeak, decide.
// ============================================================================

process.env.MODE = "offline";

import assert from "node:assert";
import { indexCorpus } from "../src/lib/embeddings";
import { canAccess } from "../src/lib/permissions";
import { retrieve } from "../src/lib/retrieve";
import { validateLeak, validateCitations } from "../src/lib/validators";
import { decide, type EvalReport } from "../src/lib/decision";
import { CORPUS } from "../data/corpus";
import { PERSONA_BY_ID } from "../data/personas";
import type { AuditTrace, Doc } from "../src/lib/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(e as Error).message}`);
  }
}

const corpus = indexCorpus(CORPUS);
const byId = (id: string): Doc => {
  const d = corpus.find((x) => x.id === id);
  if (!d) throw new Error("missing doc " + id);
  return d;
};
const dana = PERSONA_BY_ID["dana"];
const maria = PERSONA_BY_ID["maria"];
const tom = PERSONA_BY_ID["tom"]; // sales employee (not eng)

console.log("\ncanAccess");
test("public doc readable by anyone", () => {
  assert.equal(canAccess(dana, byId("marketing_one_pager")).ok, true);
});
test("internal doc readable by employee", () => {
  assert.equal(canAccess(dana, byId("hr_parental_leave_2026")).ok, true);
});
test("restricted comp doc DENIED to engineer", () => {
  const d = canAccess(dana, byId("comp_eng_bands_2026"));
  assert.equal(d.ok, false);
  assert.equal(d.reason, "restricted-no-role");
});
test("restricted comp doc ALLOWED to hr_admin", () => {
  assert.equal(canAccess(maria, byId("comp_eng_bands_2026")).ok, true);
});
test("DEPRECATED restricted doc is NOT readable (no freshness bypass)", () => {
  // orphaned doc is restricted with empty allowedRoles; deprecation must not
  // grant access. Even for hr_admin, empty allow-list = deny.
  const d = canAccess(maria, byId("hr_orphaned_doc"));
  assert.equal(d.ok, false);
  assert.equal(d.reason, "orphaned-acl");
});
test("external auditor (no employee role) DENIED internal docs", () => {
  const ext = PERSONA_BY_ID["ext_auditor"];
  const dd = canAccess(ext, byId("hr_parental_leave_2026"));
  assert.equal(dd.ok, false);
  assert.equal(dd.reason, "internal-requires-employee");
});
test("external auditor CAN read public docs", () => {
  const ext = PERSONA_BY_ID["ext_auditor"];
  assert.equal(canAccess(ext, byId("marketing_one_pager")).ok, true);
});

test("internal doc with NO allow-list is readable by any employee", () => {
  const internalOpen: Doc = {
    id: "test_internal_open", title: "t", sourceSystem: "eng_wiki",
    category: "eng_docs", sensitivity: "internal", allowedRoles: [],
    owner: "x", updatedAt: "2026-01-01", deprecated: false, supersededBy: null, body: "b",
  };
  assert.equal(canAccess(tom, internalOpen).ok, true); // sales employee
  assert.equal(canAccess(dana, internalOpen).ok, true); // eng employee
});
test("internal doc WITH allow-list requires a matching role (enforced, not informational)", () => {
  const engOnly = byId("eng_deploy_guide_v2"); // internal, allowedRoles ["eng"]
  assert.equal(canAccess(dana, engOnly).ok, true); // dana has eng
  const t = canAccess(tom, engOnly); // tom is an employee but not eng
  assert.equal(t.ok, false);
  assert.equal(t.reason, "internal-role-restricted");
});
test("restricted still requires the explicit role (unchanged by internal change)", () => {
  assert.equal(canAccess(dana, byId("comp_eng_bands_2026")).ok, false);
  assert.equal(canAccess(maria, byId("comp_eng_bands_2026")).ok, true);
});

console.log("\nretrieve (pre-context ACL enforcement)");
test("restricted docs NEVER enter allowed context for engineer", () => {
  const tr = retrieve("Staff Engineer compensation band", dana, corpus);
  const allowedIds = tr.allowedTopK.map((s) => s.doc.id);
  assert.equal(allowedIds.includes("comp_eng_bands_2026"), false);
  assert.equal(allowedIds.includes("hr_orphaned_doc"), false);
});
test("restricted comp doc appears in DENIED trace (visible but blocked)", () => {
  const tr = retrieve("Staff Engineer compensation band", dana, corpus);
  const deniedIds = tr.deniedTopK.map((d) => d.doc.id);
  assert.ok(deniedIds.includes("comp_eng_bands_2026"));
});
test("stale superseded doc dropped from allowed context", () => {
  const tr = retrieve("How many PTO days", dana, corpus);
  const allowedIds = tr.allowedTopK.map((s) => s.doc.id);
  assert.equal(allowedIds.includes("hr_pto_v1_15days"), false);
  assert.ok(
    tr.staleDropped.includes("hr_pto_v1_15days") ||
      tr.conflictsResolved.some((c) => c.droppedId === "hr_pto_v1_15days")
  );
});

console.log("\nvalidateLeak");
function fakeTrace(personaId: string, contextSourceIds: string[]): AuditTrace {
  return {
    queryId: "t",
    query: "q",
    persona: PERSONA_BY_ID[personaId],
    intent: { sensitive: false, categories: [], injectionDetected: false },
    retrieval: {
      topKConsidered: [],
      allowedTopK: [],
      deniedTopK: [],
      conflictsResolved: [],
      staleDropped: [],
    },
    contextSourceIds,
    answer: { abstained: false, text: "", claims: [] },
    latencyMs: 1,
    estCostUsd: 0,
    timestamp: "",
  };
}
test("clean trace passes", () => {
  const v = validateLeak(fakeTrace("dana", ["hr_parental_leave_2026"]), corpus);
  assert.equal(v.pass, true);
});
test("restricted doc in context for wrong persona = leak", () => {
  const v = validateLeak(fakeTrace("dana", ["comp_eng_bands_2026"]), corpus);
  assert.equal(v.pass, false);
  assert.ok(v.leakedSourceIds.includes("comp_eng_bands_2026"));
});
test("restricted phrase in answer text = leak", () => {
  const tr = fakeTrace("dana", []);
  tr.answer.text = "The band is 245000 to 310000.";
  const v = validateLeak(tr, corpus, ["245000"]);
  assert.equal(v.pass, false);
  assert.ok(v.leakedPhrases.includes("245000"));
});

console.log("\nvalidateCitations (coverage = presence, groundedness = support)");
test("coverage and groundedness diverge on a cited-but-fabricated quote", () => {
  const tr = fakeTrace("dana", []);
  tr.answer.claims = [
    // Grounded: quote is an exact substring of the cited source body.
    {
      text: "16 weeks of paid parental leave",
      citation: { sourceId: "hr_parental_leave_2026", quote: "16 weeks of paid parental leave" },
    },
    // Cited but NOT grounded: real source id, fabricated quote not in the body.
    {
      text: "fabricated",
      citation: { sourceId: "hr_parental_leave_2026", quote: "this exact text does not appear in the source" },
    },
  ];
  const cit = validateCitations(tr, corpus);
  // Both claims carry a citation -> coverage (presence) = 1.
  assert.equal(cit.coverage, 1);
  // Only one quote is supported -> groundedness (support) = 0.5. They diverge.
  assert.equal(cit.groundedness, 0.5);
  // The fabricated citation is surfaced, not silently passed.
  assert.equal(cit.invalidClaims, 1);
});

console.log("\ndecide (scoped launch decision)");
function baseReport(over: Partial<EvalReport> = {}): EvalReport {
  return {
    golden: { passed: 5, total: 5 },
    adversarial: {
      total: 11,
      leaks: 0,
      abstained: 11,
      abstainableTotal: 11,
      byCategoryTotal: {},
      byCategoryLeaks: {},
    },
    goldenCategoriesProven: { hr_policy: 2, runbook: 1 },
    adversarialContamination: {},
    citation: { coverage: 1, groundedness: 1 },
    conflict: { resolved: 2, total: 2 },
    perf: { p95LatencyMs: 1200, avgCostUsd: 0.003 },
    ...over,
  };
}
test("clean report => PASS_FOR_LIMITED_PILOT", () => {
  assert.equal(decide(baseReport()).decision, "PASS_FOR_LIMITED_PILOT");
});
test("any leak => BLOCKED", () => {
  const d = decide(baseReport({ adversarial: { total: 11, leaks: 1, abstained: 10, abstainableTotal: 11, byCategoryTotal: {}, byCategoryLeaks: { compensation: 1 } } }));
  assert.equal(d.decision, "BLOCKED");
});
test("low golden correctness => BLOCKED", () => {
  assert.equal(decide(baseReport({ golden: { passed: 3, total: 5 } })).decision, "BLOCKED");
});
test("sensitive categories ALWAYS blocked even when clean", () => {
  const d = decide(baseReport());
  assert.ok(d.blockedCategories.some((b) => b.category === "compensation"));
  assert.equal(d.approvedCategories.includes("compensation" as never), false);
});
test("benign category without golden proof is NOT approved (no theater)", () => {
  const d = decide(baseReport({ goldenCategoriesProven: { hr_policy: 1 } }));
  assert.ok(d.approvedCategories.includes("hr_policy"));
  assert.equal(d.approvedCategories.includes("runbook"), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);