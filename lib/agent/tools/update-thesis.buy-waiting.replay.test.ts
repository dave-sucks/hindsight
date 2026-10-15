/**
 * A buy waiting for approval keeps its plan. IOT's trigger run, 2026-10-15
 * 10:10 ET, proposed 331 shares, then moved the buy to $42.21. The 2:1 check
 * refused it at 1.99 and its text said "set the plan down: remove the buy,
 * floor and target by id with remove_trigger_ids". The run did that, with its
 * own buy waiting. The 2:1 rule is unchanged; only its advice is.
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

it("IOT 10-15: the 1.99 refusal names the waiting buy and never advises removing the floor or target", async () => {
  const { result, db } = await save([order("AWAITING_APPROVAL")]);
  const reason = refusalOf(result.data!);
  expect(reason).toMatch(/^R\/R floor: 1\.99:1 is below the mandatory 2:1 minimum/);
  expect(reason).toContain("A buy of 331 shares is waiting for approval, so its plan stays: the floor and target stay as they are.");
  expect(JSON.stringify(result)).not.toMatch(/remove_trigger_ids|set the plan down/);
  // Refused as before: the plan is untouched.
  expect((db.store.thesis[0].triggers as Trigger[]).map((t) => sentenceOf(t, false))).toEqual(fx.thesis.triggers.map((t) => sentenceOf(t as Trigger, false)));
});

it("with no buy waiting the refusal is the one the run got, word for word", async () => {
  expect(refusalOf((await save([order("FILLED")])).result.data!)).toBe(fx.refusedThen);
});

it("the fixture holds only the fields the save reads, under the cap", () => {
  expect(statSync("lib/agent/__fixtures__/buy-waiting-plan-iot-2026-10-15.json").size).toBeLessThan(10 * 1024);
});
