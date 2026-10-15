/**
 * One save, two numbers for one trigger: the plan level wins, the other
 * number comes back in notApplied by the trigger's id, and no reason is
 * stored for a number that did not land.
 *
 *  - PLTR trigger run, 2026-10-15 09:30 ET: edit_triggers asked $191 for the
 *    floor and stop_loss sent $196. The floor stayed $196, but notApplied was
 *    empty, the reply said "Stop: wording updated", and the stop_basis written
 *    for $191 was stored on the $196 trigger.
 *  - MU thesis-writer save, 2026-10-15 10:56 ET: an added $982 buy landed on
 *    the $906 buy and the $906 edit moved it back: "Entry $906 → $982 … Entry
 *    $982 → $906" in Activity, for a buy that never changed.
 *
 * The verbatim calls, through update_thesis's real entry point.
 */
import { statSync } from "fs";
import pltr from "@/lib/agent/__fixtures__/floor-two-prices-pltr-2026-10-15.json";
import mu from "@/lib/agent/__fixtures__/buy-two-prices-mu-2026-10-15.json";
import { replayTool, thesisRow, positionRow, agentConfigRow, type Row } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

type Fx = typeof pltr | typeof mu;
const save = (fx: Fx, extra: Record<string, Row[]> = {}, quote?: number) =>
  replayTool("update-thesis", "updateThesis", {
    seed: { agentConfig: [agentConfigRow({ id: fx.run.analystId })], thesis: [thesisRow({ ...fx.thesis, analystId: fx.run.analystId })], ...extra },
    args: fx.call,
    ctx: { runId: fx.run.id, analystId: fx.run.analystId, runMode: fx.run.mode, runEnvironment: "LIVE" },
    quotes: { [fx.thesis.ticker]: quote ?? 0 },
  });
const triggerOf = (db: { store: Record<string, Row[]> }, id: string) => (db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === id)!;
const auditOf = (db: { store: Record<string, Row[]> }) => db.store.thesisUpdate.at(-1)!.fieldChanges as { triggerOps?: { to: Row[] }; notApplied?: { to: Row[] } };

describe("PLTR 10-15: edit_triggers $191 and stop_loss $196 on the one floor", () => {
  const FLOOR = "21976408-e091-49d6-9411-649feba59fdf";
  const prior = pltr.thesis.triggers.find((t) => t.id === FLOOR)!;

  it("the floor stays $196 with its prior reason, and notApplied names the $191 edit", async () => {
    const position = positionRow({ ...pltr.position, openedAt: new Date(pltr.position.openedAt), symbol: "PLTR", analystId: pltr.run.analystId, environment: "LIVE" });
    const { refused, result, db } = await save(pltr, { position: [position] }, pltr.price);
    expect(refused).toBe(false);

    const floor = triggerOf(db, FLOOR);
    expect(sentenceOf(floor, true)).toBe("Sell if below $196");
    expect(floor.rationale).toBe(prior.rationale);

    const audit = auditOf(db);
    expect(audit.notApplied?.to).toContainEqual(expect.objectContaining({ field: "triggers", id: FLOOR, to: 191, reason: expect.stringMatching(/stop level in the same call sets this trigger to \$196/) }));
    expect((audit.triggerOps?.to ?? []).map((o) => o.id)).not.toContain(FLOOR);
    expect(result.summary).not.toMatch(/Stop: wording updated/);
  });
});

describe("MU 10-15 writer save: a $982 buy added beside entry $906 on the one buy", () => {
  const BUY = "9db623d8-7df0-48bb-b9ce-3968664813ae";
  const prior = mu.thesis.triggers.find((t) => t.id === BUY)!;

  it("the seed is the 10:49 read: each trigger says what it showed", () => {
    expect(mu.thesis.triggers.map((t) => sentenceOf(t as Trigger, false))).toEqual([
      "Buy if above $906", "Buy if within 2% of the 50-day average", "Review if within 14 days before earnings",
      "Review if below $878", "Take the plan down if below $850", "Review if above $1500",
    ]);
  });

  it("the buy stays $906 with its reason, Activity has no line for it, and notApplied names the $982", async () => {
    const { refused, db } = await save(mu, {}, mu.call.price_at_time);
    expect(refused).toBe(false);

    const buy = triggerOf(db, BUY);
    expect(sentenceOf(buy, false)).toBe("Buy if above $906");
    expect(buy.rationale).toBe(prior.rationale);

    const audit = auditOf(db);
    expect((audit.triggerOps?.to ?? []).filter((o) => o.id === BUY)).toEqual([]);
    expect(audit.notApplied?.to).toContainEqual(expect.objectContaining({ field: "triggers", id: BUY, to: 982, reason: expect.stringMatching(/entry level in the same call sets this trigger to \$906/) }));
  });
});

it("the fixtures hold only the fields the save reads, under the cap", () => {
  for (const f of ["floor-two-prices-pltr-2026-10-15.json", "buy-two-prices-mu-2026-10-15.json"]) {
    expect(statSync(`lib/agent/__fixtures__/${f}`).size).toBeLessThan(10 * 1024);
  }
});
