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

  // ── The bug: WATCHING LONG/SHORT with HELD-template triggers ───────────
  // After 2026-05-25 (XPEV + MDB production evidence), the guard rejects
  // HELD-only actions (EXIT/TRIM/ADD/MOVE_STOP) on WATCHING BEFORE checking
  // for ENTER presence. Both errors block the write; the HELD-action
  // message names the bigger structural problem and points at the fix.

  it("WATCHING LONG with HELD-template EXIT + REVIEW (no ENTER): rejects with held-actions-on-watching", () => {
    // The XPEV 2026-05-25 production shape included EXIT triggers on a
    // WATCHING row. The HELD-action guard runs first → the error message
    // names the structural problem clearly (EXIT can't fire without a
    // position) instead of just "missing ENTER" which would prompt the
    // agent to add ENTER without removing the wrong EXIT triggers.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS, EXIT_STOP],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/HELD-only action/);
    expect(result.note).toMatch(/EXIT/);
  });

  it("WATCHING SHORT with HELD-template EXIT + REVIEW (no ENTER): rejects with held-actions-on-watching", () => {
    const result = validateEnterTriggerRequired({
      direction: "SHORT",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS, EXIT_STOP],
      targetPrice: 50,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
  });

  it("WATCHING LONG with ENTER + EXIT (has ENTER but also wrong EXIT): rejects with held-actions-on-watching", () => {
    // The MDB 2026-05-25 production shape after #337's first attempt:
    // agent added 1 ENTER (EARNINGS_BEAT) but ALSO kept 3 EXIT triggers.
    // ENTER-presence guard would pass; this guard catches the EXIT.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [ENTER_LONG, EXIT_STOP, REVIEW_EARNINGS],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/EXIT/);
  });

  it("WATCHING LONG with ENTER + TRIM: rejects with held-actions-on-watching", () => {
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/TRIM/);
  });

  it("WATCHING LONG with ENTER + ADD: rejects with held-actions-on-watching", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [
        ENTER_LONG,
        {
          id: "trig-add",
          predicate: { kind: "EARNINGS_BEAT" },
          action: "ADD",
          rationale: "Add on beat",
        },
      ],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/ADD/);
  });

  it("WATCHING LONG with ENTER + MOVE_STOP: rejects with held-actions-on-watching", () => {
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [
        ENTER_LONG,
        {
          id: "trig-stop",
          predicate: { kind: "PRICE_ABOVE", level: 120 },
          action: "MOVE_STOP",
          rationale: "Trail stop up",
        },
      ],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/MOVE_STOP/);
  });

  it("WATCHING LONG with multiple HELD actions (EXIT + TRIM + ADD): lists all offender kinds", () => {
    // The full HELD-template attack — the catalyst-event MDB 2026-05-25
    // shape was effectively this. Error message should enumerate the
    // distinct offending action kinds so the agent knows everything to
    // remove.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [
        ENTER_LONG,
        EXIT_STOP,
        {
          id: "trig-trim",
          predicate: { kind: "PRICE_ABOVE", level: 150 },
          action: "TRIM",
          rationale: "Trim half at +50%",
        },
        {
          id: "trig-add",
          predicate: { kind: "EARNINGS_BEAT" },
          action: "ADD",
          rationale: "Add on confirmation",
        },
      ],
      targetPrice: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("held-actions-on-watching");
    expect(result.note).toMatch(/EXIT/);
    expect(result.note).toMatch(/TRIM/);
    expect(result.note).toMatch(/ADD/);
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

  // ── Non-WATCHING statuses bypass (no ENTER trigger needed) ──────────────

  it("ACTIVE LONG with HELD-template triggers (no ENTER): ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "ACTIVE",
        triggers: [EXIT_STOP, REVIEW_EARNINGS],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("CLOSED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "CLOSED",
        triggers: [],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("INVALIDATED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "INVALIDATED",
        triggers: [],
        targetPrice: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("ARCHIVED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "ARCHIVED",
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

  it("PASS ARCHIVED with no triggers: ok (PASS has no ENTER by design)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "PASS",
        status: "ARCHIVED",
        triggers: [],
        targetPrice: null,
      }),
    ).toEqual({ ok: true });
  });

  it("PENDING WATCHING with no triggers: ok (seed, awaiting first research)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "PENDING",
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
