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
import { replayTool, thesisRow, positionRow, REPLAY_ANALYST_ID } from "@/lib/replay";

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
