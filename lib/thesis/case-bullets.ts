/**
 * A thesis's bull or bear case as the page draws it: its bullets, each with
 * its source when it names one. The column is Json and older rows carry
 * other shapes (a bare string, string bullets); anything but a sentence is
 * dropped, never drawn as a blank. Pure.
 */

import type { ResearchCitation } from "@/lib/types/thesis-sheet";

export interface CaseBullet {
  text: string;
  citation?: ResearchCitation;
}

export function caseBullets(value: unknown): CaseBullet[] {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [{ text: value.trim() }] : [];
  if (typeof value !== "object") return [];
  const list = (value as { bullets?: unknown }).bullets;
  if (!Array.isArray(list)) return [];
  const out: CaseBullet[] = [];
  for (const b of list) {
    if (typeof b === "string") {
      if (b.trim()) out.push({ text: b.trim() });
      continue;
    }
    if (typeof b !== "object" || b === null) continue;
    const { text, citation } = b as { text?: unknown; citation?: unknown };
    if (typeof text !== "string" || !text.trim()) continue;
    out.push(citation && typeof citation === "object" ? { text: text.trim(), citation: citation as ResearchCitation } : { text: text.trim() });
  }
  return out;
}
