/**
 * enforce-close-reason.test.ts — pins the sale-label rule (DAV-192).
 *
 * The contract this file defends:
 *   1. A sale that executed because a protective trigger fired ALWAYS stores
 *      STOP or TARGET, whatever the model called it. Mislabeled MANUAL sales
 *      are invisible to the held-through-floor context in `get_theses` and to
 *      the sold-name recycle rule — that is the dodge this closes.
 *   2. The correction never refuses the sale; it writes an audit note naming
 *      what the agent originally declared.
 *   3. "Thesis invalidated" stays honest on its own axis: the corrected label
 *      never lets an over-optimistic `belief_survived` resurrect a thesis the
 *      agent just called structurally broken.
 */

import {
  enforceCloseReason,
  withCloseAuditNote,
  type DeclaredCloseReason,
} from "@/lib/agent/triggers/enforce-close-reason";

const TRAIL = "Trailing 8% from high";

describe("enforceCloseReason — no protective fire (daily run / judgment trigger)", () => {
  it("keeps the agent's own label and collapses the judgment codes to MANUAL", () => {
    const cases: Array<[DeclaredCloseReason, string]> = [
      ["TARGET", "TARGET"],
      ["STOP", "STOP"],
      ["MANUAL", "MANUAL"],
      ["RISK_MANAGEMENT", "MANUAL"],
      ["THESIS_INVALIDATED", "MANUAL"],
    ];
    for (const [declared, stored] of cases) {
      const e = enforceCloseReason({ declared });
      expect(e.stored).toBe(stored);
      expect(e.corrected).toBe(false);
      expect(e.auditNote).toBeNull();
    }
  });

  it("leaves a discretionary belief attestation untouched", () => {
    expect(
      enforceCloseReason({ declared: "MANUAL", beliefSurvived: true })
        .beliefSurvived,
    ).toBe(true);
  });
});

describe("enforceCloseReason — protective fire forces the label", () => {
  it.each<DeclaredCloseReason>([
    "MANUAL",
    "RISK_MANAGEMENT",
    "THESIS_INVALIDATED",
    "TARGET",
  ])("rewrites a declared %s to STOP on a protective STOP fire", (declared) => {
    const e = enforceCloseReason({
      declared,
      protective: "STOP",
      triggerLabel: TRAIL,
    });
    expect(e.stored).toBe("STOP");
    expect(e.corrected).toBe(true);
    expect(e.declared).toBe(declared);
  });

  it("rewrites to TARGET when the protective fire was favorable", () => {
    const e = enforceCloseReason({ declared: "MANUAL", protective: "TARGET" });
    expect(e.stored).toBe("TARGET");
    expect(e.corrected).toBe(true);
  });

  it("stays quiet when the agent already picked the right label", () => {
    const e = enforceCloseReason({ declared: "STOP", protective: "STOP" });
    expect(e.stored).toBe("STOP");
    expect(e.corrected).toBe(false);
    expect(e.auditNote).toBeNull();
  });

  it("never yields a stored label outside TARGET/STOP on a protective fire", () => {
    const declared: DeclaredCloseReason[] = [
      "TARGET",
      "STOP",
      "THESIS_INVALIDATED",
      "RISK_MANAGEMENT",
      "MANUAL",
    ];
    for (const d of declared) {
      for (const p of ["STOP", "TARGET"] as const) {
        expect(["STOP", "TARGET"]).toContain(
          enforceCloseReason({ declared: d, protective: p }).stored,
        );
      }
    }
  });
});

describe("enforceCloseReason — the audit note", () => {
  it("names both labels and the trigger that forced the correction", () => {
    const note = enforceCloseReason({
      declared: "MANUAL",
      protective: "STOP",
      triggerLabel: TRAIL,
    }).auditNote!;
    expect(note).toContain("MANUAL");
    expect(note).toContain("STOP");
    expect(note).toContain(TRAIL);
  });

  it("falls back to generic wording when no trigger label was threaded", () => {
    const note = enforceCloseReason({
      declared: "MANUAL",
      protective: "STOP",
    }).auditNote!;
    expect(note).toContain("a protective trigger fired");
    expect(note).not.toContain("()");
  });

  it("says the invalidation call still stands when that was the declared label", () => {
    const note = enforceCloseReason({
      declared: "THESIS_INVALIDATED",
      protective: "STOP",
      triggerLabel: TRAIL,
    }).auditNote!;
    expect(note).toContain("THESIS_INVALIDATED");
    expect(note.toLowerCase()).toContain("retires");
  });
});

describe("enforceCloseReason — thesis-invalidated stays distinct", () => {
  it("forces beliefSurvived false even when the label was corrected to STOP", () => {
    // The bug this pins: the correction used to overwrite the intent BEFORE
    // the invalidation guard ran, so a protective fire plus an optimistic
    // attestation recycled a structurally-broken thesis back to WATCHING.
    const e = enforceCloseReason({
      declared: "THESIS_INVALIDATED",
      protective: "STOP",
      beliefSurvived: true,
    });
    expect(e.stored).toBe("STOP");
    expect(e.beliefSurvived).toBe(false);
  });

  it("forces beliefSurvived false with no protective fire in play", () => {
    expect(
      enforceCloseReason({
        declared: "THESIS_INVALIDATED",
        beliefSurvived: true,
      }).beliefSurvived,
    ).toBe(false);
  });

  it("passes a genuine protective attestation straight through", () => {
    // Sold on price, story intact → the name stays on the re-entry radar.
    const e = enforceCloseReason({
      declared: "MANUAL",
      protective: "STOP",
      beliefSurvived: true,
    });
    expect(e.stored).toBe("STOP");
    expect(e.beliefSurvived).toBe(true);
  });
});

describe("withCloseAuditNote", () => {
  it("appends the note to the agent's rationale", () => {
    const e = enforceCloseReason({ declared: "MANUAL", protective: "STOP" });
    const out = withCloseAuditNote("Trimming into weakness.", e);
    expect(out.startsWith("Trimming into weakness.")).toBe(true);
    expect(out).toContain(e.auditNote!);
  });

  it("returns the rationale untouched when nothing was corrected", () => {
    const e = enforceCloseReason({ declared: "STOP", protective: "STOP" });
    expect(withCloseAuditNote("Floor tripped.", e)).toBe("Floor tripped.");
  });

  it("stands alone when the agent supplied no rationale", () => {
    const e = enforceCloseReason({ declared: "MANUAL", protective: "STOP" });
    expect(withCloseAuditNote("   ", e)).toBe(e.auditNote);
  });
});

describe("enforceCloseReason — a judgment close that claims a level the tape never reached (DAV-263)", () => {
  // SRRK, Catalyst Event PM daily run, 2026-09-14 08:00:31: close_position(reason: "TARGET")
  // at $55.41 with the target at $65 and the stop at $56.40. No protective fire
  // woke the run. The Order was stored TARGET — "target hit" for a sale that was
  // the agent's judgment ("the catalyst we owned has already happened").
  const srrk = { direction: "LONG" as const, price: 55.41, targetPrice: 65, stopLoss: 56.4 };

  it("SRRK: TARGET at $55.41 against a $65 target is stored MANUAL, with the note saying why", () => {
    const e = enforceCloseReason({ declared: "TARGET", levels: srrk });
    expect(e.stored).toBe("MANUAL");
    expect(e.corrected).toBe(true);
    expect(e.auditNote).toContain("TARGET → MANUAL");
    expect(e.auditNote).toContain("$55.41");
    expect(e.auditNote).toContain("$65.00 target");
  });

  it("a STOP claimed while the price sits above the stop is MANUAL too", () => {
    const e = enforceCloseReason({ declared: "STOP", levels: { ...srrk, price: 58 } });
    expect(e.stored).toBe("MANUAL");
    expect(e.auditNote).toContain("safe side of the $56.40 stop");
  });

  it("a TARGET the tape reached, or a STOP it broke, keeps its label with no note", () => {
    expect(enforceCloseReason({ declared: "TARGET", levels: { ...srrk, price: 66 } })).toMatchObject({ stored: "TARGET", corrected: false, auditNote: null });
    expect(enforceCloseReason({ declared: "STOP", levels: { ...srrk, price: 55.41 } })).toMatchObject({ stored: "STOP", corrected: false, auditNote: null });
    // SHORT: the target is below the entry, the stop above.
    expect(enforceCloseReason({ declared: "TARGET", levels: { direction: "SHORT", price: 40, targetPrice: 42, stopLoss: 60 } })).toMatchObject({ stored: "TARGET", corrected: false });
    expect(enforceCloseReason({ declared: "STOP", levels: { direction: "SHORT", price: 61, targetPrice: 42, stopLoss: 60 } })).toMatchObject({ stored: "STOP", corrected: false });
  });

  it("no price means no correction — the declared label stands", () => {
    expect(enforceCloseReason({ declared: "TARGET", levels: { ...srrk, price: null } })).toMatchObject({ stored: "TARGET", corrected: false, auditNote: null });
  });

  it("a plan with no target can't have hit one", () => {
    const e = enforceCloseReason({ declared: "TARGET", levels: { ...srrk, targetPrice: null } });
    expect(e.stored).toBe("MANUAL");
    expect(e.auditNote).toContain("no target");
  });

  it("MANUAL and the judgment codes are untouched by the levels", () => {
    for (const declared of ["MANUAL", "RISK_MANAGEMENT", "THESIS_INVALIDATED"] as const) {
      expect(enforceCloseReason({ declared, levels: srrk })).toMatchObject({ stored: "MANUAL", corrected: false });
    }
  });

  it("a protective fire still wins over the levels", () => {
    const e = enforceCloseReason({ declared: "TARGET", protective: "STOP", triggerLabel: TRAIL, levels: srrk });
    expect(e.stored).toBe("STOP");
    expect(e.auditNote).toContain("TARGET → STOP");
  });
});
