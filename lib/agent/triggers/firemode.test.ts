/**
 * firemode.test.ts — pins the per-trigger fire-mode field added for the
 * Add-trigger UI + TRIGGER_FOLLOWUPS #3 (DIRECT exits skip the tactical run).
 *
 * Three pure surfaces are covered:
 *   1. triggerSchema.fireMode — omitted stays ABSENT (readers treat absent
 *      as TACTICAL; DAV-226 removed the write-time "TACTICAL" stamp because
 *      it labeled REVIEW rungs with a tactical wake that never happens);
 *      explicit value passes through; bad value rejected.
 *   2. defaultFireModeForAction — EXIT ⇒ DIRECT, everything else ⇒ TACTICAL.
 *   3. cooldown defaulting is unaffected by fireMode (the two write-path
 *      normalizers compose).
 *
 * The applyTriggerAdd/Delete/FireModeChange server actions hit Prisma + Alpaca
 * and aren't unit-tested here — these pin the pure invariants they rely on.
 */

import { triggerSchema } from "./schema";
import { defaultFireModeForAction, applyTriggerCooldownDefaults } from "./defaults";
import { isDirectEligiblePredicate } from "./types";
import type { Trigger } from "./types";

describe("triggerSchema.fireMode", () => {
  it("stays absent when omitted (absent ⇒ TACTICAL at every reader; no stamped label)", () => {
    const parsed = triggerSchema.parse({
      predicate: { watch: "price", is: "below", value: 100 },
      action: "EXIT",
      rationale: "stop",
    });
    expect(parsed.fireMode).toBeUndefined();
  });

  it("passes an explicit DIRECT through", () => {
    const parsed = triggerSchema.parse({
      predicate: { watch: "move", is: "below", value: 5, variable: "prev_close" },
      action: "EXIT",
      rationale: "down 5% on the day",
      fireMode: "DIRECT",
    });
    expect(parsed.fireMode).toBe("DIRECT");
  });

  it("rejects an unknown fire mode", () => {
    const result = triggerSchema.safeParse({
      predicate: { watch: "price", is: "below", value: 100 },
      action: "EXIT",
      rationale: "stop",
      fireMode: "INSTANT",
    });
    expect(result.success).toBe(false);
  });
});

describe("defaultFireModeForAction", () => {
  it("EXIT → DIRECT (deterministic exits skip the tactical run)", () => {
    expect(defaultFireModeForAction("EXIT")).toBe("DIRECT");
  });

  it.each(["ENTER", "REVIEW", "ADD", "TRIM", "MOVE_STOP"] as const)(
    "%s → TACTICAL (judgment-bearing actions wake an agent)",
    (action) => {
      expect(defaultFireModeForAction(action)).toBe("TACTICAL");
    },
  );
});

describe("isDirectEligiblePredicate — only deterministic price/% exits", () => {
  it.each([
    { watch: "price", is: "above", value: 100 },
    { watch: "price", is: "below", value: 100 },
    { watch: "move", is: "below", value: 5, variable: "prev_close" },
    { watch: "move", is: "below", value: 5, variable: "close_20d" },
    { watch: "move", is: "below", value: 10, variable: "entry" },
    { watch: "move", is: "below", value: 15, variable: "peak" },
  ])("%j is DIRECT-eligible", (predicate) => {
    expect(isDirectEligiblePredicate(predicate)).toBe(true);
  });

  it.each([
    { watch: "surprise", is: "miss", value: 0 },
    { watch: "surprise", is: "beat", value: 0 },
    { watch: "rsi", is: "below", value: 30 },
    { watch: "move", is: "near", value: 2, variable: "sma50" },
    { watch: "price", is: "below", variable: "sma200" },
    { watch: "volume", value: 2 },
    { kind: "TRAILING_STOP", pct: 10 },
    { match: "all", conditions: [{ watch: "price", is: "below", value: 100 }, { watch: "volume", value: 2 }] },
    { match: "any", conditions: [{ watch: "price", is: "below", value: 100 }, { watch: "price", is: "below", value: 90 }] },
  ])("%j is NOT DIRECT-eligible (judgment-bearing → tactical)", (predicate) => {
    expect(isDirectEligiblePredicate(predicate)).toBe(false);
  });
});

describe("fireMode + cooldown normalizers compose", () => {
  it("a DIRECT EXIT keeps its cooldownDays:0 opt-out", () => {
    const t: Trigger = {
      id: "t1",
      predicate: { watch: "price", is: "below", value: 100 },
      action: "EXIT",
      rationale: "stop",
      cooldownDays: 0,
      fireMode: "DIRECT",
    };
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(0);
    expect(out.fireMode).toBe("DIRECT");
  });
});
