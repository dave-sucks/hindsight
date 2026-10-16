/**
 * thesis-edit.reason-follows-level.replay.test.ts — a trigger's reason
 * describes its current level.
 *
 * MU, 2026-10-13 17:48Z (lib/agent/__fixtures__/mu-floor-reason-2026-10-13.json).
 * The floor, trigger t4, stood at $1,005 with the agent's reason for $1,005:
 * "Under the recent flush low zone and beneath the rising 20-day average by
 * roughly 0.7 ATR…". The owner moved it to $1,060 from the stock page. The
 * save kept the id, the fire history and the cooldown, and kept the $1,005
 * sentence too: the replace moved a number only when the old sentence named
 * it, and this one names none. The reason the app sent with the change was
 * dropped. `lastFiredAt` is the 10-12 fire as its tactical run stamps it (the
 * evaluator's own stamp was overwritten by a later fire).
 *
 * The rule: a new number takes the reason sent with it; an owner change with
 * none reads as the trigger in words; an agent's reason is stored as sent.
 */
import raw from "@/lib/agent/__fixtures__/mu-floor-reason-2026-10-13.json";
import { applyTriggerOps, type TriggerOp } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";
import { prismaDouble, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const fx = raw as unknown as {
  thesis: Record<string, unknown> & { id: string; ticker: string };
  avgCost: number;
  before: Trigger[];
  dialog: { action: "EXIT"; predicate: Trigger["predicate"]; fireMode: "TACTICAL" };
  saved: { op: string; rationale: string };
  agent1008: { stop_loss: number; stop_basis: string };
};

const t4Before = fx.before.find((t) => t.id === "t4")!;
/** What the app writes for a trigger the owner sets without a note (written out, so the test pins it). */
const PLAIN = "Sell if below $1060. You set this.";

/** The owner's Save, through the real write path, against MU's rows as they stood. */
async function ownerSave() {
  const db = prismaDouble({
    thesis: [thesisRow({ ...fx.thesis, triggers: fx.before })],
    position: [positionRow({ symbol: fx.thesis.ticker, avgCost: fx.avgCost })],
    agentConfig: [agentConfigRow()],
    account: [accountRow({ triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
  });
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn(async () => null) }));
    const { applyTriggerReplace } = await import("@/lib/actions/thesis-edit");
    await applyTriggerReplace(fx.thesis.id, "t4", fx.dialog, { accountId: REPLAY_ACCOUNT_ID, actorUserId: "owner" });
  });
  const saved = (db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === "t4")!;
  return { saved, audit: db.store.thesisUpdate[0] };
}

const ops = (op: TriggerOp, actor: "AGENT" | "PRINCIPAL") =>
  applyTriggerOps({ stored: fx.before, ops: [op], direction: "LONG", status: "HOLDING", actor, mintId: () => "new" });

describe("MU's floor, $1,005 → $1,060 (2026-10-13)", () => {
  it("the owner's Save stores the reason the app sent for $1,060, not the $1,005 sentence", async () => {
    const { saved, audit } = await ownerSave();
    expect(saved.rationale).toBe(PLAIN);
    // On main: the old sentence stayed, as production stored it.
    expect(saved.rationale).not.toBe(fx.saved.rationale);
    expect(audit.fieldChanges).toMatchObject({ triggerOps: { to: [{ id: "t4", op: "edit", text: fx.saved.op }] } });
  });

  it("keeps the id, the fire history and the cooldown; the floor is saved DIRECT (it sells automatically)", async () => {
    const { saved } = await ownerSave();
    expect(saved).toMatchObject({ id: "t4", predicate: fx.dialog.predicate, lastFiredAt: t4Before.lastFiredAt, cooldownDays: 1, fireMode: "DIRECT", source: "PRINCIPAL" });
  });

  it("an owner change that reaches the op with no reason stores the trigger in words for the new level", () => {
    const out = ops({ op: "replace", id: "t4", trigger: { id: "t4", ...fx.dialog, rationale: "" } }, "PRINCIPAL");
    expect(out.results[0]).toMatchObject({ ok: true, id: "t4" });
    const t4 = out.triggers.find((t) => t.id === "t4")!;
    expect(t4.rationale).toBe(PLAIN);
  });

  it("an agent's change with a reason stores it as sent (unchanged)", () => {
    const { stop_loss, stop_basis } = fx.agent1008;
    const out = ops({ op: "level", slot: "FLOOR", price: stop_loss, rationale: stop_basis }, "AGENT");
    expect(out.results[0]).toMatchObject({ ok: true, id: "t4", text: "Stop $1005 → $1060 (tightened)" });
    expect(out.triggers.find((t) => t.id === "t4")!.rationale).toBe(stop_basis);
  });
});
