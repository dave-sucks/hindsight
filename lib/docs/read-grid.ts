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
import { LINE_KEYS, SHEET_FIELDS, WRITER_KEYS, type FrameworkRead, type ReadGridRow, type SituationOrigin } from "./framework-content";
import { buildReadSamples } from "./read-sample";

export const SITUATION_CODES = Object.keys(SITUATIONS) as SituationCode[];

/**
 * What usually puts a stock in each situation (situations.ts `fireCodes` and
 * `flagCodes`): a trigger firing, or a flag read off the stock's facts. A buy
 * level reached and an add or near target can come either way (the price at
 * the level, three quarters of the way to the target); the bolt names the
 * usual one.
 */
export const SITUATION_ORIGIN: Record<SituationCode, SituationOrigin> = {
  AUTO_TRADE: "trigger",
  PROMOTED_AWAITING: "flag",
  PROTECTIVE_SALE: "trigger",
  BUY_ARRIVES: "trigger",
  BUY_BLOCKED_FULL: "trigger",
  ADD_OR_WINNER: "trigger",
  EARNINGS: "trigger",
  FILING: "trigger",
  QUIET_WATCH_WOKE: "trigger",
  PROTECTION: "flag",
  FIRST_RESEARCH: "trigger",
  REVIEW_DUE: "trigger",
  STALE_RESEARCH: "flag",
  PLAN_PROBLEM: "flag",
  YOUR_WORD_UNANSWERED: "flag",
  SOLD_ONE_REVIEW: "flag",
  NO_SETUP_NAMED: "flag",
};

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
      return { fieldId: f.id, when: "situations", situations: SITUATION_CODES.filter((c) => codes.has(c)).map((code) => ({ code, name: SITUATIONS[code].name, origin: SITUATION_ORIGIN[code] })) };
    }
    return { fieldId: f.id, when: rules.some((r) => r === "review") ? "review" : "named", situations: [] };
  });
}

export function buildFrameworkRead(): FrameworkRead {
  return { keys: readKeys(), samples: buildReadSamples(), grid: readGrid() };
}
