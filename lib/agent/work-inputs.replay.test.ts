/**
 * work-inputs.replay.test.ts — one feed: get_theses and complete_run read
 * the same seed through the same loader, so the close-out judges what the
 * read showed. It owes only what it owed before: the stock's own triggers
 * and its own review clock, never an inherited one, a floor too far, or an
 * unprotected gain.
 *
 * Four stocks, one analyst whose rule is a 7-day review:
 *   AAA — held, its floor fired this morning and nothing answered it.
 *   BBB — watched, its own 7-day clock 10 days past.
 *   CCC — held, no clock of its own: only the analyst's is due (a watched
 *         stock never inherits a clock).
 *   DDD — held, up 40% with no floor under it.
 */
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, REPLAY_ANALYST_ID, REPLAY_RUN_ID } from "@/lib/replay";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const FLOOR_ID = "floor-aaa";
const rung = (id: string, action: string, predicate: unknown, cooldownDays = 1) => ({ id, action, predicate, rationale: "r", cooldownDays, source: "AGENT" });
const clock = (id: string) => rung(id, "REVIEW", { watch: "repeat", value: 7 }, 7);

const seed = () => ({
  researchRun: [{ id: REPLAY_RUN_ID, status: "RUNNING", mode: "MORNING_PLAN", agentConfigId: REPLAY_ANALYST_ID, parameters: {}, startedAt: ago(0.1), completedAt: null }],
  runEvent: [{ id: "ev", runId: REPLAY_RUN_ID, type: "run_summary", title: "Run summary", message: "Reviewed the book.", payload: {}, createdAt: new Date() }],
  agentConfig: [agentConfigRow({ triggers: [clock("analyst-clock")] })],
  thesis: [
    thesisRow({ id: "t_aaa", ticker: "AAA", status: "HOLDING", lastReviewedAt: ago(1), researchUpdatedAt: ago(1), triggers: [rung(FLOOR_ID, "EXIT", { watch: "price", is: "below", value: 95 })] }),
    thesisRow({ id: "t_bbb", ticker: "BBB", status: "WATCHING", lastReviewedAt: ago(10), researchUpdatedAt: ago(1), triggers: [clock("own-clock")] }),
    thesisRow({ id: "t_ccc", ticker: "CCC", status: "HOLDING", lastReviewedAt: ago(10), researchUpdatedAt: ago(1), triggers: [] }),
    thesisRow({ id: "t_ddd", ticker: "DDD", status: "HOLDING", lastReviewedAt: ago(1), researchUpdatedAt: ago(1), triggers: [] }),
  ],
  position: [
    positionRow({ id: "pos_aaa", symbol: "AAA", avgCost: 100, quantity: 10, openedAt: ago(20) }),
    positionRow({ id: "pos_ccc", symbol: "CCC", avgCost: 20, quantity: 10, openedAt: ago(20) }),
    positionRow({ id: "pos_ddd", symbol: "DDD", avgCost: 50, quantity: 10, openedAt: ago(20) }),
  ],
  thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: "t_aaa", type: "TRIGGER_FIRED", triggerId: FLOOR_ID, runId: null, timestamp: ago(0.05) })],
});
const QUOTES = { AAA: 91, BBB: 40, CCC: 20, DDD: 70 };

describe("one feed: the read and the close-out", () => {
  it("get_theses leads each stock with its flag", async () => {
    const { result, crashed } = await replayTool("get-theses", "getTheses", { seed: seed(), args: {}, quotes: QUOTES });
    expect(crashed).toBe(false);
    const rows = (result.data?.theses ?? []) as Array<{ ticker: string; needsAction?: { kind: string } | null }>;
    const lead = Object.fromEntries(rows.map((r) => [r.ticker, r.needsAction?.kind ?? null]));
    expect(lead).toEqual({ AAA: "TRIGGER_FIRED", BBB: "REVIEW_DUE", CCC: "REVIEW_DUE", DDD: "UNPROTECTED_GAIN" });
  });

  it("complete_run owes the fire and the stock's own clock, not the inherited clock or the gain", async () => {
    const { result, crashed, db } = await replayTool("complete-run", "completeRun", { seed: seed(), args: {}, quotes: QUOTES });
    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    const said = JSON.stringify(result);
    expect(said).toContain("AAA");
    expect(said).toContain("BBB");
    expect(said).not.toContain("CCC");
    expect(said).not.toContain("DDD");
    expect(db.store.researchRun[0].status).toBe("RUNNING");
  });
});
