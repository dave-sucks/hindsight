/**
 * level-reasons.test.ts — a level carries why it's there (DAV-249). The buy
 * fill's level op (the approved order's stop) writes its reason onto the
 * floor trigger, and a close-only switch is one edit.
 */

import { applyTriggerOps } from "./ops";
import type { Trigger } from "./types";

describe("the buy fill's level op", () => {
  const stored: Trigger[] = [
    { id: "buy", predicate: { watch: "price", is: "above", value: 264.5 }, action: "ENTER", rationale: "Buy above $264.50.", source: "AGENT" },
    { id: "floor", predicate: { watch: "price", is: "below", value: 240 }, action: "EXIT", rationale: "Floor — sell below $240.", source: "AGENT" },
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
    expect(out.triggers.find((t) => t.id === "buy")!.predicate).toEqual({ watch: "price", is: "above", value: 264.5, settings: { close: true } });
  });
});
