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
      predicate: { kind: "PRICE_BELOW", level: 100 },
      action: "EXIT",
      rationale: "stop",
    });
    expect(parsed.fireMode).toBeUndefined();
  });

  it("passes an explicit DIRECT through", () => {
    const parsed = triggerSchema.parse({
      predicate: { kind: "PRICE_MOVE_PCT", pct: 5, direction: "DOWN", window: "1D" },
      action: "EXIT",
      rationale: "down 5% on the day",
      fireMode: "DIRECT",
    });
    expect(parsed.fireMode).toBe("DIRECT");
  });

  it("rejects an unknown fire mode", () => {
    const result = triggerSchema.safeParse({
      predicate: { kind: "PRICE_BELOW", level: 100 },
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
  it.each(["PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT"])(
    "%s is DIRECT-eligible",
    (kind) => {
      expect(isDirectEligiblePredicate(kind)).toBe(true);
    },
  );

  it.each([
    "EARNINGS_MISS",
    "EARNINGS_BEAT",
    "SIGNAL_TYPE",
    "RSI",
    "TIME_ELAPSED",
    "GUIDANCE_CHANGE",
    "FILING",
    "TRAILING_STOP",
    "AND",
    "OR",
  ])("%s is NOT DIRECT-eligible (judgment-bearing → tactical)", (kind) => {
    expect(isDirectEligiblePredicate(kind)).toBe(false);
  });
});

describe("fireMode + cooldown normalizers compose", () => {
  it("a DIRECT EXIT keeps its cooldownDays:0 opt-out", () => {
    const t: Trigger = {
      id: "t1",
      predicate: { kind: "PRICE_BELOW", level: 100 },
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
