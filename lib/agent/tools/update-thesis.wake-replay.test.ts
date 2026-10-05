/**
 * update-thesis.wake-replay.test.ts — on a stock we only watch, with no buy,
 * a review at a price is a wake, not a target (QB ruling on DAV-335,
 * 2026-09-29).
 *
 * VST, the Secular Compounder chat (cmukmqjpv000004jn9yp2c1l0), the evening
 * of 2026-09-27 ET. The composite was 5/10, under the 7 a buy needs, so the
 * chat asked for a review above $145 — the reclaim of the falling 50-day —
 * and no buy. update_thesis refused it five times as a half plan
 * (missing_enter_trigger): a review above the price counted as a target
 * with no buy to reach it from. VST then carried only its 30-day review
 * cadence.
 *
 * The call below is the chat's first, verbatim. It saves; the review is a
 * wake, so the target column stays empty. A sale at a price with no buy is
 * still refused.
 */
import raw from "@/lib/agent/__fixtures__/vst-chat-wake-2026-09-28.json";
import { kindOf } from "@/lib/agent/triggers/condition/__fixtures__/kind-of";
import writerRaw from "@/lib/agent/__fixtures__/vst-writer-refresh-2026-09-28.json";
import type { Trigger } from "@/lib/agent/triggers/types";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const fx = raw as unknown as {
  runId: string;
  args: { thesis_id: string; add_triggers: Array<Record<string, unknown>> } & Record<string, unknown>;
  answer: { error: string };
};
const vst = writerRaw as unknown as {
  currentPrice: number;
  analyst: { setupIds: string[]; minConfidence: number; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  thesisBefore: Record<string, unknown> & { triggers: Trigger[] };
};

/** VST as the chat found it: no plan, only the 30-day review cadence. */
const cadence = vst.thesisBefore.triggers.filter((t) => kindOf(t.predicate) === "REVIEW_CADENCE");
const seed = () => ({
  thesis: [
    thesisRow({
      ...vst.thesisBefore,
      analystId: REPLAY_ANALYST_ID,
      entryPrice: null,
      targetPrice: null,
      stopLoss: null,
      triggers: cadence,
    }),
  ],
  agentConfig: [
    agentConfigRow({ setupIds: vst.analyst.setupIds, minConfidence: vst.analyst.minConfidence, triggers: vst.analyst.triggers }),
  ],
  account: [accountRow({ triggers: vst.account.triggers, triggersSeededAt: new Date(vst.account.triggersSeededAt) })],
});

const call = (args: Record<string, unknown>) =>
  replayTool("update-thesis", "updateThesis", {
    seed: seed(),
    args,
    ctx: { runId: fx.runId, runMode: "PRINCIPAL_CHAT" },
    // The chat read VST "4.4% above its 52-week low of $132.66".
    quotes: { VST: 138.5 },
  });

const rowOf = (r: { db: { store: Record<string, unknown> } }) =>
  (r.db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === fx.args.thesis_id)!;

describe("VST 2026-09-27 — the chat's review above $145, with no buy", () => {
  it("the fixture is the refused call", () => {
    expect(fx.answer.error).toBe("missing_enter_trigger");
    expect(fx.args.add_triggers).toHaveLength(1);
    expect(fx.args.add_triggers[0]).toMatchObject({ action: "REVIEW", predicate: { kind: "PRICE_ABOVE", level: 145 } });
    expect(cadence).toHaveLength(1);
  });

  it("saves the review as a wake: two triggers, no target", async () => {
    const r = await call(fx.args);
    expect(r.refused).toBe(false);
    const row = rowOf(r);
    const now = row.triggers as Trigger[];
    expect(now.map((t) => [t.action, kindOf(t.predicate)])).toEqual([
      ["REVIEW", "REVIEW_CADENCE"],
      ["REVIEW", "PRICE_ABOVE"],
    ]);
    expect(row.entryPrice).toBeNull();
    expect(row.targetPrice).toBeNull();
    expect(row.stopLoss).toBeNull();
  });

  it("the same call as a sale at $145 is still a half plan — refused", async () => {
    const sale = { ...fx.args, add_triggers: [{ ...fx.args.add_triggers[0], action: "EXIT" }] };
    const r = await call(sale);
    expect(r.refused).toBe(true);
    expect(r.refusal?.error).toBe("missing_enter_trigger");
    expect(rowOf(r).triggers).toEqual(cadence);
  });
});
