/**
 * defaults.test.ts — verifies the P1-3 fix.
 *
 * Pre-fix: watchingEntryTrigger read `thesis.targetPrice` and emitted
 * PRICE_ABOVE(targetPrice) → ENTER. Since `targetPrice` was the
 * take-profit level when the thesis went ACTIVE, the default ENTER
 * fired at the same level as the take-profit EXIT — buying at the sell
 * level. Production bug: MDB 2026-05-25.
 *
 * Post-fix: watchingEntryTrigger reads `thesis.entryPrice` (the writer's
 * actual entry intent). targetPrice is reserved exclusively for the
 * take-profit semantic on ACTIVE rows.
 *
 * These tests pin the behavior so the fix can't quietly regress.
 *
 * See docs/plans/PRICE_LEVEL_SEMANTICS.md.
 */

import {
  applyTriggerCooldownDefaults,
  defaultTriggersForHorizon,
  type ThesisShape,
} from "./defaults";
import type { Trigger } from "./types";

function base(overrides: Partial<ThesisShape> = {}): ThesisShape {
  return {
    entryPrice: 175,
    targetPrice: 240,
    stopLoss: 168,
    direction: "LONG",
    ...overrides,
  };
}

describe("defaultTriggersForHorizon — WATCHING ENTER trigger (P1-3 fix)", () => {
  it("LONG WATCHING TARGET — ENTER fires at entryPrice, NOT targetPrice", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeDefined();
    expect(enter!.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 }); // entryPrice
    expect(enter!.predicate).not.toEqual({ kind: "PRICE_ABOVE", level: 240 }); // NOT targetPrice
  });

  it("LONG WATCHING TRADE — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("TRADE", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("LONG WATCHING COMPOUNDER — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("COMPOUNDER", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("LONG WATCHING CATALYST (catalyst far out) — ENTER fires at entryPrice", () => {
    // CATALYST defaults to event-based ENTER (EARNINGS_BEAT) when
    // catalystDate is within 7 days. With catalystDate further out,
    // falls back to the standard breakout-entry default.
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const triggers = defaultTriggersForHorizon(
      "CATALYST",
      base({ catalystDate: farFuture }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("SHORT WATCHING — ENTER fires PRICE_BELOW(entryPrice), direction-aware", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      base({ direction: "SHORT", entryPrice: 175, targetPrice: 110, stopLoss: 195 }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_BELOW", level: 175 });
  });

  it("PROMOTED reuses WATCHING templates — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "PROMOTED");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("no ENTER trigger when entryPrice is null (writer wants 'buy now via no-trigger')", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      base({ entryPrice: null }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeUndefined();
  });

  it("targetPrice still drives EXIT/REVIEW triggers on ACTIVE side (unchanged)", () => {
    // The fix is scoped to WATCHING. On the HELD/ACTIVE side, targetPrice
    // remains the take-profit level driving exit-side triggers — that's
    // its correct meaning.
    const triggers = defaultTriggersForHorizon("TARGET", base(), "HELD");
    const targetTrigger = triggers.find(
      (t) =>
        t.predicate.kind === "PRICE_ABOVE" &&
        "level" in t.predicate &&
        t.predicate.level === 240,
    );
    expect(targetTrigger).toBeDefined();
    // It's a take-profit REVIEW (or EXIT depending on horizon), NOT an ENTER.
    expect(targetTrigger!.action).not.toBe("ENTER");
  });
});

/**
 * 2026-06-02 NVDA runaway — the agent stamped `cooldownDays: 0` on a
 * TIME_ELAPSED 14d REVIEW via `update_thesis`. The old `!= null` check
 * walked past the 0 and the trigger evaluator fired 15 times in 70 min
 * before manual hotfix. These tests pin the new rule: on non-EXIT
 * actions, `cooldownDays: 0` is structurally invalid and the default
 * filler must overwrite it.
 */
describe("applyTriggerCooldownDefaults — cooldownDays:0 hardening", () => {
  function mkTrigger(
    overrides: Partial<Trigger> & Pick<Trigger, "action" | "predicate">,
  ): Trigger {
    return {
      id: "test-id",
      rationale: "test",
      ...overrides,
    };
  }

  it("REVIEW + TIME_ELAPSED + cooldownDays:0 → overwrites with ~80% of days", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    // ~80% of 14 = 11
    expect(out.cooldownDays).toBe(11);
  });

  it("REVIEW + PRICE_BELOW + cooldownDays:0 → overwrites with per-kind default 1", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "PRICE_BELOW", level: 108 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(1);
  });

  it("ENTER + EARNINGS_BEAT + cooldownDays:0 → overwrites with per-kind default 7", () => {
    const t = mkTrigger({
      action: "ENTER",
      predicate: { kind: "EARNINGS_BEAT" },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(7);
  });

  it("EXIT + cooldownDays:0 is PRESERVED — terminal-action opt-out is legitimate", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { kind: "PRICE_BELOW", level: 213.87 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(0);
  });

  it("EXIT + cooldownDays:0 on PRICE_ABOVE target is preserved", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { kind: "PRICE_ABOVE", level: 268 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(0);
  });

  it("non-zero cooldownDays on any action is preserved (no override)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      cooldownDays: 3,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(3);
  });

  it("undefined cooldownDays still gets default (original behavior)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      // cooldownDays unset
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(11);
  });

  it("the exact NVDA shape — fills with 11", () => {
    // Verbatim shape from the runaway audit row.
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      rationale:
        "Momentum Breakout trades are days-to-weeks holds; re-check the setup by max hold date and exit if momentum has not followed through.",
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(11);
  });
});
