/**
 * IOT's trigger run, 2026-10-15 10:10 ET, proposed 331 shares, then moved
 * the buy to $42.21. The 2:1 check refused it at 1.99 and its text said "set
 * the plan down: remove the buy, floor and target by id"; the run did that,
 * with its own buy waiting. The ratio is not a rule any more (2026-11-04):
 * the move lands, buy waiting or not, and nothing advises a set-down.
 *
 * The verbatim call, with the waiting order seeded, through update_thesis's
 * real entry point.
 *
 * The ratio was one way to be told to set the plan down; the half-plan rule
 * and the shape check were others, and still said "remove the floor and sale
 * triggers" with the buy waiting. They don't now: a waiting buy is the way in.
 */
import { statSync } from "fs";
import fx from "@/lib/agent/__fixtures__/buy-waiting-plan-iot-2026-10-15.json";
import { replayTool, thesisRow, agentConfigRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

const order = (status: string): Row => ({
  ...fx.order, createdAt: new Date(fx.order.createdAt), expiresAt: new Date(fx.order.expiresAt), status,
  userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", symbol: "IOT", orderType: "MARKET", thesisId: fx.thesis.id,
});
const save = (orders: Row[], args: Record<string, unknown> = fx.call) =>
  replayTool("update-thesis", "updateThesis", {
    seed: { agentConfig: [agentConfigRow({ id: fx.run.analystId })], thesis: [thesisRow({ ...fx.thesis, analystId: fx.run.analystId })], order: orders },
    args,
    ctx: { runId: fx.run.id, analystId: fx.run.analystId, runMode: fx.run.mode, runEnvironment: "LIVE" },
    quotes: { IOT: fx.price },
  });
const refusalOf = (data: Row) => ((data.refused_fields as Array<{ field: string; reason: string }>) ?? []).find((f) => f.field === "triggers")?.reason ?? "";

it("the seed is the plan the run saw: floor, target and buy, in the order its refusal listed them", () => {
  expect(fx.thesis.triggers.map((t) => sentenceOf(t as Trigger, false))).toEqual(["Take the plan down if below $39.80", "Review if above $47 · only on the close", "Buy if above $42.15"]);
});

it.each([["waiting", "AWAITING_APPROVAL"], ["filled", "FILLED"]])("IOT 10-15, the buy %s: the move to $42.21 lands at 1.99:1 and nothing advises a set-down", async (_w, status) => {
  const { result, db } = await save([order(status)]);
  expect(refusalOf(result.data!)).toBe("");
  expect(JSON.stringify(result)).not.toMatch(/remove_trigger_ids|set the plan down|\d:1\b/);
  expect((db.store.thesis[0].triggers as Trigger[]).map((t) => sentenceOf(t, false))).toContain("Buy if above $42.21");
});

it("the fixture holds only the fields the save reads, under the cap", () => {
  expect(statSync("lib/agent/__fixtures__/buy-waiting-plan-iot-2026-10-15.json").size).toBeLessThan(10 * 1024);
});

// The run's other move, on the same plan: taking the buy off it, or moving it under the floor.
const BUY = fx.call.trigger_id;
const removeBuy = { thesis_id: fx.thesis.id, remove_trigger_ids: [BUY], rationale: "The buy is spent: it fired and is proposed." };
const buyUnderFloor = { thesis_id: fx.thesis.id, edit_triggers: [{ id: BUY, value: 38, rationale: "Buy lower, under the floor." }] };

describe("IOT 10-15, a buy waiting: no save is advised to take the floor down", () => {
  it("taking the spent buy off the plan lands, and the floor and target stay", async () => {
    const { result, db } = await save([order("AWAITING_APPROVAL")], removeBuy);
    expect(refusalOf(result.data!)).toBe("");
    expect(JSON.stringify(result)).not.toMatch(/remove_trigger_ids|remove the floor|set the plan down/);
    expect((db.store.thesis[0].triggers as Trigger[]).map((t) => sentenceOf(t, false))).toEqual(["Take the plan down if below $39.80", "Review if above $47 · only on the close"]);
  });

  it("a buy moved under the floor is refused, and the refusal says the buy waits and the floor stays", async () => {
    const { result } = await save([order("AWAITING_APPROVAL")], buyUnderFloor);
    const why = refusalOf(result.data!);
    expect(why).toMatch(/A buy is waiting for approval on \$IOT, so its floor and target stay\./);
    expect(why).not.toMatch(/remove_trigger_ids|remove the floor|set the plan down/);
  });

  it("with no buy waiting the refusals are what they were: the set-down is offered", async () => {
    for (const [args, status] of [[removeBuy, "REJECTED"], [removeBuy, "FILLED"], [buyUnderFloor, "EXPIRED"]] as const) {
      const why = refusalOf((await save([order(status)], args)).result.data!);
      expect(why).toMatch(/To set the plan down, remove all of them in one call: remove_trigger_ids/);
    }
  });
});
