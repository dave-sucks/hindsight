/**
 * enter-guard.test.ts — coverage for validateEnterTriggerRequired.
 *
 * Pure function; no DB, no fetches. Walks the matrix of (direction × status
 * × triggers × targetPrice) the guard sees from record_thesis and
 * update_thesis. The bug it prevents: WATCHING LONG/SHORT theses that lack
 * an ENTER trigger sit inert — the trigger evaluator has no entry path,
 * tactical never wakes for promotion, and the thesis is structurally dead.
 */

import { validateEnterTriggerRequired } from "./enter-guard";
import type { Trigger } from "./types";

const ENTER_LONG: Trigger = {
  id: "trig-enter-long",
  predicate: { kind: "PRICE_ABOVE", level: 100 },
  action: "ENTER",
  rationale: "Entry on breakout",
  cooldownDays: 1,
};

const ENTER_SHORT: Trigger = {
  id: "trig-enter-short",
  predicate: { kind: "PRICE_BELOW", level: 50 },
  action: "ENTER",
  rationale: "Short entry on breakdown",
  cooldownDays: 1,
};

const EXIT_STOP: Trigger = {
  id: "trig-exit-stop",
  predicate: { kind: "PRICE_BELOW", level: 80 },
  action: "EXIT",
  rationale: "Stop at $80",
  cooldownDays: 0,
};

const REVIEW_EARNINGS: Trigger = {
  id: "trig-review-earnings",
  predicate: { kind: "EARNINGS_BEAT" },
  action: "REVIEW",
  rationale: "Earnings beat — re-score",
  cooldownDays: 7,
};

const REVIEW_HYGIENE: Trigger = {
  id: "trig-review-hygiene",
  predicate: { kind: "TIME_ELAPSED", days: 14 },
  action: "REVIEW",
  rationale: "Catalyst-window hygiene",
  cooldownDays: 12,
};

describe("validateEnterTriggerRequired", () => {
  // ── Happy path: WATCHING LONG/SHORT with ENTER trigger ───────────────────

  it("WATCHING LONG with ENTER trigger: ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "WATCHING",
        triggers: [ENTER_LONG, REVIEW_EARNINGS],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("WATCHING SHORT with ENTER trigger: ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "SHORT",
        status: "WATCHING",
        triggers: [ENTER_SHORT, REVIEW_EARNINGS],
        targetPrice: 50,
      }),
    ).toEqual({ ok: true });
  });

  it("WATCHING LONG with multiple ENTER triggers (price + event): ok", () => {
    const eventEnter: Trigger = {
      id: "trig-enter-event",
      predicate: { kind: "EARNINGS_BEAT" },
      action: "ENTER",
      rationale: "Entry on catalyst",
      cooldownDays: 7,
    };
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "WATCHING",
        triggers: [ENTER_LONG, eventEnter, REVIEW_HYGIENE],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  // ── A floor on a watch item is legal now (DAV-195 L5) ─────────────────
  // The guard used to reject EXIT/TRIM/ADD/MOVE_STOP on a WATCHING thesis,
  // because a price level firing on something we don't own had no meaning
  // and would spawn an orphan tactical run. `effectiveTriggerAction` gives
  // it one — DEMOTE, inline, no spawn — so the rule is gone and the write
  // is allowed. See the deleted-gate note in enter-guard.ts.

  it("allows a floor on a WATCHING thesis alongside the buy level", () => {
    // The KLAC shape, and the whole reason 19 of 19 watchlist rows carry a
    // stop that fires nothing: the write was refused, so it was never armed.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [ENTER_LONG, EXIT_STOP, REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(true);
  });

  it("allows a floor on a WATCHING SHORT too", () => {
    const result = validateEnterTriggerRequired({
      direction: "SHORT",
      status: "WATCHING",
      triggers: [ENTER_SHORT, EXIT_STOP],
      targetPrice: 50,
    });
    expect(result.ok).toBe(true);
  });

  it("still requires a buy level — a floor alone is not a plan", () => {
    // The ENTER-presence guard is untouched and now carries the whole job.
    // Without a buy level the thesis can never be promoted, however many
    // other triggers it has.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS, EXIT_STOP],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-enter-trigger");
  });

  it("tolerates position-scoped actions on a watch item without refusing the write", () => {
    // TRIM / ADD / MOVE_STOP remain meaningless before we own the name, but
    // they are inert rather than harmful — they read an open position and
    // evaluate false without one. Refusing the whole write over them cost
    // more than it saved.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [
        ENTER_LONG,
        {
          id: "trig-trim",
          predicate: { kind: "PRICE_ABOVE", level: 150 },
          action: "TRIM",
          rationale: "Trim at +50%",
        },
      ],
      targetPrice: 100,
    });
    expect(result.ok).toBe(true);
  });

  it("WATCHING LONG with empty triggers array: rejects with missing-enter-trigger", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-enter-trigger");
  });

  it("WATCHING LONG with only REVIEW triggers (no HELD, no ENTER): rejects with missing-enter-trigger", () => {
    // Pure REVIEW set is structurally valid (no HELD actions to reject)
    // but missing the required ENTER. The HELD guard passes; the
    // ENTER guard catches it.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS, REVIEW_HYGIENE],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-enter-trigger");
  });

  // ── Missing targetPrice → different error message ───────────────────────

  it("WATCHING LONG with missing target_price: rejects with target-required note", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS],
      targetPrice: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toMatch(/target_price is required/);
    expect(result.note).not.toMatch(/displaced/);
  });

  it("WATCHING LONG with present target_price but no ENTER: rejects with displaced-default note", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toMatch(/displaced the default ENTER trigger/);
    expect(result.note).not.toMatch(/target_price is required/);
  });

  // ── ACTIVE-side symmetric checks ────────────────────────────────────────
  // Added 2026-05-26 after the backfill exposed the symmetric bug — the
  // thesis-writer's WATCHING-only prompt wrote WATCHING-shape triggers
  // (ENTER + REVIEW, no EXIT) onto 9 of 10 ACTIVE held paper positions.

  it("ACTIVE LONG with HELD-template triggers (EXIT + REVIEW, no ENTER): ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "HOLDING",
        triggers: [EXIT_STOP, REVIEW_EARNINGS],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("ACTIVE SHORT with HELD-template triggers (EXIT + REVIEW, no ENTER): ok", () => {
    const exitShort: Trigger = {
      id: "trig-exit-short",
      predicate: { kind: "PRICE_ABOVE", level: 60 },
      action: "EXIT",
      rationale: "Stop at $60 for SHORT",
      cooldownDays: 0,
    };
    expect(
      validateEnterTriggerRequired({
        direction: "SHORT",
        status: "HOLDING",
        triggers: [exitShort, REVIEW_EARNINGS],
        targetPrice: 50,
      }),
    ).toEqual({ ok: true });
  });

  it("ACTIVE LONG with ENTER trigger (no EXIT): rejects with enter-actions-on-active", () => {
    // The backfill 2026-05-26 production shape on Catalyst MRVL / DELL /
    // OKTA / TSM / etc. — thesis-writer applied WATCHING template to the
    // ACTIVE refresh. ENTER check fires first because that's the bigger
    // structural problem (you can't ENTER what you already hold).
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [ENTER_LONG, REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("enter-actions-on-active");
    expect(result.note).toMatch(/already own/);
  });

  it("ACTIVE LONG with ENTER + EXIT (has both): rejects with enter-actions-on-active", () => {
    // The ENTER check runs first and rejects even with an EXIT present —
    // the agent must remove the ENTER triggers to clear the gate.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [ENTER_LONG, EXIT_STOP, REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("enter-actions-on-active");
    expect(result.note).toMatch(/ENTER/);
  });

  it("ACTIVE LONG with REVIEW only (no ENTER, no EXIT): rejects with missing-exit-trigger-on-active", () => {
    // The Catalyst SNOW 2026-05-26 production shape — zero actionable
    // triggers at all. ENTER guard passes (no ENTER), EXIT guard catches
    // the missing stop-loss.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [REVIEW_EARNINGS, REVIEW_HYGIENE],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-exit-trigger-on-active");
    expect(result.note).toMatch(/automated stop-loss/);
  });

  it("ACTIVE LONG with empty triggers: rejects with missing-exit-trigger-on-active", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-exit-trigger-on-active");
  });

  it("ACTIVE LONG with TRIM + REVIEW (no ENTER, no EXIT): rejects with missing-exit-trigger-on-active", () => {
    // TRIM is HELD-only but doesn't substitute for EXIT. Position needs
    // an automated full-exit predicate too.
    const trim: Trigger = {
      id: "trig-trim",
      predicate: { kind: "PRICE_ABOVE", level: 150 },
      action: "TRIM",
      rationale: "Trim at +50%",
    };
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [trim, REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-exit-trigger-on-active");
  });

  it("ACTIVE LONG with EXIT + TRIM + ADD + MOVE_STOP + REVIEW (full HELD set): ok", () => {
    const trim: Trigger = {
      id: "trig-trim",
      predicate: { kind: "PRICE_ABOVE", level: 150 },
      action: "TRIM",
      rationale: "Trim at +50%",
    };
    const add: Trigger = {
      id: "trig-add",
      predicate: { kind: "EARNINGS_BEAT" },
      action: "ADD",
      rationale: "Add on beat",
    };
    const moveStop: Trigger = {
      id: "trig-move-stop",
      predicate: { kind: "PRICE_ABOVE", level: 120 },
      action: "MOVE_STOP",
      rationale: "Trail stop up",
    };
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "HOLDING",
        triggers: [EXIT_STOP, trim, add, moveStop, REVIEW_EARNINGS],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  // ── Non-WATCHING/ACTIVE statuses bypass (no shape check) ────────────────

  it("CLOSED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "RETIRED",
        triggers: [],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("INVALIDATED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "RETIRED",
        triggers: [],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("ARCHIVED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "RETIRED",
        triggers: [],
        targetPrice: null,
      }),
    ).toEqual({ ok: true });
  });

  it("PROMOTED LONG with no triggers: ok (resolution to ACTIVE/WATCHING runs the check later)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "PROMOTED",
        triggers: [],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  // ── Non-directional directions bypass ───────────────────────────────────

  it("PASS PASSED with no triggers: ok (PASS has no ENTER by design)", () => {
    // Post status-taxonomy migration (P1-24) a PASS lands status='PASSED'.
    // The guard bypasses on any non-LONG/SHORT direction before it inspects
    // status, so PASSED is fine here.
    expect(
      validateEnterTriggerRequired({
        direction: "PASS",
        status: "PASSED",
        triggers: [],
        targetPrice: null,
      }),
    ).toEqual({ ok: true });
  });

  it("PENDING WATCHING with no triggers: ok (seed, awaiting first research)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: null,
        status: "WATCHING",
        triggers: [],
        targetPrice: null,
      }),
    ).toEqual({ ok: true });
  });

  it("null-direction WATCHING with no triggers: ok (P1-24 B4 seed sentinel)", () => {
    // An unresearched seed now stores direction=null. The allowlist on
    // LONG/SHORT means null bypasses exactly like 'PENDING' — a seed carries
    // no directional triggers until it's promoted.
    expect(
      validateEnterTriggerRequired({
        direction: null,
        status: "WATCHING",
        triggers: [],
        targetPrice: null,
      }),
    ).toEqual({ ok: true });
  });

  // ── Note text matches record_thesis's old inline guard verbatim ─────────

  it("error message uses PRICE_ABOVE/PRICE_BELOW guidance for the agent", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toContain("PRICE_ABOVE for LONG");
    expect(result.note).toContain("PRICE_BELOW for SHORT");
  });
});
