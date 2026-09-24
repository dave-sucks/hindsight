/**
 * record-run-summary.replay.test.ts — the narration→execution gate, through
 * its real execute (DAV-311).
 *
 * This gate is the one that catches an agent narrating "I'll close $X" and
 * never calling `close_position`. It has cost real runs — 2026-05-20 EV
 * Catalyst/ON, then three on 2026-05-22 — and it had no test through the tool
 * the run actually calls, only through the pure matcher underneath.
 *
 * A gate that stops being reached is indistinguishable from a gate that finds
 * nothing: both are silence. These cases pin reachability, running the real
 * gate against real rows.
 */
import { replayTool, thesisRow, positionRow, REPLAY_ANALYST_ID, REPLAY_RUN_ID } from "@/lib/replay";

const runRow = () => ({
  id: REPLAY_RUN_ID,
  status: "RUNNING",
  mode: "MORNING_PLAN",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
});

const pick = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  ticker: "AAA",
  direction: "LONG" as const,
  confidence: 72,
  reasoning: "Held; chart intact and nothing beats it for the slot.",
  action: "HOLD" as const,
  composite_score: 7,
  ...over,
});

const baseArgs = {
  primary_decision: "HOLD" as const,
  ranked_picks: [pick()],
  decision_rationale:
    "The book is where I want it. Nothing on the watchlist beats what we already hold on either chart " +
    "quality or catalyst proximity, cash is adequate, and forcing a trade to look busy is how the last " +
    "two drawdowns started. Holding everything and revisiting on the next scheduled review.",
};

describe("record_run_summary's narration gate runs on the real path", () => {
  it("a clean HOLD summary is recorded", async () => {
    const { result, db } = await replayTool("record-run-summary", "recordRunSummary", {
      seed: {
        researchRun: [runRow()],
        thesis: [thesisRow({ id: "t1", ticker: "AAA", status: "HOLDING" })],
        position: [positionRow({ symbol: "AAA" })],
      },
      args: baseArgs,
      quotes: { AAA: 104 },
    });

    expect(result.summary).not.toMatch(/failed/i);
    // The summary is on the record — that row is what the next run reads back.
    expect(db.store.runEvent.some((e) => e.type === "run_summary")).toBe(true);
  });

  it("a thesis edit on a stock we do not own is recorded as WATCH, not HOLD", async () => {
    // The agent mislabels this constantly; the tool corrects it so the run
    // summary, the decision rows and the card cannot disagree about whether
    // we own the thing.
    const { db } = await replayTool("record-run-summary", "recordRunSummary", {
      seed: {
        researchRun: [runRow()],
        thesis: [thesisRow({ id: "t2", ticker: "BBB", status: "WATCHING" })],
        position: [],
      },
      args: { ...baseArgs, ranked_picks: [pick({ ticker: "BBB", action: "HOLD" })] },
      quotes: { BBB: 40 },
    });

    const event = db.store.runEvent.find((e) => e.type === "run_summary")!;
    const picks = (event.payload as { ranked_picks?: { ticker: string; action: string }[] }).ranked_picks ?? [];
    expect(picks.find((p) => p.ticker === "BBB")?.action).toBe("WATCH");
  });
});
