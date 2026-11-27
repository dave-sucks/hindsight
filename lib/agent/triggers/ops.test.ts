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

import type { Condition } from "@/lib/agent/triggers/condition";
import { applyTriggerOps, checkLadder, describeTrigger } from "./ops";
import type { Trigger } from "./types";

let seq = 0;
const mintId = () => `new-${++seq}`;

const buy: Trigger = {
  id: "buy",
  predicate: { watch: "price", is: "above", value: 183 },
  action: "ENTER",
  rationale: "Buy level — start the position when the price breaks above $183.00.",
  source: "AGENT",
};
const target: Trigger = {
  id: "target",
  predicate: { watch: "price", is: "above", value: 250 },
  action: "REVIEW",
  rationale: "Target $250.00 — decide here: take it, trim it, or raise the target.",
  source: "DEFAULT",
};
const floor: Trigger = {
  id: "floor",
  predicate: { watch: "price", is: "below", value: 150 },
  action: "EXIT",
  rationale: "Floor — sell if the price drops to $150.00. Below this the plan is wrong.",
  source: "AGENT",
};
/** The same line on a stock we only watch: its own action. */
const stopLine: Trigger = { ...floor, action: "STOP_WATCHING", rationale: "Below $150.00 the setup is wrong, so I stop watching it." };
const clock: Trigger = {
  id: "clock",
  predicate: { watch: "repeat", value: 7 },
  action: "REVIEW",
  rationale: "Look at this every 7 days, counting from the last real review.",
  source: "AGENT",
};

const watch = (ops: Parameters<typeof applyTriggerOps>[0]["ops"], stored = [buy, target, stopLine, clock]) =>
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
          predicate: { watch: "price", is: "below", value: 175 },
          action: "ENTER",
          rationale: "Buy the pullback to $175 instead.",
        },
      },
    ]);
    expect(out.results).toEqual([
      { op: "edit", id: "buy", ok: true, text: "Buy $183 → $175", saved: "Buy if below $175 — Buy the pullback to $175 instead." },
    ]);
    const buys = out.triggers.filter((t) => t.action === "ENTER");
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({
      id: "buy",
      predicate: { watch: "price", is: "below", value: 175 },
      rationale: "Buy the pullback to $175 instead.",
    });
  });

  it("a second review cadence becomes an edit of the existing one", () => {
    const out = watch([
      {
        op: "add",
        trigger: {
          id: "",
          predicate: { watch: "repeat", value: 14 },
          action: "REVIEW",
          rationale: "Every two weeks is enough here.",
        },
      },
    ]);
    expect(out.results[0]).toMatchObject({ op: "edit", id: "clock", ok: true, text: "Review cadence 7 days → 14 days" });
    expect(out.triggers.filter((t) => (t.predicate as Condition).watch === "repeat")).toHaveLength(1);
  });

  it("a genuinely new trigger is added with a minted id", () => {
    const out = watch([
      {
        op: "add",
        trigger: {
          id: "",
          predicate: { watch: "surprise", is: "beat", value: 0 },
          action: "REVIEW",
          rationale: "A beat re-opens the question.",
        },
      },
    ]);
    expect(out.results[0]).toEqual({ op: "add", id: "new-1", ok: true, text: "Added: Review if earnings beat any amount", saved: "Review if earnings beat any amount — A beat re-opens the question." });
    expect(out.triggers.find((t) => t.id === "new-1")?.source).toBe("AGENT");
  });
});

describe("applyTriggerOps — edits", () => {
  it("an agent's level edit without a rationale is refused, by id", () => {
    const out = watch([{ op: "edit", id: "buy", value: 190 }]);
    expect(out.results[0]).toMatchObject({ op: "edit", id: "buy", ok: false, text: "Buy $183 → $190" });
    expect(out.results[0].reason).toMatch(/rationale/);
    expect(out.triggers).toEqual([buy, target, stopLine, clock]);
  });

  it("the sentence moves with the number on a fill's level op (MU's $969 floor said $935 — DAV-231)", () => {
    const out = applyTriggerOps({
      stored: [{ ...floor, predicate: { watch: "price", is: "below", value: 935 }, rationale: "Exit below $935 — the protective line raised on 8/24." }],
      ops: [{ op: "level", slot: "FLOOR", price: 969 }],
      direction: "LONG",
      status: "HOLDING",
      actor: "SYSTEM",
      mintId,
    });
    expect(out.results[0]).toEqual({ op: "edit", id: "floor", ok: true, text: "Stop $935 → $969 (tightened)", saved: "Sell if below $969 — Exit below $969 — the protective line raised on 8/24." });
    expect(out.triggers[0].rationale).toBe("Exit below $969 — the protective line raised on 8/24.");
  });

  it("an edit keeps the id; a new number is a new trigger to fire, so its fire state starts fresh", () => {
    const fired = { ...buy, lastFiredAt: "2026-09-08T14:00:00.000Z", falseAtCloseAt: "2026-09-07T20:20:00.000Z" };
    const out = watch([{ op: "edit", id: "buy", value: 190, rationale: "Confirmation is above the repair range now." }], [fired, target, floor]);
    const next = out.triggers.find((t) => t.id === "buy")!;
    expect(next.lastFiredAt).toBeUndefined();
    expect(next.falseAtCloseAt).toBeUndefined();
    expect(next.predicate).toEqual({ watch: "price", is: "above", value: 190 });
    expect(next.rationale).toBe("Confirmation is above the repair range now.");
  });

  it("an edit that changes only how it fires keeps its fire state", () => {
    const fired = { ...buy, lastFiredAt: "2026-09-08T14:00:00.000Z" };
    const out = watch([{ op: "edit", id: "buy", fireMode: "NEXT_MORNING" }], [fired, target, floor]);
    expect(out.triggers.find((t) => t.id === "buy")!.lastFiredAt).toBe("2026-09-08T14:00:00.000Z");
  });

  it("a level edit on a trigger with a different kind of number is refused", () => {
    const out = watch([{ op: "edit", id: "clock", value: 10, unit: "level", rationale: "x" }]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].reason).toMatch(/no editable `level`/);
  });

  it("a value edit is in the trigger's own unit: on the review clock it is the days", () => {
    const out = watch([{ op: "edit", id: "clock", value: 10, rationale: "x" }]);
    expect(out.results[0].ok).toBe(true);
    expect(out.results[0].text).toBe("Review cadence 7 days → 10 days");
  });

  it("an edit that changes nothing is reported as nothing", () => {
    const out = watch([{ op: "edit", id: "buy", value: 183 }]);
    expect(out.results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/Nothing to change/) });
  });

  it("an inherited trigger cannot be edited here — add an override instead", () => {
    const out = applyTriggerOps({
      stored: [floor],
      inherited: [{ id: "acct-trail", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, action: "EXIT", rationale: "trail", level: "ACCOUNT", inherited: true }],
      ops: [{ op: "edit", id: "acct-trail", value: 6, rationale: "tighter" }],
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
      { op: "edit", id: "floor", value: 140, rationale: "Wider, under the base." },
      { op: "edit", id: "clock", value: 1, rationale: "Daily into the catalyst." },
    ]);
    expect(out.results).toEqual([
      { op: "edit", id: "floor", ok: false, text: "Stop $150 → $140 (loosened)", reason: expect.stringMatching(/weakens the protection/), to: 140 },
      { op: "edit", id: "clock", ok: true, text: "Review cadence 7 days → 1 days", saved: "Review every 1 day — Daily into the catalyst." },
    ]);
    expect(out.triggers.find((t) => t.id === "floor")!.predicate).toEqual({ watch: "price", is: "below", value: 150 });
    expect(out.triggers.find((t) => t.id === "clock")!.predicate).toEqual({ watch: "repeat", value: 1 });
  });

  it("removing a protective sell trigger on a held stock is refused", () => {
    const out = held([{ op: "remove", id: "floor" }]);
    expect(out.results[0]).toMatchObject({ op: "remove", id: "floor", ok: false });
    expect(out.triggers).toHaveLength(3);
  });

  it("the principal may lower a held stop — the ratchet is for agents", () => {
    const out = applyTriggerOps({ stored: [target, floor], ops: [{ op: "edit", id: "floor", value: 140 }], direction: "LONG", status: "HOLDING", actor: "PRINCIPAL", mintId });
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
    expect(out.results[0]).toEqual({ op: "add", id: "new-1", ok: true, text: "Buy set: $175", saved: "Buy if below $175 — I buy when it comes back down to $175.00." });
    expect(out.triggers.find((t) => t.id === "new-1")).toMatchObject({ action: "ENTER", predicate: { watch: "price", is: "below", value: 175 } });
  });

  it("entry on a held stock is the fill, not a plan level", () => {
    const out = applyTriggerOps({ stored: [floor], ops: [{ op: "level", slot: "ENTRY", price: 100 }], direction: "LONG", status: "HOLDING", actor: "AGENT", mintId });
    expect(out.results[0].ok).toBe(false);
    expect(out.triggers).toEqual([floor]);
  });
});

describe("applyTriggerOps — a removal and its replacement in one call", () => {
  // Deletions apply before writes. In the order sent, a new trigger landed
  // on the one it replaced (one per bucket made it an edit) and the removal
  // deleted both: eight saves 09-15 → 09-28. VST's is replayed through
  // update_thesis in update-thesis.replace-trigger-replay.test.ts.

  it("HPE 2026-09-15: the writer's new buy at $57.25 replaces the $58.50 one instead of being deleted with it", () => {
    // Writer run cmu30r2u20002sky7xsjj9m2u, ids from its audit row. The
    // call's three edits touched other triggers and are left out. On main
    // the save read "Entry $58.50 → $57.25 … Removed: buy above $57.25" and
    // HPE was left with no buy.
    const hpe: Trigger[] = [
      { id: "eb59bfe1", predicate: { watch: "price", is: "above", value: 58.5 }, action: "ENTER", rationale: "Buy above $58.50.", source: "AGENT" },
      // Stored as a sale until the 2026-11-16 migration made it the Stop watching line it was.
      { id: "0127a7f6", predicate: { watch: "price", is: "below", value: 54.9 }, action: "STOP_WATCHING", rationale: "Floor $54.90.", source: "AGENT" },
      { id: "d5dc23fd", predicate: { watch: "price", is: "above", value: 66.5 }, action: "REVIEW", rationale: "Target $66.50.", source: "AGENT" },
    ];
    const out = watch(
      [
        { op: "add", trigger: { id: "", predicate: { watch: "price", is: "above", value: 57.25 }, action: "ENTER", rationale: "Buy the reclaim of $57.25." } },
        { op: "remove", id: "eb59bfe1" },
        { op: "remove", id: "0127a7f6" },
        { op: "remove", id: "d5dc23fd" },
      ],
      hpe,
    );
    // Its Stop watching line stays: an agent can't take one off (the owner, 2026-11-25). The rest lands.
    expect(out.results).toEqual([
      { op: "remove", id: "eb59bfe1", ok: true, text: "Removed: Buy if above $58.50" },
      expect.objectContaining({ op: "remove", id: "0127a7f6", ok: false, reason: expect.stringContaining("A Stop watching line only tightens") }),
      { op: "remove", id: "d5dc23fd", ok: true, text: "Removed: Review if above $66.50" },
      { op: "add", id: "new-1", ok: true, text: "Added: Buy if above $57.25", saved: "Buy if above $57.25 — Buy the reclaim of $57.25." },
    ]);
    expect(out.triggers.map((t) => t.id).sort()).toEqual(["0127a7f6", "new-1"]);
    expect(out.triggers).toContainEqual(expect.objectContaining({ id: "new-1", action: "ENTER", predicate: { watch: "price", is: "above", value: 57.25 } }));
  });

  it("an edit of a trigger the same call removes lands neither; it comes back by id — say which — and the rest lands", () => {
    const out = watch([
      { op: "edit", id: "clock", value: 14, rationale: "Every two weeks until the print." },
      { op: "remove", id: "clock" },
      { op: "remove", id: "floor" },
    ]);
    expect(out.results).toEqual([
      {
        op: "edit",
        id: "clock",
        ok: false,
        text: "Edit and remove: Review every 7 days",
        reason: "Edited and removed in the same call — say which: send the edit or the removal, not both.",
      },
      expect.objectContaining({ op: "remove", id: "floor", ok: false, reason: expect.stringContaining("A Stop watching line only tightens") }),
    ]);
    expect(out.triggers.find((t) => t.id === "clock")).toEqual(expect.objectContaining({ predicate: { watch: "repeat", value: 7 } }));
  });

  it("on a stock we own the removal is refused, so the replacement edits the floor that stays — and may only tighten", () => {
    const held = (level: number) =>
      applyTriggerOps({
        stored: [target, floor, clock],
        ops: [
          { op: "add", trigger: { id: "", predicate: { watch: "price", is: "below", value: level }, action: "EXIT", rationale: `Floor — sell below $${level}.` } },
          { op: "remove", id: "floor" },
        ],
        direction: "LONG",
        status: "HOLDING",
        actor: "AGENT",
        mintId,
      });
    const looser = held(140);
    expect(looser.results.map((r) => [r.op, r.ok])).toEqual([["remove", false], ["edit", false]]);
    expect(looser.triggers.find((t) => t.id === "floor")!.predicate).toEqual({ watch: "price", is: "below", value: 150 });

    const tighter = held(155);
    expect(tighter.results.map((r) => [r.op, r.ok, r.text])).toEqual([
      ["remove", false, "Removed: Sell if below $150"],
      ["edit", true, "Stop $150 → $155 (tightened)"],
    ]);
    expect(tighter.triggers.find((t) => t.id === "floor")!.predicate).toEqual({ watch: "price", is: "below", value: 155 });
  });
});

describe("checkLadder — the one check after all ops", () => {
  it("accepts a plan the ops leave under 2:1 (ETN 432 / 490 / 355): the ratio is not a rule", () => {
    const out = watch([{ op: "edit", id: "buy", value: 432, rationale: "Confirmation above the repair range." }], [
      buy,
      { ...target, predicate: { watch: "price", is: "above", value: 490 } },
      { ...stopLine, predicate: { watch: "price", is: "below", value: 355 } },
    ]);
    const check = checkLadder({ triggers: out.triggers, direction: "LONG", status: "WATCHING", actor: "AGENT" });
    expect(check).toEqual({ ok: true });
  });

  it("no order of a buy, floor and upside line is checked: each trigger means what it says (2026-11-16)", () => {
    const under: Trigger[] = [buy, { ...target, predicate: { watch: "price", is: "above", value: 490 } }, { ...stopLine, predicate: { watch: "price", is: "below", value: 355 } }];
    const moved = applyTriggerOps({ stored: under, ops: [{ op: "edit", id: "buy", value: 432 }], direction: "LONG", status: "WATCHING", actor: "PRINCIPAL", mintId });
    expect(checkLadder({ triggers: moved.triggers, direction: "LONG", status: "WATCHING", actor: "PRINCIPAL" }).ok).toBe(true);
    const crossed = applyTriggerOps({ stored: under, ops: [{ op: "edit", id: "floor", value: 400 }], direction: "LONG", status: "WATCHING", actor: "PRINCIPAL", mintId });
    expect(checkLadder({ triggers: crossed.triggers, direction: "LONG", status: "WATCHING", actor: "PRINCIPAL" })).toEqual({ ok: true });
  });

  it("passes a legal list, and hands back no level of its own (nothing stores one)", () => {
    const check = checkLadder({ triggers: [buy, target, stopLine], direction: "LONG", status: "WATCHING", actor: "AGENT" });
    expect(check).toEqual({ ok: true });
  });

  it("a Stop watching line with no buy is a watch, not a half plan", () => {
    const check = checkLadder({ triggers: [stopLine], direction: "LONG", status: "WATCHING", actor: "AGENT" });
    expect(check).toEqual({ ok: true });
  });

  it("a held stock is satisfied by an inherited sell trigger", () => {
    const check = checkLadder({
      triggers: [clock],
      inherited: [{ id: "acct-trail", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, action: "EXIT", rationale: "trail", level: "ACCOUNT", inherited: true }],
      direction: "LONG",
      status: "HOLDING",
      actor: "AGENT",
    });
    expect(check.ok).toBe(true);
  });
});

describe("describeTrigger", () => {
  it("says a trigger the way the pill does", () => {
    expect(describeTrigger(buy)).toBe("Buy if above $183");
    expect(describeTrigger(floor)).toBe("Sell if below $150");
    expect(describeTrigger({ ...floor, action: "STOP_WATCHING" })).toBe("Stop watching if below $150");
    expect(describeTrigger(clock)).toBe("Review every 7 days");
    expect(describeTrigger({ ...clock, predicate: { watch: "surprise", is: "beat", value: 0 } })).toBe("Review if earnings beat any amount");
  });
});

describe("applyTriggerOps — a watch's Stop watching line only tightens (the owner, 2026-11-25)", () => {
  // Nov 19: the watch rewrite's Writer runs took the line off ETN and BWXT, and a
  // Writer lowered CGEM's from $12.77 to $8.47; the watches stayed on after
  // breaking their own lines.
  const line = (value: number, extra: Partial<Trigger> = {}): Trigger => ({ ...stopLine, predicate: { watch: "price", is: "below", value, settings: { close: true } }, ...extra });
  const onWatch = (ops: Parameters<typeof applyTriggerOps>[0]["ops"], actor: "AGENT" | "PRINCIPAL" | "SYSTEM" = "AGENT") =>
    applyTriggerOps({ stored: [buy, line(150), clock], ops, direction: "LONG", status: "WATCHING", actor, mintId });

  it("an agent can't take it off while the stock keeps a buy", () => {
    const out = onWatch([{ op: "remove", id: "floor" }]);
    expect(out.results).toEqual([expect.objectContaining({ op: "remove", id: "floor", ok: false, reason: expect.stringContaining("comes off only with the stock's buy") })]);
    expect(out.triggers.some((t) => t.action === "STOP_WATCHING")).toBe(true);
  });

  it("it comes off with the buy, in either order, as the Writer takes both off when there is no price worth waiting for", () => {
    for (const ops of [[{ op: "remove", id: "floor" }, { op: "remove", id: "buy" }], [{ op: "remove", id: "buy" }, { op: "remove", id: "floor" }]] as const) {
      const out = onWatch([...ops]);
      expect(out.results.every((r) => r.ok)).toBe(true);
      expect(out.triggers.map((t) => t.id)).toEqual(["clock"]);
    }
    // A new buy in the same call is a buy that stays.
    const swapped = onWatch([{ op: "remove", id: "floor" }, { op: "remove", id: "buy" }, { op: "add", trigger: { ...buy, id: "", rationale: "A new buy." } }]);
    expect(swapped.results.find((r) => r.id === "floor")).toEqual(expect.objectContaining({ ok: false }));
  });

  it("each line is followed by its id: a second line of the kind on an old row is guarded too", () => {
    const out = applyTriggerOps({ stored: [buy, line(150), line(140, { id: "floor-2" })], ops: [{ op: "remove", id: "floor-2" }], direction: "LONG", status: "WATCHING", actor: "AGENT", mintId });
    expect(out.results[0]).toEqual(expect.objectContaining({ id: "floor-2", ok: false }));
    expect(out.triggers.map((t) => t.id)).toContain("floor-2");
  });

  it("a two-condition line can't be loosened in one of its parts, and tightens in either (BWXT's 'down 5% on the day on 1.5× volume')", () => {
    const pair: Trigger = { ...stopLine, id: "pair", predicate: { match: "all", conditions: [{ watch: "move", is: "below", value: 5, variable: "day" }, { watch: "volume", is: "above", value: 1.5 }] } as never };
    const edit = (value: number, part: number) => applyTriggerOps({ stored: [buy, pair], ops: [{ op: "edit", id: "pair", value, part, rationale: "Moved." }], direction: "LONG", status: "WATCHING", actor: "AGENT", mintId });
    expect(edit(50, 1).results[0]).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("loosens it") }));
    expect(edit(8, 0).results[0]).toEqual(expect.objectContaining({ ok: false }));
    expect(edit(1.2, 1).results[0]).toEqual(expect.objectContaining({ ok: true }));
  });

  it("an agent can't lower it, and can raise it", () => {
    const lower = onWatch([{ op: "edit", id: "floor", value: 120, rationale: "Room to breathe." }]);
    expect(lower.results[0]).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("loosens it") }));
    expect(lower.triggers.find((t) => t.id === "floor")!.predicate).toEqual(expect.objectContaining({ value: 150 }));
    const higher = onWatch([{ op: "edit", id: "floor", value: 160, rationale: "The base low moved up." }]);
    expect(higher.results[0]).toEqual(expect.objectContaining({ ok: true }));
    expect(higher.triggers.find((t) => t.id === "floor")!.predicate).toEqual(expect.objectContaining({ value: 160 }));
  });

  it("moving it to another measure is a removal and an add: the removal is refused, so the old line stays beside the new one (WST, Nov 19)", () => {
    const out = onWatch([
      { op: "remove", id: "floor" },
      { op: "add", trigger: { id: "", predicate: { watch: "price", is: "below", variable: "sma200", settings: { close: true } }, action: "STOP_WATCHING", rationale: "Below the 200-day instead." } },
    ]);
    expect(out.results.map((r) => [r.op, r.ok])).toEqual([["remove", false], ["add", true]]);
    expect(out.triggers.filter((t) => t.action === "STOP_WATCHING")).toHaveLength(2);
  });

  it("a window before the event only opens earlier: 21 days before can become 30, never 10; and a line can't start waiting for the close", () => {
    const dated = (value: number): Trigger => ({ ...stopLine, id: "dated", predicate: { watch: "from_date", variable: "event", is: "before", value } });
    const run = (value: number) => applyTriggerOps({ stored: [dated(21)], ops: [{ op: "edit", id: "dated", value, rationale: "Moved." }], direction: "LONG", status: "WATCHING", actor: "AGENT", mintId });
    expect(run(10).results[0]).toEqual(expect.objectContaining({ ok: false }));
    expect(run(30).results[0]).toEqual(expect.objectContaining({ ok: true }));
    const intraday = { ...stopLine, predicate: { watch: "price", is: "below", value: 150 } } as Trigger;
    const later = applyTriggerOps({ stored: [intraday], ops: [{ op: "edit", id: "floor", close: true, rationale: "On the close." } as never], direction: "LONG", status: "WATCHING", actor: "AGENT", mintId });
    expect(later.results[0]).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("loosens it") }));
    expect(later.triggers.find((t) => t.id === "floor")!.predicate).toEqual({ watch: "price", is: "below", value: 150 });
  });

  it("the owner can take it off or lower it; the app's own lines are not an agent's", () => {
    expect(onWatch([{ op: "remove", id: "floor" }], "PRINCIPAL").results[0]).toEqual(expect.objectContaining({ ok: true }));
    expect(onWatch([{ op: "edit", id: "floor", value: 120, rationale: "Wider." }], "PRINCIPAL").results[0]).toEqual(expect.objectContaining({ ok: true }));
    expect(onWatch([{ op: "remove", id: "floor" }], "SYSTEM").results[0]).toEqual(expect.objectContaining({ ok: true }));
  });
});
