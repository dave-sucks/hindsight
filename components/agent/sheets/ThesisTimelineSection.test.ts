/**
 * ThesisTimelineSection.test.ts — pins the Activity tab's pure helpers
 * (P1-33 slice 1, principal visual spec 2026-08-20):
 *
 *   - titleSegments: one consistent two-tone sentence per event —
 *     medium core ("Bought", "Trigger:") + light variable values
 *     ("10 shares at $832.84"). Stored summaries never render verbatim.
 *   - railDot: green = money in, red = money out, amber = proposal that
 *     didn't trade
 *   - triggerDiffLines: per-rung ladder diff with id-churn cancelled
 *   - fieldChangeLines: exact "Target $80.00 → $95.00" lines (expanded)
 *
 * Fixtures mirror live production rows (XENE / EME / HPE arcs).
 */

import {
  titleSegments,
  triggerPhrase,
  updatedSecondary,
  fieldChangeLines,
  railDot,
  triggerDiffLines,
} from "./thesis-timeline-utils";

// Minimal row factory matching the component's TimelineUpdate shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(partial: Record<string, unknown>): any {
  return {
    id: "u1",
    timestamp: "2026-07-09T12:10:31.000Z",
    type: "UPDATED",
    summary: "",
    rationale: null,
    fieldChanges: null,
    priceAtTime: null,
    positionAtTime: null,
    triggerId: null,
    signalIds: [],
    runId: null,
    tradeId: null,
    ...partial,
  };
}

function proposalFc(intent: string, quantity?: number) {
  return { proposal: { to: { intent, quantity } } };
}

describe("titleSegments — trade rows read like the thesis banners", () => {
  it("Bought N shares at $fill for an approved buy", () => {
    expect(
      titleSegments(
        row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("OPEN", 10),
          priceAtTime: 832.84,
        }),
      ),
    ).toEqual({ primary: "Bought", secondary: "10 shares at $832.84" });
  });

  it("Sold N shares at $fill for an approved close", () => {
    expect(
      titleSegments(
        row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("CLOSE", 100),
          priceAtTime: 53.13,
        }),
      ),
    ).toEqual({ primary: "Sold", secondary: "100 shares at $53.13" });
  });

  it("omits the price when no fill is known yet", () => {
    expect(
      titleSegments(
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("ADD", 5) }),
      ),
    ).toEqual({ primary: "Bought", secondary: "5 shares" });
  });

  it("Declined / Expired / Awaiting carry side + share count", () => {
    expect(
      titleSegments(
        row({
          type: "PROPOSAL_REJECTED",
          fieldChanges: proposalFc("CLOSE", 75),
        }),
      ),
    ).toEqual({ primary: "Declined", secondary: "sell 75 shares" });
    expect(
      titleSegments(
        row({ type: "PROPOSAL_EXPIRED", fieldChanges: proposalFc("OPEN", 74) }),
      ),
    ).toEqual({ primary: "Expired", secondary: "buy 74 shares — no decision" });
    expect(
      titleSegments(
        row({ type: "PROPOSAL_PENDING", fieldChanges: proposalFc("OPEN", 10) }),
      ),
    ).toEqual({ primary: "Awaiting approval", secondary: "buy 10 shares" });
  });
});

describe("titleSegments — the rest of the grammar", () => {
  it("Trigger: <condition> with the action clause and ticker stripped", () => {
    expect(
      titleSegments(
        row({
          type: "TRIGGER_FIRED",
          summary: "Gives back 12% from the high — exit position",
        }),
      ),
    ).toEqual({
      primary: "Trigger:",
      secondary: "Gives back 12% from the high",
    });
  });

  it("Reviewed — no changes, regardless of the stored cadence prose", () => {
    expect(
      titleSegments(
        row({
          type: "REVIEWED",
          summary: "Reviewed HPE thesis — no changes (next review in 7d)",
        }),
      ),
    ).toEqual({ primary: "Reviewed", secondary: "no changes" });
  });

  it("Updated carries the compact change list; principal edits say so", () => {
    expect(
      titleSegments(
        row({
          type: "UPDATED",
          fieldChanges: {
            targetPrice: { from: 80, to: 95 },
            stopLoss: { from: 54, to: 62 },
          },
        }),
      ),
    ).toEqual({
      primary: "Updated",
      secondary: "target $80.00 → $95.00, stop $54.00 → $62.00",
    });
    expect(
      titleSegments(
        row({ type: "UPDATED", rationale: "[USER] Added a trigger" }),
      ).primary,
    ).toBe("Edited by you");
  });

  it("lifecycle rows: opened / closed / archived", () => {
    expect(
      titleSegments(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: { status: { from: "WATCHING", to: "HOLDING" } },
        }),
      ),
    ).toEqual({ primary: "Position opened", secondary: "watching → holding" });
    expect(
      titleSegments(
        row({
          type: "CLOSED",
          summary: "Closed XENE position on approved proposal — STOP",
        }),
      ),
    ).toEqual({ primary: "Position closed", secondary: "stop" });
    expect(
      titleSegments(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: {
            status: { from: "WATCHING", to: "RETIRED" },
            retiredReason: { from: null, to: "DROPPED" },
          },
        }),
      ),
    ).toEqual({ primary: "Archived", secondary: "dropped from watch" });
  });
});

describe("triggerPhrase", () => {
  it("strips deferral notes, signal suffixes, action clauses, tickers", () => {
    expect(
      triggerPhrase(
        "Scheduled review due on CYTK (HOLDING) — deferred to the next daily review",
      ),
    ).toBe("Scheduled review due");
    expect(
      triggerPhrase('Price above $817 — consider entry (signal: "Q2 beat")'),
    ).toBe("Price above $817");
    expect(triggerPhrase("Up 10% from entry — review")).toBe(
      "Up 10% from entry",
    );
  });
});

describe("updatedSecondary", () => {
  it("null on pre-fix empty diffs (title stays clean)", () => {
    expect(updatedSecondary(row({ fieldChanges: {} }))).toBeNull();
    expect(updatedSecondary(row({ fieldChanges: null }))).toBeNull();
  });

  it("says 'research refreshed' when only research sections moved", () => {
    expect(
      updatedSecondary(
        row({ fieldChanges: { snapshot: { from: "a", to: "b" } } }),
      ),
    ).toBe("research refreshed");
  });
});

describe("railDot", () => {
  it("green in, red out, amber for proposals that didn't trade", () => {
    expect(
      railDot(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: { status: { from: "WATCHING", to: "HOLDING" } },
        }),
      ),
    ).toBe("buy");
    expect(
      railDot(
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("ADD", 5) }),
      ),
    ).toBe("buy");
    expect(railDot(row({ type: "CLOSED" }))).toBe("sell");
    expect(
      railDot(
        row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("PARTIAL_CLOSE", 5),
        }),
      ),
    ).toBe("sell");
    expect(railDot(row({ type: "PROPOSAL_REJECTED" }))).toBe("proposal");
    expect(railDot(row({ type: "PROPOSAL_EXPIRED" }))).toBe("proposal");
    expect(railDot(row({ type: "PROPOSAL_PENDING" }))).toBe("proposal");
    expect(railDot(row({ type: "TRIGGER_FIRED" }))).toBeNull();
    expect(railDot(row({ type: "REVIEWED" }))).toBeNull();
  });
});

describe("fieldChangeLines", () => {
  it("renders exact from → to for plan scalars (the XENE 80→95 case)", () => {
    const lines = fieldChangeLines(
      row({
        fieldChanges: {
          targetPrice: { from: 80, to: 95 },
          stopLoss: { from: 54, to: 62 },
        },
      }),
    );
    expect(lines).toContain("Target $80.00 → $95.00");
    expect(lines).toContain("Stop $54.00 → $62.00");
  });
});

describe("triggerDiffLines", () => {
  const floor64 = {
    id: "t-floor",
    action: "EXIT",
    fireMode: "TACTICAL",
    predicate: { kind: "PRICE_BELOW", level: 64 },
  };
  const floor71 = { ...floor64, predicate: { kind: "PRICE_BELOW", level: 71 } };
  const trail8 = {
    id: "t-trail",
    action: "EXIT",
    fireMode: "TACTICAL",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 },
  };

  it('renders a level move as "before → after" (the floor 64 → 71 case)', () => {
    const lines = triggerDiffLines({
      from: [floor64, trail8],
      to: [floor71, trail8],
    });
    expect(lines).toEqual(["Price below $64 → Price below $71"]);
  });

  it("cancels id-churn: a rung re-minted with identical content is not a change", () => {
    const reMinted = [
      { ...floor64, id: "a2" },
      { ...trail8, id: "b2", rationale: "new words" },
    ];
    expect(triggerDiffLines({ from: [floor64, trail8], to: reMinted })).toEqual(
      [],
    );
  });

  it("renders nothing for the legacy non-array shapes", () => {
    expect(triggerDiffLines({ from: 11, to: 14 })).toEqual([]);
    expect(
      triggerDiffLines({ from: "WATCHING-set", to: "HELD-set" }),
    ).toEqual([]);
  });
});
