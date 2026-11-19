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
  predicate: { watch: "price", is: "above", value: 100 },
  action: "ENTER",
  rationale: "Entry on breakout",
};

const ENTER_SHORT: Trigger = {
  id: "trig-enter-short",
  predicate: { watch: "price", is: "below", value: 50 },
  action: "ENTER",
  rationale: "Short entry on breakdown",
};

const EXIT_STOP: Trigger = {
  id: "trig-exit-stop",
  predicate: { watch: "price", is: "below", value: 80 },
  action: "EXIT",
  rationale: "Stop at $80",
};

/** A watch's line: its own action, on the close. */
const STOP_WATCHING: Trigger = {
  id: "trig-stop-watching",
  predicate: { watch: "price", is: "below", value: 80, settings: { close: true } },
  action: "STOP_WATCHING",
  rationale: "Below $80 the setup is wrong",
};

const REVIEW_EARNINGS: Trigger = {
  id: "trig-review-earnings",
  predicate: { watch: "surprise", is: "beat", value: 0 },
  action: "REVIEW",
  rationale: "Earnings beat — re-score",
};

const REVIEW_HYGIENE: Trigger = {
  id: "trig-review-hygiene",
  predicate: { watch: "repeat", value: 14 },
  action: "REVIEW",
  rationale: "Catalyst-window hygiene",
};

describe("validateEnterTriggerRequired", () => {
  // ── Happy path: WATCHING LONG/SHORT with ENTER trigger ───────────────────

  it("WATCHING LONG with ENTER trigger: ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "WATCHING",
        triggers: [ENTER_LONG, REVIEW_EARNINGS],
      }),
    ).toEqual({ ok: true });
  });

  it("WATCHING SHORT with ENTER trigger: ok", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "SHORT",
        status: "WATCHING",
        triggers: [ENTER_SHORT, REVIEW_EARNINGS],
      }),
    ).toEqual({ ok: true });
  });

  it("WATCHING LONG with multiple ENTER triggers (price + event): ok", () => {
    const eventEnter: Trigger = {
      id: "trig-enter-event",
      predicate: { watch: "surprise", is: "beat", value: 0 },
      action: "ENTER",
      rationale: "Entry on catalyst",
    };
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "WATCHING",
        triggers: [ENTER_LONG, eventEnter, REVIEW_HYGIENE],
      }),
    ).toEqual({ ok: true });
  });

  // ── A floor on a watch item is legal now (DAV-195 L5) ─────────────────
  // A watch ends on its own Stop watching line (stop-watching.ts); a sale on
  // a watch is refused per op (condition/actions.ts), so this guard has no
  // watch rule at all.

  it("allows a Stop watching line on a WATCHING thesis alongside the buy level", () => {
    // The KLAC shape, and the whole reason 19 of 19 watchlist rows carry a
    // stop that fires nothing: the write was refused, so it was never armed.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [ENTER_LONG, STOP_WATCHING, REVIEW_EARNINGS],
    });
    expect(result.ok).toBe(true);
  });

  it("a Stop watching line needs no buy: it ends the watch and sells nothing", () => {
    for (const triggers of [[STOP_WATCHING], [REVIEW_EARNINGS, STOP_WATCHING]]) {
      expect(validateEnterTriggerRequired({ direction: "LONG", status: "WATCHING", triggers }).ok).toBe(true);
    }
  });

  it("tolerates position-scoped actions on a watch item without refusing the write", () => {
    // TRIM / ADD remain meaningless before we own the name, but
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
          predicate: { watch: "price", is: "above", value: 150 },
          action: "TRIM",
          rationale: "Trim at +50%",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("WATCHING LONG with NO triggers at all: ok — a pinned name is legal (DAV-209)", () => {
    // FLIPPED 2026-09-08. This used to be the "inert row" rejection. A
    // stock can now be kept in view with nothing on it: nothing wakes it,
    // the watchlist screen is what keeps it visible, and that is a choice
    // a person is allowed to make. targetPrice on the row is not a plan
    // level — only a trigger is.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [],
    });
    expect(result.ok).toBe(true);
  });

  it("WATCHING LONG with only REVIEW wakes (no plan level): ok — no plan, no ENTER needed", () => {
    // A name kept in view with wakes but no buy plan.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [REVIEW_EARNINGS, REVIEW_HYGIENE],
    });
    expect(result.ok).toBe(true);
  });

  it("set-down works for SHORT too, and with a downside price wake", () => {
    const result = validateEnterTriggerRequired({
      direction: "SHORT",
      status: "WATCHING",
      triggers: [
        {
          id: "trig-wake-level",
          predicate: { watch: "price", is: "above", value: 120 },
          action: "REVIEW",
          rationale: "Squeeze risk — look again above $120.",
        },
      ],
    });
    // price above on a SHORT is the losing side — a wake, not a plan level.
    expect(result.ok).toBe(true);
  });

  it("an upside REVIEW with no buy is a wake, not a target — it needs no ENTER (QB ruling 2026-09-29)", () => {
    // Reversed from the full-plan rule on the QB's ruling (DAV-335): on a
    // stock we only watch, "look again at $150" is the wake the 2026-09-08
    // design allowed. VST's "review at $146 instead of the buy" was refused
    // here five times on 09-28.
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "WATCHING",
      triggers: [
        {
          id: "trig-upside-review",
          predicate: { watch: "price", is: "above", value: 150 },
          action: "REVIEW",
          rationale: "Reassess at $150.",
        },
      ],
    });
    expect(result.ok).toBe(true);
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
      }),
    ).toEqual({ ok: true });
  });

  it("ACTIVE SHORT with HELD-template triggers (EXIT + REVIEW, no ENTER): ok", () => {
    const exitShort: Trigger = {
      id: "trig-exit-short",
      predicate: { watch: "price", is: "above", value: 60 },
      action: "EXIT",
      rationale: "Stop at $60 for SHORT",
    };
    expect(
      validateEnterTriggerRequired({
        direction: "SHORT",
        status: "HOLDING",
        triggers: [exitShort, REVIEW_EARNINGS],
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
      predicate: { watch: "price", is: "above", value: 150 },
      action: "TRIM",
      rationale: "Trim at +50%",
    };
    const result = validateEnterTriggerRequired({
      direction: "LONG",
      status: "HOLDING",
      triggers: [trim, REVIEW_EARNINGS],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-exit-trigger-on-active");
  });

  it("ACTIVE LONG with EXIT + TRIM + ADD + REVIEW (full HELD set): ok", () => {
    const trim: Trigger = {
      id: "trig-trim",
      predicate: { watch: "price", is: "above", value: 150 },
      action: "TRIM",
      rationale: "Trim at +50%",
    };
    const add: Trigger = {
      id: "trig-add",
      predicate: { watch: "surprise", is: "beat", value: 0 },
      action: "ADD",
      rationale: "Add on beat",
    };
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "HOLDING",
        triggers: [EXIT_STOP, trim, add, REVIEW_EARNINGS],
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
      }),
    ).toEqual({ ok: true });
  });

  it("INVALIDATED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "RETIRED",
        triggers: [],
      }),
    ).toEqual({ ok: true });
  });

  it("ARCHIVED LONG with no triggers: ok (terminal state)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "RETIRED",
        triggers: [],
      }),
    ).toEqual({ ok: true });
  });

  it("PROMOTED LONG with no triggers: ok (resolution to ACTIVE/WATCHING runs the check later)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: "LONG",
        status: "PROMOTED",
        triggers: [],
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
      }),
    ).toEqual({ ok: true });
  });

  it("PENDING WATCHING with no triggers: ok (seed, awaiting first research)", () => {
    expect(
      validateEnterTriggerRequired({
        direction: null,
        status: "WATCHING",
        triggers: [],
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
      }),
    ).toEqual({ ok: true });
  });
});

describe("the held-name notes name the ops that exist (DAV-262)", () => {
  // CEG tactical run, 2026-09-14 09:35:39: the ENTER-on-held refusal told the
  // agent to "pass that array" — the whole-list argument DAV-242 deleted — and
  // called the holding "ACTIVE", a status P1-24 deleted.
  const held = (triggers: Trigger[]) =>
    validateEnterTriggerRequired({ direction: "LONG", status: "HOLDING", triggers });

  it("a buy trigger on a stock we own: remove it by id with remove_trigger_ids", () => {
    const r = held([
      { id: "buy-ceg-1", predicate: { watch: "price", is: "above", value: 280 }, action: "ENTER", rationale: "buy" },
      { id: "floor-ceg", predicate: { watch: "price", is: "below", value: 220 }, action: "EXIT", rationale: "floor" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.note).toContain('by these ids: ["buy-ceg-1"]');
    expect(r.note).toMatch(/already own/);
    expect(r.note).not.toMatch(/pass that array|ACTIVE thesis|triggers\[\]|defaultTriggersForHorizon/);
  });

  it("no sell trigger on a stock we own: add one with add_triggers", () => {
    const r = held([
      { id: "review-ceg", predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "look" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.note).toContain("Fix: add one");
    expect(r.note).toMatch(/automated stop-loss/);
    expect(r.note).not.toMatch(/pass that array|ACTIVE thesis|triggers\[\]|defaultTriggersForHorizon/);
  });
});
