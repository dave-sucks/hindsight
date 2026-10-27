/**
 * Only the owner makes a buy, add or trim Auto: a one-time order with no agent behind it. The morning run, the
 * writer and the trigger run are refused by id; the owner's chat, acting on his word, lands; an agent may still
 * make a sale Auto (it only speeds up protection). PLTR as held 2026-10-22: its "up 10% in a day" add and floor.
 */
import { replayTool, thesisRow, positionRow } from "@/lib/replay";

const ADD = { id: "1aba586f-cd45-4bbd-82da-d651f1e2802a", action: "ADD", fireMode: "ASK_NOW", source: "AGENT", predicate: { watch: "move", is: "above", value: 10, variable: "prev_close" }, rationale: "Up 10% in a day on a live position: evaluate adding if the move is thesis-confirming.", cooldownDays: 1 };
const FLOOR = { id: "21976408-e091-49d6-9411-649feba59fdf", action: "EXIT", fireMode: "ASK_NOW", source: "AGENT", predicate: { watch: "price", is: "below", value: 196 }, rationale: "The floor stays at $196.", cooldownDays: 1 };

async function setAuto(runMode: string, triggerId: string) {
  const { result, db } = await replayTool("update-thesis", "updateThesis", {
    seed: {
      thesis: [thesisRow({ id: "cmqop233h000n04l57odbcpup", ticker: "PLTR", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", entryPrice: 192.0105, targetPrice: 249.26, stopLoss: 196, triggers: [ADD, FLOOR] })],
      position: [positionRow({ symbol: "PLTR", quantity: 38, avgCost: 192.0105, peakPrice: 210.25 })],
    },
    args: { thesis_id: "cmqop233h000n04l57odbcpup", rationale: "Palantir is holding above $196; nothing on the business has changed.", edit_triggers: [{ id: triggerId, fire_mode: "DO_IT" }] },
    ctx: { runMode },
    quotes: { PLTR: 199.5 },
  });
  const op = (result.data as { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } | undefined)?.trigger_ops?.find((o) => o.id === triggerId);
  const stored = ((db.store.thesis[0] as { triggers: Array<{ id: string; fireMode?: string }> }).triggers ?? []).find((t) => t.id === triggerId);
  return { op, stored };
}

describe("who may make a trigger Auto", () => {
  it.each(["MORNING_PLAN", "THESIS_WRITER", "INTRADAY_TACTICAL"])("%s: an Auto-add is refused by id, and the add keeps asking the agent", async (runMode) => {
    const { op, stored } = await setAuto(runMode, ADD.id);
    expect(op).toMatchObject({ ok: false, reason: "Only the owner can make a buy, add or trim Auto. Use Send to Agent or Flag for Review." });
    expect(stored?.fireMode).toBe("ASK_NOW");
  });

  it("the owner's chat makes it Auto", async () => {
    const { op, stored } = await setAuto("PRINCIPAL_CHAT", ADD.id);
    expect(op).toMatchObject({ ok: true });
    expect(stored?.fireMode).toBe("DO_IT");
  });

  it("a morning run may make the floor an Auto-sell", async () => {
    const { op, stored } = await setAuto("MORNING_PLAN", FLOOR.id);
    expect(op).toMatchObject({ ok: true });
    expect(stored?.fireMode).toBe("DO_IT");
  });
});
