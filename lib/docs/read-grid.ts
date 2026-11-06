/**
 * The Framework page's read section, built on the server from the one
 * builder (lib/agent/row-for-model.ts): which row keys each read sends, each
 * read as the model gets it (read-sample.ts), and the grid, one row per sheet
 * field, saying when it is sent: always, with which situations, on the review
 * clock only, or by name only. The page never hand-writes any of it; when
 * ROW_FIELDS changes, the page follows (lib/docs/read-cases.test.ts).
 */
import { ROW_FIELDS, REVIEW_SITUATION, rowKeysFor, type RowKeyRule } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { LINE_KEYS, SHEET_FIELDS, WRITER_KEYS, type FrameworkRead, type ReadGridRow } from "./framework-content";
import { buildReadSamples } from "./read-sample";

export const SITUATION_CODES = Object.keys(SITUATIONS) as SituationCode[];

/** The keys each read sends. */
export function readKeys(): FrameworkRead["keys"] {
  const bySituation: Record<string, string[]> = {};
  for (const code of SITUATION_CODES) bySituation[code] = [...rowKeysFor([code], { size: "short", named: false })];
  return {
    line: [...LINE_KEYS],
    review: [...rowKeysFor([REVIEW_SITUATION], { size: "short", named: false })],
    named: [...rowKeysFor([], { size: "full", named: true })],
    writer: [...WRITER_KEYS],
    bySituation,
  };
}

/** When a sheet field is sent, read off the rules of the keys that carry it. */
export function readGrid(): ReadGridRow[] {
  return SHEET_FIELDS.map((f) => {
    const rules = f.keys.map((k) => ROW_FIELDS[k]).filter((r): r is RowKeyRule => r != null);
    if (rules.some((r) => r === "always")) return { fieldId: f.id, when: "always", situations: [] };
    const codes = new Set(rules.flatMap((r) => (typeof r === "string" ? [] : [...r])));
    if (codes.size > 0) {
      return { fieldId: f.id, when: "situations", situations: SITUATION_CODES.filter((c) => codes.has(c)).map((code) => ({ code, name: SITUATIONS[code].name })) };
    }
    return { fieldId: f.id, when: rules.some((r) => r === "review") ? "review" : "named", situations: [] };
  });
}

export function buildFrameworkRead(): FrameworkRead {
  return { keys: readKeys(), samples: buildReadSamples(), grid: readGrid() };
}
