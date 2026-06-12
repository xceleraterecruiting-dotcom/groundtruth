// ============================================================================
// GroundTruth — Permission Resolver
// ============================================================================
//
// THE CORE SECURITY PRIMITIVE. Everything else trusts this function.
//
// Design decisions (defendable in interview):
//   1. ACCESS IS DECIDED HERE AND ONLY HERE. Retrieval, generation, and evals
//      all call canAccess(). There is no second, looser path.
//   2. DEPRECATION IS NOT ACCESS (blocker 3). A deprecated restricted doc is
//      still restricted. Freshness is handled later, in the conflict resolver.
//      Conflating the two is exactly how real systems leak stale-but-secret data.
//   3. RESTRICTED TIER IS ALLOW-LIST ONLY. Default deny. An empty/false
//      allowedRoles match returns ok:false. Orphaned owner does not widen access.
//   4. Pure function, fully unit-tested. Determinism starts here.
// ============================================================================

import type { Persona, Doc, AccessDecision, Role } from "./types";

export function resolveRoles(persona: Persona): Set<Role> {
  return new Set(persona.roles);
}

export function canAccess(persona: Persona, doc: Doc): AccessDecision {
  const roles = resolveRoles(persona);

  // Tier-based grants for non-restricted docs.
  // NOTE: we intentionally do NOT consult `doc.deprecated` here.
  if (doc.sensitivity === "public") {
    return { ok: true, reason: "public-tier" };
  }
  if (doc.sensitivity === "internal") {
    // Least privilege: internal docs require an employee role. An external
    // actor (e.g. auditor with no employee role) is denied internal content.
    if (!roles.has("employee")) {
      return { ok: false, reason: "internal-requires-employee" };
    }
    // Internal allowedRoles are ENFORCED, not informational: an internal doc
    // tagged with an explicit allow-list is role-scoped and requires employee
    // AND a listed role. An empty allow-list means any employee may read it.
    // (This mirrors real enterprise tiers, where "internal" is a base
    // visibility level that role/group ACLs can still narrow.)
    if (doc.allowedRoles.length > 0) {
      for (const r of doc.allowedRoles) {
        if (roles.has(r)) return { ok: true, reason: "internal-tier" };
      }
      return { ok: false, reason: "internal-role-restricted" };
    }
    return { ok: true, reason: "internal-tier" };
  }

  // Restricted: default deny, allow-list only.
  const allowed = doc.allowedRoles;
  if (allowed.length === 0) {
    // Orphaned ACL (e.g. doc owned by a departed employee, no roles attached).
    // Default deny. This is the safe behavior for the orphaned-ACL edge case.
    return { ok: false, reason: "orphaned-acl" };
  }
  for (const r of allowed) {
    if (roles.has(r)) return { ok: true, reason: "restricted-role-match" };
  }
  return { ok: false, reason: "restricted-no-role" };
}

// Convenience for filtering with reasons retained (used by retrieval trace).
export function partitionByAccess<T extends { doc: Doc }>(
  persona: Persona,
  scored: T[]
): { allowed: T[]; denied: Array<T & { denyReason: string }> } {
  const allowed: T[] = [];
  const denied: Array<T & { denyReason: string }> = [];
  for (const s of scored) {
    const d = canAccess(persona, s.doc);
    if (d.ok) allowed.push(s);
    else denied.push({ ...s, denyReason: d.reason });
  }
  return { allowed, denied };
}