/**
 * A buy needs a floor, not a target (2026-11-04). The house sets no target
 * of its own, so the reward/risk floor had nothing of ours to measure: the
 * stored plan the 2:1 rule was written for is legal, and the row's Street
 * line says how much room there is to the Street's average against the
 * floor's distance instead. Fixtures: ETN's and PLTR's real rows as
 * get_theses read them on 2026-11-04 (activity text and history left out).
 */
import etn from "@/lib/agent/__fixtures__/row-etn-2026-11-04.json";
import pltr from "@/lib/agent/__fixtures__/row-pltr-2026-11-04.json";
import { rowForModel } from "@/lib/agent/row-for-model";
import { validateThesisShape } from "@/lib/agent/thesis-shape";
import { checkLadder } from "@/lib/agent/triggers/ops";
import { planTriggers } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Row = Record<string, unknown>;

describe("the plan the 2:1 rule was written for (PLTR as stored, 183 / 190 / 110)", () => {
  it("is legal on every write path: the shape rule and the ladder check both pass it, as the agent", () => {
    expect(validateThesisShape({ direction: "LONG", entryPrice: 183, targetPrice: 190, stopLoss: 110 })).toMatchObject({ ok: true, riskReward: expect.closeTo(0.1, 1) });
    const check = checkLadder({ triggers: planTriggers({ entry: 183, target: 190, stop: 110 }) as unknown as Trigger[], direction: "LONG", status: "WATCHING", actor: "AGENT" });
    expect(check).toEqual({ ok: true, columns: { entryPrice: 183, targetPrice: 190, stopLoss: 110 } });
  });
});

describe("the room to the Street average, on the real rows", () => {
  it("ETN, watched (buy $410, floor $358.50, Street avg $511.57): 2.0× from the buy level, on the street line", () => {
    const short = rowForModel(etn as Row, { named: false, size: "short" }) as Row;
    expect(String(short.street)).toContain("room to the Street average is 2.0× the floor's distance from the buy level");
    expect(String(short.street)).not.toMatch(/\d:1/);
  });

  it("PLTR, held (price $171.92 under its $196 floor): the line says the price is past the floor, no ratio", () => {
    const short = rowForModel(pltr as Row, { named: false, size: "short" }) as Row;
    expect(String(short.street)).toContain("the price is past the floor");
  });
});
