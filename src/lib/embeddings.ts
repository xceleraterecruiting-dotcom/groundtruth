// ============================================================================
// GroundTruth — Embeddings & Similarity
// ============================================================================
//
// Deterministic, dependency-free embeddings. We hash token n-grams into a
// fixed-dimension vector. This is NOT semantically state-of-the-art, and we
// say so: in production this swaps for a real embedding model + vector store.
// For a launch-GATE prototype the requirement is DETERMINISM and REPRODUCIBLE
// RANKING, not embedding quality. Same input -> same vector -> same eval score,
// every run, offline, with no network. That is what makes the eval gate
// trustworthy (and what a reviewer will check).
// ============================================================================

import type { Doc, IndexedDoc } from "./types";

const DIM = 256;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// FNV-1a hash -> stable bucket index.
function hashToken(t: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % DIM;
}

export function embed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    v[hashToken(toks[i])] += 1;
    if (i + 1 < toks.length) {
      // bigram for a little word-order signal
      v[hashToken(toks[i] + "_" + toks[i + 1])] += 0.5;
    }
  }
  // L2 normalize so cosine == dot product.
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both are L2-normalized
}

export function indexCorpus(docs: Doc[]): IndexedDoc[] {
  return docs.map((d) => ({
    ...d,
    embedding: d.embedding ?? embed(d.title + "\n" + d.body),
  }));
}