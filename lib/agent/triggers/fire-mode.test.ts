/**
 * On fire: the same three choices on every trigger. The migration writes every stored trigger with the
 * mode it already behaved as; this holds the new routing to the old one over every production row.
 */
import fixture from "./__fixtures__/on-fire-migration-2026-10-22.json";
import { statSync } from "fs";
import { triggerSchema, parseTriggersResilient } from "./schema";
import { applyTriggerDefaults, effectiveCooldownDays } from "./defaults";
import { approvalLine, defaultFireMode, doItTrade, fireModeLabel, fireModeProblem, fireModeWords, waitsForMorning, type FireMode } from "./fire-mode";
import type { Trigger } from "./types";
import { applyTriggerOps, type TriggerOp } from "./ops";

const FIXTURE = "lib/agent/triggers/__fixtures__/on-fire-migration-2026-10-22.json";
type Row = { action: string; was: string | null; watch: string | null; variable: string | null; becomes: FireMode; n: number; live: number };
const rows = (fixture as { rows: Row[] }).rows;

/** Where a fire went before this change: trigger-evaluator.ts and tactical-run.ts on main, 2026-10-21. */
function routeBefore(t: Row, held: boolean, sameDayLook: boolean): string {
  if (t.action === "REVIEW" && !sameDayLook) return "MORNING";
  const eligible = (t.watch === "price" && !t.variable) || (t.watch === "move" && ["prev_close", "close_5d", "close_20d", "entry", "peak"].includes(t.variable ?? ""));
  if (t.was === "DIRECT" && t.action === "EXIT" && eligible && held) return "SELL";
  return "ANALYST";
}

function routeAfter(t: Row, held: boolean, sameDayLook: boolean): string {
  const trigger = { action: t.action, fireMode: t.becomes };
  if (waitsForMorning(trigger, sameDayLook)) return "MORNING";
  return doItTrade(trigger, held) ?? "ANALYST";
}

describe("the migration: every stored trigger fires as it did", () => {
  it("covers all 831 triggers, 142 of them live", () => {
    expect(rows.reduce((s, r) => s + r.n, 0)).toBe(831);
    expect(rows.reduce((s, r) => s + r.live, 0)).toBe(142);
  });

  for (const held of [true, false]) {
    for (const sameDayLook of [false, true]) {
      it(`goes where it went before, ${held ? "held" : "watched"}${sameDayLook ? ", red filing" : ""}`, () => {
        const changed = rows.filter((r) => routeBefore(r, held, sameDayLook) !== routeAfter(r, held, sameDayLook));
        expect(changed).toEqual([]);
      });
    }
  }

  it("the one live DIRECT floor (IOT, $41.42) still sells with no run; a review still waits for the morning", () => {
    const iot = rows.find((r) => r.action === "EXIT" && r.was === "DIRECT" && r.watch === "price" && r.live === 1)!;
    expect(routeAfter(iot, true, false)).toBe("SELL");
    const review = rows.find((r) => r.action === "REVIEW" && r.watch === "repeat" && r.was === "TACTICAL")!;
    expect(routeAfter(review, true, false)).toBe("MORNING");
  });

  it("the fixture is small", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(8 * 1024);
  });
});

describe("a new trigger names none", () => {
  it.each([
    ["EXIT", "DO_IT"],
    ["ENTER", "ASK_NOW"],
    ["ADD", "ASK_NOW"],
    ["TRIM", "ASK_NOW"],
    ["REVIEW", "NEXT_MORNING"],
  ])("%s → %s, written down on save", (action, mode) => {
    expect(defaultFireMode(action)).toBe(mode);
    const [out] = applyTriggerDefaults([{ id: "t", action, predicate: { watch: "price", is: "below", value: 100 }, rationale: "x" } as Trigger]);
    expect(out.fireMode).toBe(mode);
  });

  it("one it names is kept, and a sale's cooldown of 0 with it", () => {
    const [out] = applyTriggerDefaults([{ id: "t", action: "EXIT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "x", cooldownDays: 0, fireMode: "ASK_NOW" }]);
    expect(out).toMatchObject({ fireMode: "ASK_NOW", cooldownDays: 0 });
  });
});

describe("what each mode does", () => {
  it("a review can't be done right away", () => {
    expect(fireModeProblem("REVIEW", "DO_IT")).toMatch(/A review asks the analyst/);
    for (const a of ["ENTER", "ADD", "TRIM", "EXIT"]) expect(fireModeProblem(a, "DO_IT")).toBeNull();
  });

  it("Do it trades only where there is something to trade; otherwise the analyst is asked", () => {
    expect(doItTrade({ action: "EXIT", fireMode: "DO_IT" }, true)).toBe("SELL");
    expect(doItTrade({ action: "TRIM", fireMode: "DO_IT" }, true)).toBe("TRIM");
    expect(doItTrade({ action: "ADD", fireMode: "DO_IT" }, true)).toBe("ADD");
    expect(doItTrade({ action: "ENTER", fireMode: "DO_IT" }, false)).toBe("BUY");
    expect(doItTrade({ action: "ENTER", fireMode: "DO_IT" }, true)).toBeNull();
    expect(doItTrade({ action: "EXIT", fireMode: "DO_IT" }, false)).toBeNull();
    expect(doItTrade({ action: "EXIT", fireMode: "ASK_NOW" }, true)).toBeNull();
  });

  it("a sale left for the morning run asks at most once a day, even with a cooldown of 0", () => {
    const floor: Trigger = { id: "f", action: "EXIT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "x", cooldownDays: 0 };
    expect(effectiveCooldownDays({ ...floor, fireMode: "NEXT_MORNING" })).toBe(1);
    expect(effectiveCooldownDays({ ...floor, fireMode: "DO_IT" })).toBe(0);
  });
});

describe("the words", () => {
  it("the dialog's choices, labelled by action; the pill's line", () => {
    expect(["EXIT", "ENTER", "ADD", "TRIM"].map((a) => fireModeLabel("DO_IT", a))).toEqual(["Sell right away", "Buy right away", "Add right away", "Trim right away"]);
    expect([fireModeLabel("ASK_NOW", "EXIT"), fireModeLabel("NEXT_MORNING", "REVIEW")]).toEqual(["Ask the analyst now", "At the next morning run"]);
    expect(fireModeWords({ action: "TRIM", fireMode: "DO_IT", trimPct: 30 })).toBe("Trims 30% right away");
    expect(fireModeWords({ action: "REVIEW" })).toBe("Waits for the next morning run");
    expect(fireModeWords({ action: "EXIT", fireMode: "DO_IT" }, false)).toBe("Takes the plan down when it fires");
  });

  it("says a trade waits for approval when the switch for its side is on (production: all four on)", () => {
    const on = { requireApprovalBuysLive: true, requireApprovalSellsLive: true, requireApprovalBuysPaper: true, requireApprovalSellsPaper: true };
    expect(approvalLine("EXIT", on)).toBe("Waits for your approval.");
    expect(approvalLine("ENTER", { ...on, requireApprovalBuysPaper: false })).toBe("Waits for your approval on Live.");
    expect(approvalLine("TRIM", { ...on, requireApprovalSellsLive: false, requireApprovalSellsPaper: false })).toBeNull();
    expect(approvalLine("REVIEW", on)).toBeNull();
  });
});

describe("an agent's trigger ops (TRV, watched, 2026-10-22)", () => {
  const floor: Trigger = { id: "aaf8dc78-a969-495d-ab0a-6bb95b55fe66", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 382.4 }, rationale: "Under the support shelf.", cooldownDays: 1 };
  const run = (ops: TriggerOp[]) => applyTriggerOps({ stored: [floor], ops, direction: "LONG", status: "WATCHING", actor: "AGENT", mintId: () => "new" });

  it("a review set to DO_IT is refused by id, and the rest of the call lands", () => {
    const out = run([
      { op: "add", trigger: { id: "", action: "REVIEW", fireMode: "DO_IT", predicate: { watch: "repeat", value: 7 }, rationale: "Weekly." } },
      { op: "edit", id: floor.id, fireMode: "DO_IT" },
    ]);
    expect(Object.fromEntries(out.results.map((r) => [r.op, r.ok]))).toEqual({ add: false, edit: true });
    expect(out.results.find((r) => r.op === "add")?.reason).toMatch(/A review asks the analyst/);
    expect(out.triggers.find((t) => t.id === floor.id)?.fireMode).toBe("DO_IT");
  });

  it("a new action with no mode named takes that action's default", () => {
    const out = run([{ op: "edit", id: floor.id, action: "REVIEW" }]);
    expect(out.results[0]).toMatchObject({ ok: true });
    expect(out.triggers[0]).toMatchObject({ action: "REVIEW", fireMode: "NEXT_MORNING" });
  });
});

describe("reading the stored mode", () => {
  it("the save refuses a mode it doesn't know", () => {
    expect(triggerSchema.safeParse({ predicate: { watch: "price", is: "below", value: 100 }, action: "EXIT", rationale: "x", fireMode: "DIRECT" }).success).toBe(false);
  });

  it("a read keeps the trigger and reads an unknown mode as the action's default, never dropping a floor", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { triggers, dropped } = parseTriggersResilient([{ id: "f", predicate: { watch: "price", is: "below", value: 100 }, action: "EXIT", rationale: "x", fireMode: "TACTICAL" }]);
    err.mockRestore();
    expect(dropped).toBe(0);
    expect(triggers[0].fireMode).toBeUndefined();
  });
});
