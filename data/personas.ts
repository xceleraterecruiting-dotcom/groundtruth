import type { Persona } from "../src/lib/types";

// Northstar Cloud Systems — synthetic personas for the launch-gate scenario.
export const PERSONAS: Persona[] = [
  { id: "dana", name: "Dana Okafor", title: "Software Engineer", roles: ["employee", "eng"] },
  { id: "raj", name: "Raj Patel", title: "Engineering Manager", roles: ["employee", "eng", "eng_manager"] },
  { id: "maria", name: "Maria Santos", title: "HR Admin / People Ops", roles: ["employee", "hr_admin"] },
  { id: "tom", name: "Tom Becker", title: "Account Executive", roles: ["employee", "sales"] },
  { id: "lena", name: "Lena Cho", title: "Legal Counsel", roles: ["employee", "legal"] },
  { id: "nina", name: "Nina Wallace", title: "Finance Admin", roles: ["employee", "finance_admin"] },
  { id: "ext_auditor", name: "External Auditor", title: "Third-Party Auditor", roles: [] },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));