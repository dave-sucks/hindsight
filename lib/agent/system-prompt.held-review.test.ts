/**
 * system-prompt.held-review.test.ts — the BUILT daily prompt tells a review
 * how to answer a fired trigger, and tells a held stock's review to go down
 * its invalidation conditions (DAV-323, DAV-326).
 *
 * Two real failures behind it:
 *
 *   1. #720 wrote the new review sentence into `system-prompt-template.ts`,
 *      which is the PREVIEW shown on the workflow page. The prompt a run
 *      actually receives is built by `dailyRunRequest`, and it
 *      still said "update_thesis with the substantive change you decide."
 *      The run was never told. So this test reads the built prompt. (The
 *      preview and its template were deleted with the workflow page.)
 *
 *   2. The conditions were always on the row — `get_theses` returns a
 *      work-list row in full — but nothing told the run to walk them. Live
 *      account, morning runs, 21 days to 2026-09-27: CEG's answers name
 *      them 5 times in 5; MU's once in 6; NVDA's never.
 */
import { morningRunSent } from "@/lib/agent/__fixtures__/morning-run-sent";
import type { RunInput } from "./run-input";
import { situationText } from "./situation-skills";
import { replayTool, thesisRow, positionRow, thesisUpdateRow } from "@/lib/replay";

const runInput = () =>
  ({
    portfolio: {
      cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [],
      exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 },
    },
    watchlist: [], activeTheses: [],
    triggersFiredSinceLastRun: [], triggersMatchingNow: [],
    earnings: { reportingSoon: [], justReported: [] },
    filings: { recent: [] },
  }) as unknown as RunInput;

const built = () =>
  morningRunSent(
    { name: "Secular Compounder", maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 6 },
    runInput(),
  );

/** The walk's one line, step 2, from a prompt. */
const walkLine = (prompt: string) =>
  prompt.split("\n").find((l) => l.trimStart().startsWith("2. Walk your work list")) ?? "";
const review = situationText("REVIEW_DUE", true);

describe("answering a review: its skill, which the read carries with the stock", () => {
  it("asks what changed since the last note, and for the verdict", () => {
    expect(review).toContain("1. What has happened to the company and the stock since your last note? If nothing, say so.");
    expect(review).toContain("Done: one note with what changed since the last one and the verdict.");
  });

  it("says what to do when the answer would be the same as last time", () => {
    expect(review).toContain("If you gave the same answer last time, change a trigger or say what is different now.");
  });

  it("threatens no refusal — none exists", () => {
    expect(review).not.toMatch(/does not answer a fire|will refuse|is refused/i);
  });

  it("tells a held stock's review to go down its KPIs", () => {
    expect(review).toContain("Go down the KPIs. Name any line that has happened or failed.");
    expect(review).toContain("A line proved the case wrong: propose the sale.");
  });

  it("the built prompt sends the run to the guidance", () => {
    expect(walkLine(built())).toContain("`guidance`");
  });
});

describe("get_theses — a held stock on the work list carries the list the prompt names", () => {
  it("CEG's conditions are on the row the run reads", async () => {
    const conditions = [
      "A hyperscaler restructures or walks from a signed PPA",
      "The Crane restart slips beyond 2028",
      "Two consecutive guidance cuts tied to Calpine integration",
      "The nuclear production tax credit is repealed",
    ];
    const rung = {
      id: "cf39ff35-5a15-43d4-a0f1-911cb5fd519b",
      predicate: { watch: "price", is: "below", variable: "sma200" },
      action: "REVIEW",
      rationale: "Below the 200-day — review",
    };
    const { result, crashed } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [
          thesisRow({
            id: "t_ceg",
            ticker: "CEG",
            status: "HOLDING",
            horizon: "COMPOUNDER",
            entryPrice: 300,
            targetPrice: 420,
            stopLoss: 220,
            kpis: conditions,
            triggers: [rung],
          }),
        ],
        position: [positionRow({ id: "pos_ceg", symbol: "CEG", avgCost: 300, quantity: 20 })],
        thesisUpdate: [
          thesisUpdateRow({
            id: "fire_ceg",
            thesisId: "t_ceg",
            type: "TRIGGER_FIRED",
            triggerId: rung.id,
            runId: null,
            timestamp: new Date(Date.now() - 86_400_000),
          }),
        ],
      },
      args: {},
      quotes: { CEG: 263.46 },
    });

    expect(crashed).toBe(false);
    const rows = (result as { data?: { theses?: Array<Record<string, unknown>> } }).data?.theses ?? [];
    const ceg = rows.find((r) => r.ticker === "CEG");
    expect((ceg?.needsAction as { kind?: string } | null)?.kind).toBe("TRIGGER_FIRED");
    expect(ceg?.kpis).toEqual(conditions);
  });
});
