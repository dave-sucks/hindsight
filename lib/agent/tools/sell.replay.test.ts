/**
 * sell.replay.test.ts — the sell tool's own gates, through the entry point
 * the run calls (DAV-311; close_position's until 2026-11-18).
 *
 * The sale had no test through its `execute` at all. Its two refusals
 * — no position to close, and a PROMOTED thesis — are the shape that has gone
 * dead four times now: a rule a downstream helper enforces, reachable only if
 * everything upstream of it lets the call through. This pins the reachability,
 * not just the arithmetic.
 *
 * The harness's own broker guard is asserted in lib/replay/smoke.test.ts, not
 * restated here.
 */
import { replayTool, thesisRow, positionRow, accountRow, REPLAY_ANALYST_ID, type Replay } from "@/lib/replay";
import srrk from "@/lib/agent/__fixtures__/srrk-sale-label-2026-09-14.json";

const held = (over: Record<string, unknown> = {}) =>
  positionRow({ symbol: "AAA", status: "OPEN", quantity: 100, avgCost: 100, ...over });

const heldThesis = (over: Record<string, unknown> = {}) =>
  thesisRow({ id: "t_aaa", ticker: "AAA", status: "HOLDING", analystId: REPLAY_ANALYST_ID, ...over });

describe("sell refuses what it should, through its real execute", () => {
  it("nothing held: says so instead of inventing a sale", async () => {
    const { result, db } = await replayTool("sell", "sell", {
      seed: { thesis: [heldThesis()] },
      args: { ticker: "AAA", note: "Floor tripped." },
      quotes: { AAA: 92 },
    });
    expect(result.summary).toContain("No position to close");
    // Nothing invented: no decision row, no position mutated into existence.
    expect(db.store.position).toHaveLength(0);
  });

  it("a PROMOTED thesis is not closeable here — that decision belongs to the run", async () => {
    const { result } = await replayTool("sell", "sell", {
      seed: {
        thesis: [heldThesis({ status: "PROMOTED", promotedAt: new Date("2026-09-01T00:00:00Z") })],
        position: [held()],
      },
      args: { ticker: "AAA", note: "Cleaning up." },
      quotes: { AAA: 101 },
    });
    expect(result.summary).toContain("PROMOTED");
  });
});

describe("SRRK 09-14: a sale no trigger fired is MANUAL, and keeps the analyst's words as its reason", () => {
  // LIVE sells wait for the owner, so the replay stops at the proposal.
  const sell = (call: Record<string, unknown>) =>
    replayTool("sell", "sell", {
      seed: {
        thesis: [thesisRow({ id: "t_srrk", ...srrk.thesis, analystId: REPLAY_ANALYST_ID })],
        position: [positionRow({ ...srrk.position, analystId: REPLAY_ANALYST_ID })],
        account: [accountRow({ requireApprovalSellsLive: true })],
      },
      ctx: { runEnvironment: "LIVE" },
      args: call,
      quotes: { SRRK: srrk.price },
    });
  const orderOf = (r: Replay) => (r.db.store.order as Array<Record<string, unknown>>)[0];
  const eventOf = (r: Replay) => (r.db.store.runEvent as Array<{ type: string; payload: Record<string, unknown> }>).find((e) => e.type === "position_close_proposed");

  // The model called it TARGET at $55.41 and code corrected it; now the model names no label and code sets it.
  it("the sale at $55.41 is stored MANUAL with nothing to correct; the reason is the note alone", async () => {
    const r = await sell({ ticker: srrk.call.ticker, note: srrk.call.notes });
    expect([r.crashed, r.refused, r.result.data?.status]).toEqual([false, false, "PROPOSED"]);
    expect(orderOf(r)).toMatchObject({ status: "AWAITING_APPROVAL", closeReason: "MANUAL", rationale: srrk.call.notes });
    expect(r.result.data?.rationale).toBe(srrk.call.notes);
    expect(r.result.data?.label_auto_corrected).toBeUndefined();
    expect(eventOf(r)?.payload).toMatchObject({ reason: "MANUAL" });
  });

  it("a variant: no note — the reason is empty, not a sentence the app wrote", async () => {
    const r = await sell({ ticker: srrk.call.ticker });
    expect(r.result.data?.status).toBe("PROPOSED");
    expect(orderOf(r).rationale ?? null).toBeNull();
  });

  it("a protective fire labels it, whatever the belief call", async () => {
    const r = await replayTool("sell", "sell", {
      seed: {
        thesis: [thesisRow({ id: "t_srrk", ...srrk.thesis, analystId: REPLAY_ANALYST_ID })],
        position: [positionRow({ ...srrk.position, analystId: REPLAY_ANALYST_ID })],
        account: [accountRow({ requireApprovalSellsLive: true })],
      },
      ctx: { runEnvironment: "LIVE", runMode: "INTRADAY_TACTICAL", protectiveExitReason: "STOP" },
      args: { ticker: srrk.call.ticker, belief_survived: false },
      quotes: { SRRK: srrk.price },
    });
    expect(orderOf(r)).toMatchObject({ status: "AWAITING_APPROVAL", closeReason: "STOP" });
  });

  it("a percent sells that part, as a trim", async () => {
    const r = await sell({ ticker: srrk.call.ticker, percent: 50 });
    expect(orderOf(r)).toMatchObject({ intent: "PARTIAL_CLOSE", quantity: Math.floor(srrk.position.quantity / 2) });
  });
});
