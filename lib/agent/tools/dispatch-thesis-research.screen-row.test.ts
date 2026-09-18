/**
 * A long screen row is trimmed, never a reason to refuse the dispatch.
 *
 * Replay: the principal chat's first LUXE dispatch, 2026-09-17 22:50 ET —
 * a 458-character row, refused whole with "Too big: expected string to have
 * <=400 characters". The chat recovered by rewriting it shorter; the row is
 * seed context for the writer and nothing depends on its length.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
import type { z } from "zod";
import { dispatchThesisResearch, trimScreenRow, SCREEN_ROW_MAX } from "./dispatch-thesis-research";

const LUXE_ROW =
  "Reported 2026-09-16, EPS +111% vs est, all three segments returned to growth (Q4 GMV +7.9%), gapped ~17% on 18× volume. Gap held — stock added another +3.3% day-after on 3.6× volume. Price $9.48, 27-day base (depth 12%) broken out. RS vs SPY +26pts 1M, +21pts 3M. In-universe $1.2B market cap. Caution: Trend Template 5/8 — 150/200-day stack not fully aligned; this is a post-earnings drift play inside a longer-term recovery, not a classic stage-2 breakout.";

const schemaOf = () =>
  (dispatchThesisResearch({ runId: "r", userId: "u" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;

describe("dispatch_thesis_research — the screen row", () => {
  it("the LUXE dispatch is accepted, with its row cut at a whole word", () => {
    expect(LUXE_ROW.length).toBe(458);
    const parsed = schemaOf().safeParse({
      ticker: "LUXE",
      analyst_id: "cmnhxpjio000004jvox6kl6c7",
      mode: "mint",
      reason: "Survives PEAD triage — dispatching for the deep look.",
      setup_id: "PEAD",
      screen_row: LUXE_ROW,
    });
    expect(parsed.success).toBe(true);
    const row = (parsed.data as { screen_row: string }).screen_row;
    expect(row.length).toBeLessThanOrEqual(SCREEN_ROW_MAX);
    expect(row.endsWith("…")).toBe(true);
    expect(row.startsWith("Reported 2026-09-16, EPS +111% vs est")).toBe(true);
    expect(LUXE_ROW.startsWith(row.slice(0, -1))).toBe(true);
    expect(LUXE_ROW[row.length - 1]).toBe(" ");
  });

  it("a row that fits is left exactly as written", () => {
    const short = "Reported 09-10, EPS +22% vs est, gapped 9% on 3.1× volume.";
    expect(trimScreenRow(short)).toBe(short);
    expect(trimScreenRow(`  ${short}  `)).toBe(short);
  });

  it("a row with no spaces is still cut to fit", () => {
    expect(trimScreenRow("x".repeat(900)).length).toBe(SCREEN_ROW_MAX);
  });
});
