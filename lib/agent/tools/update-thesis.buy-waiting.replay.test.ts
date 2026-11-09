/**
 * IOT's trigger run, 2026-10-15 10:10 ET, proposed 331 shares, then moved
 * the buy to $42.21. The 2:1 check refused it at 1.99 and its text said "set
 * the plan down: remove the buy, floor and target by id"; the run did that,
 * with its own buy waiting. The ratio is not a rule any more (2026-11-04):
 * the move lands, buy waiting or not, and nothing advises a set-down.
 *
 * The verbatim call, with the waiting order seeded, through update_thesis's
 * real entry point.
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
const save = (orders: Row[]) =>
  replayTool("update-thesis", "updateThesis", {
    seed: { agentConfig: [agentConfigRow({ id: fx.run.analystId })], thesis: [thesisRow({ ...fx.thesis, analystId: fx.run.analystId })], order: orders },
    args: fx.call,
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
