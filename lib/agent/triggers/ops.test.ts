/**
 * ops.test.ts — the per-trigger edit contract (DAV-242).
 *
 * Every trigger change is one op on one trigger: add, edit by id, remove by
 * id, or a plan level (entry / target / stop) as the same op on the slot's
 * trigger. These pin what the replace-all write could never give: a second
 * buy trigger becomes an edit of the first, an edited trigger keeps its id
 * and fired state, a refused op is returned by id while the rest lands, and
 * the sentence moves with the number.
 */

import { applyTriggerOps, checkLadder, describeTrigger } from "./ops";
import type { Trigger } from "./types";

let seq = 0;
const mintId = () => `new-${++seq}`;

const buy: Trigger = {
  id: "buy",
  predicate: { kind: "PRICE_ABOVE", level: 183 },
  action: "ENTER",
  rationale: "Buy level — start the position when the price breaks above $183.00.",
  source: "AGENT",
};
const target: Trigger = {
  id: "target",
  predicate: { kind: "PRICE_ABOVE", level: 250 },
  action: "REVIEW",
  rationale: "Target $250.00 — decide here: take it, trim it, or raise the target.",
  source: "DEFAULT",
};
const floor: Trigger = {
  id: "floor",
  predicate: { kind: "PRICE_BELOW", level: 150 },
  action: "EXIT",
  rationale: "Floor — sell if the price drops to $150.00. Below this the plan is wrong.",
  source: "AGENT",
};
const clock: Trigger = {
  id: "clock",
  predicate: { kind: "REVIEW_CADENCE", days: 7 },
  action: "REVIEW",
  rationale: "Look at this every 7 days, counting from the last real review.",
  source: "AGENT",
};

const watch = (ops: Parameters<typeof applyTriggerOps>[0]["ops"], stored = [buy, target, floor, clock]) =>
  applyTriggerOps({ stored, ops, direction: "LONG", status: "WATCHING", actor: "AGENT", mintId });

beforeEach(() => {
  seq = 0;
});

describe("applyTriggerOps — one trigger per bucket", () => {
  it("a second buy trigger becomes an edit of the first (GD / VST, DAV-231)", () => {
    const out = watch([
      {
        op: "add",
        trigger: {
          id: "",
          predicate: { kind: "PRICE_BELOW", level: 175 },
          action: "ENTER",
          rationale: "Buy the pullback to $175 instead.",
        },
      },
    ]);
    expect(out.results).toEqual([
      { op: "edit", id: "buy", ok: true, text: "Entry $183 → $175" },
    ]);
    const buys = out.triggers.filter((t) => t.action === "ENTER");
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({
      id: "buy",
      predicate: { kind: "PRICE_BELOW", level: 175 },
      rationale: "Buy the pullback to $175 instead.",
    });
  });

  it("a second review cadence becomes an edit of the existing one", () => {
    const out = watch([
      {
        op: "add",
        trigger: {
          id: "",
          predicate: { kind: "REVIEW_CADENCE", days: 14 },
          action: "REVIEW",
          rationale: "Every two weeks is enough here.",
        },
      },
    ]);
    expect(out.results[0]).toMatchObject({ op: "edit", id: "clock", ok: true, text: "Review cadence 7 days → 14 days" });
    expect(out.triggers.filter((t) => t.predicate.kind === "REVIEW_CADENCE")).toHaveLength(1);
  });

  it("a genuinely new trigger is added with a minted id", () => {
    const out = watch([
      {
        op: "add",
        trigger: {
          id: "",
          predicate: { kind: "EARNINGS_BEAT" },
          action: "REVIEW",
          rationale: "A beat re-opens the question.",
        },
      },
    ]);
    expect(out.results[0]).toEqual({ op: "add", id: "new-1", ok: true, text: "Added: Any earnings beat → review" });
    expect(out.triggers.find((t) => t.id === "new-1")?.source).toBe("AGENT");
  });
});

describe("applyTriggerOps — edits", () => {
  it("an agent's level edit without a rationale is refused, by id", () => {
    const out = watch([{ op: "edit", id: "buy", level: 190 }]);
    expect(out.results[0]).toMatchObject({ op: "edit", id: "buy", ok: false, text: "Entry $183 → $190" });
    expect(out.results[0].reason).toMatch(/rationale/);
    expect(out.triggers).toEqual([buy, target, floor, clock]);
  });

  it("the sentence moves with the number (MU's $969 floor said $935 — DAV-231)", () => {
    const out = applyTriggerOps({
      stored: [{ ...floor, predicate: { kind: "PRICE_BELOW", level: 935 }, rationale: "Exit below $935 — the protective line raised on 8/24." }],
      ops: [{ op: "level", slot: "FLOOR", price: 969 }],
      direction: "LONG",
      status: "HOLDING",
      actor: "AGENT",
      mintId,
    });
    expect(out.results[0]).toEqual({ op: "edit", id: "floor", ok: true, text: "Stop $935 → $969 (tightened)" });
    expect(out.triggers[0].rationale).toBe("Exit below $969 — the protective line raised on 8/24.");
  });

  it("fired state survives an edit — the id does not change", () => {
    const fired = { ...buy, lastFiredAt: "2026-09-08T14:00:00.000Z", cooldownDays: 1 };
    const out = watch([{ op: "edit", id: "buy", level: 190, rationale: "Confirmation is above the repair range now." }], [fired, target, floor]);
    const next = out.triggers.find((t) => t.id === "buy")!;
    expect(next.lastFiredAt).toBe("2026-09-08T14:00:00.000Z");
    expect(next.predicate).toEqual({ kind: "PRICE_ABOVE", level: 190 });
    expect(next.rationale).toBe("Confirmation is above the repair range now.");
  });

  it("a level edit on a trigger with a different kind of number is refused", () => {
    const out = watch([{ op: "edit", id: "clock", level: 10, rationale: "x" }]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].reason).toMatch(/no editable `level`/);
  });

  it("an edit that changes nothing is reported as nothing", () => {
    const out = watch([{ op: "edit", id: "buy", level: 183 }]);
    expect(out.results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/Nothing to change/) });
  });

  it("an inherited trigger cannot be edited here — add an override instead", () => {
    const out = applyTriggerOps({
      stored: [floor],
      inherited: [{ id: "acct-trail", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 }, action: "EXIT", rationale: "trail", level: "ACCOUNT", inherited: true }],
      ops: [{ op: "edit", id: "acct-trail", pct: 6, rationale: "tighter" }],
      direction: "LONG",
      status: "HOLDING",
      actor: "AGENT",
      mintId,
    });
    expect(out.results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/account level/) });
  });
});

describe("applyTriggerOps — the ratchet, per op", () => {
  const held = (ops: Parameters<typeof applyTriggerOps>[0]["ops"]) =>
    applyTriggerOps({ stored: [target, floor, clock], ops, direction: "LONG", status: "HOLDING", actor: "AGENT", mintId });

  it("a loosened held stop is refused by itself while the rest lands (SMMT, #612)", () => {
    const out = held([
      { op: "level", slot: "FLOOR", price: 140 },
      { op: "edit", id: "clock", days: 1, rationale: "Daily into the catalyst." },
    ]);
    expect(out.results).toEqual([
      { op: "edit", id: "floor", ok: false, text: "Stop $150 → $140 (loosened)", reason: expect.stringMatching(/weakens the protection/) },
      { op: "edit", id: "clock", ok: true, text: "Review cadence 7 days → 1 days" },
    ]);
    expect(out.triggers.find((t) => t.id === "floor")!.predicate).toEqual({ kind: "PRICE_BELOW", level: 150 });
    expect(out.triggers.find((t) => t.id === "clock")!.predicate).toEqual({ kind: "REVIEW_CADENCE", days: 1 });
  });

  it("removing a protective sell trigger on a held stock is refused", () => {
    const out = held([{ op: "remove", id: "floor" }]);
    expect(out.results[0]).toMatchObject({ op: "remove", id: "floor", ok: false });
    expect(out.triggers).toHaveLength(3);
  });

  it("the principal may lower a held stop — the ratchet is for agents", () => {
    const out = applyTriggerOps({ stored: [target, floor], ops: [{ op: "edit", id: "floor", level: 140 }], direction: "LONG", status: "HOLDING", actor: "PRINCIPAL", mintId });
    expect(out.results[0]).toMatchObject({ ok: true, text: "Stop $150 → $140 (loosened)" });
    expect(out.triggers.find((t) => t.id === "floor")).toMatchObject({ source: "PRINCIPAL", rationale: "Floor — sell if the price drops to $140.00. Below this the plan is wrong." });
  });
});

describe("applyTriggerOps — plan levels as ops", () => {
  it("entry_price with no buy trigger adds one, on the side the tape says", () => {
    const out = applyTriggerOps({
      stored: [target, floor],
      ops: [{ op: "level", slot: "ENTRY", price: 175 }],
      direction: "LONG",
      status: "WATCHING",
      actor: "AGENT",
      currentPrice: 190,
      mintId,
    });
    expect(out.results[0]).toEqual({ op: "add", id: "new-1", ok: true, text: "Entry set: $175" });
    expect(out.triggers.find((t) => t.id === "new-1")).toMatchObject({ action: "ENTER", predicate: { kind: "PRICE_BELOW", level: 175 } });
  });

  it("stop_loss: null removes the floor and says so", () => {
    const out = watch([{ op: "level", slot: "FLOOR", price: null }]);
    expect(out.results[0]).toEqual({ op: "remove", id: "floor", ok: true, text: "Removed: sell below $150" });
    expect(out.triggers.some((t) => t.id === "floor")).toBe(false);
  });

  it("entry on a held stock is the fill, not a plan level", () => {
    const out = applyTriggerOps({ stored: [floor], ops: [{ op: "level", slot: "ENTRY", price: 100 }], direction: "LONG", status: "HOLDING", actor: "AGENT", mintId });
    expect(out.results[0].ok).toBe(false);
    expect(out.triggers).toEqual([floor]);
  });
});

describe("checkLadder — the one check after all ops", () => {
  it("refuses a plan the ops left under 2:1 (ETN 432 / 490 / 355, DAV-241)", () => {
    const out = watch([{ op: "edit", id: "buy", level: 432, rationale: "Confirmation above the repair range." }], [
      buy,
      { ...target, predicate: { kind: "PRICE_ABOVE", level: 490 } },
      { ...floor, predicate: { kind: "PRICE_BELOW", level: 355 } },
    ]);
    const check = checkLadder({ triggers: out.triggers, direction: "LONG", status: "WATCHING" });
    expect(check).toMatchObject({ ok: false, error: "invalid_thesis_shape", message: expect.stringMatching(/R\/R floor/) });
  });

  it("derives the columns from the list when the plan is legal", () => {
    const check = checkLadder({ triggers: [buy, target, floor], direction: "LONG", status: "WATCHING" });
    expect(check).toEqual({ ok: true, columns: { entryPrice: 183, targetPrice: 250, stopLoss: 150 } });
  });

  it("a floor with no buy level is a half plan", () => {
    const check = checkLadder({ triggers: [floor], direction: "LONG", status: "WATCHING" });
    expect(check).toMatchObject({ ok: false, error: "missing_enter_trigger" });
  });

  it("a held stock is satisfied by an inherited sell trigger", () => {
    const check = checkLadder({
      triggers: [clock],
      inherited: [{ id: "acct-trail", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 }, action: "EXIT", rationale: "trail", level: "ACCOUNT", inherited: true }],
      direction: "LONG",
      status: "HOLDING",
      entryPrice: 100,
      avgCost: 100,
    });
    expect(check.ok).toBe(true);
  });
});

describe("describeTrigger", () => {
  it("speaks in plan words for plan levels and plain sentences otherwise", () => {
    expect(describeTrigger(buy, "LONG")).toBe("buy above $183");
    expect(describeTrigger(floor, "LONG")).toBe("sell below $150");
    expect(describeTrigger(clock, "LONG")).toBe("review every 7 days");
    expect(describeTrigger({ ...clock, predicate: { kind: "EARNINGS_BEAT" } }, "LONG")).toBe("Any earnings beat → review");
  });
});
