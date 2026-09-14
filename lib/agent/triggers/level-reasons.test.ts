/**
 * level-reasons.test.ts — a level carries why it's there (DAV-249).
 * The writer's stop_basis / target_basis become the floor and target
 * triggers' sentences; entry_on_close makes the buy a close-only level.
 */

import { applyLevelArgs } from "./price-levels";
import { applyTriggerOps } from "./ops";
import type { Trigger } from "./types";

const mint = (extra: Partial<Parameters<typeof applyLevelArgs>[0]> = {}) =>
  applyLevelArgs({
    stored: [],
    levels: { entry: 264.5, floor: 240, target: 320 },
    direction: "LONG",
    status: "WATCHING",
    currentPrice: 254.07,
    mintId: (() => { let n = 0; return () => `t${++n}`; })(),
    ...extra,
  }).triggers;

describe("record_thesis path — applyLevelArgs", () => {
  it("the stop and target reasons become their triggers' sentences", () => {
    const t = mint({ notes: { floor: "under the base low $228.77, 2.3 ATR", target: "measured move: 13.3% base depth added to the pivot" } });
    expect(t.find((x) => x.action === "EXIT")!.rationale).toBe("under the base low $228.77, 2.3 ATR");
    expect(t.find((x) => x.action === "REVIEW" && x.predicate.kind === "PRICE_ABOVE")!.rationale).toBe("measured move: 13.3% base depth added to the pivot");
  });

  it("entry_on_close makes the buy fire on the close only", () => {
    const t = mint({ entryBasis: "close" });
    expect(t.find((x) => x.action === "ENTER")!.predicate).toEqual({ kind: "PRICE_ABOVE", level: 264.5, basis: "close" });
  });

  it("without reasons the template sentences stay", () => {
    const t = mint();
    expect(t.find((x) => x.action === "EXIT")!.rationale).toMatch(/\$240/);
  });
});

describe("update_thesis path — the level op", () => {
  const stored: Trigger[] = [
    { id: "buy", predicate: { kind: "PRICE_ABOVE", level: 264.5 }, action: "ENTER", rationale: "Buy above $264.50.", source: "AGENT" },
    { id: "floor", predicate: { kind: "PRICE_BELOW", level: 240 }, action: "EXIT", rationale: "Floor — sell below $240.", source: "AGENT" },
  ];
  const run = (ops: Parameters<typeof applyTriggerOps>[0]["ops"]) =>
    applyTriggerOps({ stored, ops, direction: "LONG", status: "WATCHING", actor: "AGENT", currentPrice: 254, mintId: () => "new" });

  it("moving the floor with a reason writes the reason, not a template", () => {
    const out = run([{ op: "level", slot: "FLOOR", price: 242, rationale: "under the last contraction low $243.10, 2.1 ATR" }]);
    expect(out.triggers.find((t) => t.id === "floor")!.rationale).toBe("under the last contraction low $243.10, 2.1 ATR");
  });

  it("switching the buy to close-only at the same level is one edit", () => {
    const out = run([{ op: "level", slot: "ENTRY", price: 264.5, basis: "close" }]);
    expect(out.results[0]).toMatchObject({ ok: true, text: "Entry: fires on the close" });
    expect(out.triggers.find((t) => t.id === "buy")!.predicate).toEqual({ kind: "PRICE_ABOVE", level: 264.5, basis: "close" });
  });
});
