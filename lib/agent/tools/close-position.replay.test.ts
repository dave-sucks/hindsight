/**
 * close-position.replay.test.ts — the sell tool's own gates, through the
 * entry point the run calls (DAV-311).
 *
 * `close_position` had no test through its `execute` at all. Its two refusals
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

describe("close_position refuses what it should, through its real execute", () => {
  it("nothing held: says so instead of inventing a sale", async () => {
    const { result, db } = await replayTool("close-position", "closePosition", {
      seed: { thesis: [heldThesis()] },
      args: { ticker: "AAA", reason: "STOP", notes: "Floor tripped." },
      quotes: { AAA: 92 },
    });
    expect(result.summary).toContain("No position to close");
    // Nothing invented: no decision row, no position mutated into existence.
    expect(db.store.position).toHaveLength(0);
  });

  it("a PROMOTED thesis is not closeable here — that decision belongs to the run", async () => {
    const { result } = await replayTool("close-position", "closePosition", {
      seed: {
        thesis: [heldThesis({ status: "PROMOTED", promotedAt: new Date("2026-09-01T00:00:00Z") })],
        position: [held()],
      },
      args: { ticker: "AAA", reason: "MANUAL", notes: "Cleaning up." },
      quotes: { AAA: 101 },
    });
    expect(result.summary).toContain("PROMOTED");
  });
});

describe("SRRK 09-14: a sale whose label is corrected keeps the analyst's words as its reason", () => {
  // LIVE sells wait for the owner, so the replay stops at the proposal.
  const sell = (call: Record<string, unknown>) =>
    replayTool("close-position", "closePosition", {
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

  it("TARGET at $55.41 is stored MANUAL; the reason is the notes alone; the correction is in the reply and the run's event", async () => {
    const r = await sell(srrk.call);
    expect([r.crashed, r.refused, r.result.data?.status]).toEqual([false, false, "PROPOSED"]);
    expect(orderOf(r)).toMatchObject({ status: "AWAITING_APPROVAL", closeReason: "MANUAL", rationale: srrk.call.notes });
    expect(r.result.data?.rationale).toBe(srrk.call.notes);
    expect(r.result.data).toMatchObject({ declared_reason: "TARGET", label_auto_corrected: true });
    expect(String(r.result.data?.message)).toContain("Sale label auto-corrected TARGET → MANUAL");
    expect(eventOf(r)?.payload).toMatchObject({ reason: "MANUAL", declared_reason: "TARGET", label_auto_corrected: true });
    expect(String(eventOf(r)?.payload.label_note)).toContain("$65.00 target");
  });

  it("a variant: no notes — the reason is empty, not a sentence the app wrote", async () => {
    const r = await sell({ ticker: srrk.call.ticker, reason: srrk.call.reason });
    expect(r.result.data?.status).toBe("PROPOSED");
    expect(orderOf(r).rationale ?? null).toBeNull();
    expect(eventOf(r)?.payload).toMatchObject({ label_auto_corrected: true });
  });
});
