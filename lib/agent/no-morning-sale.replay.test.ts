/**
 * A sale or trim can't be Flag for Review: a sale that waits until tomorrow morning isn't a stop.
 *
 * Production rows (lib/agent/__fixtures__/no-morning-sale-2026-11-14.json): NVDA, held, and its floor
 * "Sell if below $236" (Send to Agent); the account's "Sell if 6% off the high since we bought"; ISRG,
 * watched, and its floor. Each is saved with On fire set to NEXT_MORNING through the path that would
 * take it. On main the owner's saves and an agent's save on the watched stock land; an agent's on the
 * held stock is refused there by the ratchet (an agent may not slow a stop on a stock we own).
 */
import raw from "@/lib/agent/__fixtures__/no-morning-sale-2026-11-14.json";
import { prismaDouble, replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Row = Record<string, unknown> & { id: string; ticker: string; createdAt: string; triggers: Trigger[] };
const fx = raw as unknown as {
  nvda: { thesis: Row; position: { avgCost: number; peakPrice: number; openedAt: string }; floorId: string };
  isrg: { thesis: Row; floorId: string };
  accountRule: Trigger;
};
const NVDA_FLOOR = fx.nvda.thesis.triggers.find((t) => t.id === fx.nvda.floorId)!;
const ISRG_FLOOR = fx.isrg.thesis.triggers.find((t) => t.id === fx.isrg.floorId)!;
const SALE_CANT_WAIT = "A sale can't wait for the morning. Choose Auto-sell or Send to Agent.";
const OWNER = { accountId: REPLAY_ACCOUNT_ID, actorUserId: "owner" };
const SEEDED = new Date("2026-09-01T00:00:00Z");
const nvdaRow = () => thesisRow({ ...fx.nvda.thesis, createdAt: new Date(fx.nvda.thesis.createdAt) });
const nvdaPosition = () => positionRow({ symbol: "NVDA", avgCost: fx.nvda.position.avgCost, peakPrice: fx.nvda.position.peakPrice, openedAt: new Date(fx.nvda.position.openedAt) });

describe("the fixture is the production case", () => {
  it("NVDA's floor and the account's trail are stored sales set to Send to Agent", () => {
    expect(NVDA_FLOOR).toMatchObject({ action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 236 } });
    expect(fx.nvda.thesis.status).toBe("HOLDING");
    expect(fx.accountRule).toMatchObject({ action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "move", is: "below", value: 6, variable: "peak" } });
    expect(ISRG_FLOOR).toMatchObject({ action: "EXIT", fireMode: "ASK_NOW" });
  });
});

describe("the owner's saves (the trigger dialog)", () => {
  it("the thesis sheet refuses NVDA's floor as Flag for Review, and the floor stays Send to Agent (on main: saved)", async () => {
    const db = prismaDouble({
      thesis: [nvdaRow()],
      position: [nvdaPosition()],
      agentConfig: [agentConfigRow()],
      account: [accountRow({ triggersSeededAt: SEEDED })],
    });
    let error: unknown = null;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn(async () => null) }));
      const { applyTriggerReplace } = await import("@/lib/actions/thesis-edit");
      await applyTriggerReplace(fx.nvda.thesis.id, NVDA_FLOOR.id, { action: "EXIT", predicate: NVDA_FLOOR.predicate, fireMode: "NEXT_MORNING" }, OWNER).catch((e) => (error = e));
    });
    expect(error).toMatchObject({ code: "INVALID", message: SALE_CANT_WAIT });
    expect((db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === NVDA_FLOOR.id)?.fireMode).toBe("ASK_NOW");
  });

  it("the account's Triggers tab refuses its trailing sale as Flag for Review (on main: saved)", async () => {
    const db = prismaDouble({ account: [accountRow({ triggers: [fx.accountRule], triggersSeededAt: SEEDED })] });
    let error: unknown = null;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { replaceLevelTrigger } = await import("@/lib/actions/level-triggers");
      await replaceLevelTrigger("ACCOUNT", REPLAY_ACCOUNT_ID, fx.accountRule.id, { action: "EXIT", predicate: fx.accountRule.predicate, fireMode: "NEXT_MORNING" }, OWNER).catch((e) => (error = e));
    });
    expect(error).toMatchObject({ code: "INVALID", message: SALE_CANT_WAIT });
    expect((db.store.account[0].triggers as Trigger[])[0].fireMode).toBe("ASK_NOW");
  });
});

describe("an agent's save (update_thesis)", () => {
  async function flagForMorning(thesis: Record<string, unknown>, floorId: string, position: Record<string, unknown>[]) {
    const { result, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesis], position },
      args: { thesis_id: thesis.id, rationale: "Nothing on the business has changed.", edit_triggers: [{ id: floorId, fire_mode: "NEXT_MORNING" }] },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { [String(thesis.ticker)]: 240 },
    });
    const op = (result.data as { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } | undefined)?.trigger_ops?.find((o) => o.id === floorId);
    const stored = (db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === floorId);
    return { op, stored };
  }

  it("on the held stock: refused because a sale can't wait (on main: refused as slowing the stop)", async () => {
    const { op, stored } = await flagForMorning(nvdaRow(), NVDA_FLOOR.id, [nvdaPosition()]);
    expect(op).toMatchObject({ ok: false, reason: SALE_CANT_WAIT });
    expect(stored?.fireMode).toBe("ASK_NOW");
  });

  it("on the watched stock: refused (on main: saved)", async () => {
    const { op, stored } = await flagForMorning(thesisRow({ ...fx.isrg.thesis, createdAt: new Date(fx.isrg.thesis.createdAt) }), ISRG_FLOOR.id, []);
    expect(op).toMatchObject({ ok: false, reason: SALE_CANT_WAIT });
    expect(stored?.fireMode).toBe("ASK_NOW");
  });
});
