/**
 * The last 30 days of saved morning reads, replayed through the one situation
 * per trigger action (2026-11-15). Every code a read saved before the merge is
 * one of the eight now, no listed stock loses its last situation, and the Agent
 * work tab counts each old code as the one it is now, so no count is dropped.
 * Rows in __fixtures__/morning-codes-30d-2026-11-15.json (48 runs, each row
 * with a code, cut to ticker, list and codes).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "./__fixtures__/morning-codes-30d-2026-11-15.json";
import { SITUATIONS } from "@/lib/agent/situations";
import { MERGED_CODE, buildAgentWork, type Raw } from "./agent-work";

type Row = [string, string, string[]];
const runs = (fixture as unknown as { runs: Array<{ at: string; rows: Row[] }> }).runs;
// #979, 2026-11-13; and a note to answer, under its three names, 2026-11-19.
const DELETED = new Set(["PLAN_PROBLEM", "STALE_RESEARCH", "NO_SETUP_NAMED", "YOUR_WORD_UNANSWERED", "PINNED_NOTE", "NOTE_TO_ANSWER"]);
const now = (c: string) => MERGED_CODE[c] ?? c;

describe("48 morning reads, 2026-10-19 to 2026-11-13", () => {
  const all = runs.flatMap((r) => r.rows.flatMap(([, , codes]) => codes));

  it("every saved code is one of today's, merged into exactly one of them, or deleted by #979", () => {
    const kind = (c: string) => (c in SITUATIONS ? "current" : c in MERGED_CODE ? "merged" : DELETED.has(c) ? "deleted" : "unknown");
    const count: Record<string, number> = {};
    for (const c of all) count[kind(c)] = (count[kind(c)] ?? 0) + 1;
    // A filing saved under its old code is a filing again (2026-11-19), so 7 more are current.
    // The 12 saved as a note to answer are deleted codes now (2026-11-19).
    expect(count).toEqual({ current: 129, merged: 14, deleted: 430 });
    for (const c of Object.keys(MERGED_CODE)) expect(Object.keys(SITUATIONS)).toContain(MERGED_CODE[c]);
  });

  it("no stock on a list loses its last situation: the same stocks are listed, each with its labels", () => {
    const listed = runs.flatMap((r) => r.rows.filter(([, list, codes]) => list !== "quiet" && codes.some((c) => !DELETED.has(c))));
    expect(listed.every(([, , codes]) => codes.filter((c) => !DELETED.has(c)).map(now).length > 0)).toBe(true);
    const before = listed.reduce((n, [, , codes]) => n + codes.filter((c) => !DELETED.has(c)).length, 0);
    const after = listed.reduce((n, [, , codes]) => n + new Set(codes.filter((c) => !DELETED.has(c)).map(now)).size, 0);
    // A report and a filing no longer fold into the review, so no label is lost to a merge here.
    // Of the 132 rows listed then, 8 were listed by a note to answer alone: 124 would be listed today.
    expect([listed.length, before, after]).toEqual([124, 141, 141]);
  });

  it("the Agent work tab counts each saved code as the situation it is now", () => {
    const reads = runs.flatMap((r, i) => r.rows.map(([ticker, list, codes]) => ({ runId: `m${i}`, list: list as "work", thesisId: `${ticker}-${i}`, ticker, codes })));
    const raw: Raw = { analysts: [], levels: { analyst: [], account: [] }, runs: [], reads, updates: [], orders: [], theses: [], refusals: [] };
    const w = buildAgentWork(raw, { days: 30, analystId: null, since: new Date("2026-10-16T00:00:00Z"), now: new Date("2026-11-15T00:00:00Z") });
    expect(Object.fromEntries(w.situations.codes.map((c) => [c.code, c.shown]))).toEqual({
      // A report (saved as EARNINGS) and a filing from before the 2026-11-15 merge are their own again; one saved as a review since then stays a review.
      PROMOTED_AWAITING: 0, PROTECTIVE_SALE: 31, BUY_ARRIVES: 5, ADD_OR_WINNER: 4, REPORT: 9, FILING: 7, NEWS: 0, PROTECTION: 4, REVIEW_DUE: 79, SOLD_ONE_REVIEW: 2,
    });
  });
});
