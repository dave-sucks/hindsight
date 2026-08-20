/**
 * ThesisTimelineSection.test.ts — pins the Activity tab's pure rendering
 * helpers (P1-33 slice 1) against real production data shapes:
 *
 *   - outcomeChip: one at-a-glance verdict per row (Bought / Sold /
 *     Declined / Approved / Expired / Trigger fired / Level moved)
 *   - fieldChangeLines: exact "Target $80.00 → $95.00" lines
 *   - triggerDiffLines: per-rung ladder diff ("floor 64 → 71"), tolerant
 *     of the legacy non-array shapes older rows carry
 *
 * Fixtures mirror the live XENE thesis (July 2026 arc) — the motivating
 * case for the tab.
 */

import {
  outcomeChip,
  fieldChangeLines,
  railDot,
  triggerDiffLines,
} from "./thesis-timeline-utils";

// Minimal row factory matching the component's ThesisUpdate shape.
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

// Proposal fieldChanges shape as the updates route synthesizes it.
function proposalFc(intent: string) {
  return { proposal: { to: { intent } } };
}

describe("outcomeChip", () => {
  it("splits approvals into buy-side (green) and sell-side (red) off the intent", () => {
    expect(
      outcomeChip(
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("OPEN") }),
      ),
    ).toEqual({ label: "Approved buy", variant: "positive" });
    expect(
      outcomeChip(
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("CLOSE") }),
      ),
    ).toEqual({ label: "Approved sell", variant: "negative" });
    // No stored intent (legacy row) → neutral label, never a guess.
    expect(outcomeChip(row({ type: "PROPOSAL_APPROVED" }))).toEqual({
      label: "Approved",
      variant: "default",
    });
  });

  it("labels the other proposal outcomes", () => {
    expect(outcomeChip(row({ type: "PROPOSAL_REJECTED" }))).toEqual({
      label: "Declined",
      variant: "destructive",
    });
    expect(outcomeChip(row({ type: "PROPOSAL_EXPIRED" }))?.label).toBe(
      "Expired",
    );
    expect(outcomeChip(row({ type: "PROPOSAL_PENDING" }))?.label).toBe(
      "Awaiting review",
    );
  });

  it("labels buys and sells off the status transition, in money colors", () => {
    expect(
      outcomeChip(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: { status: { from: "WATCHING", to: "HOLDING" } },
        }),
      ),
    ).toEqual({ label: "Bought", variant: "positive" });
    expect(outcomeChip(row({ type: "CLOSED" }))).toEqual({
      label: "Sold",
      variant: "negative",
    });
    expect(
      outcomeChip(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: {
            status: { from: "HOLDING", to: "RETIRED" },
            retiredReason: { from: null, to: "SOLD" },
          },
        }),
      ),
    ).toEqual({ label: "Sold", variant: "negative" });
  });

  it("marks level moves and trigger fires; stays quiet on routine reviews", () => {
    expect(
      outcomeChip(
        row({
          type: "UPDATED",
          fieldChanges: { stopLoss: { from: 54, to: 62 } },
        }),
      )?.label,
    ).toBe("Level moved");
    expect(outcomeChip(row({ type: "TRIGGER_FIRED" }))).toEqual({
      label: "Trigger fired",
      variant: "warning",
    });
    expect(outcomeChip(row({ type: "REVIEWED" }))).toBeNull();
    expect(outcomeChip(row({ type: "UPDATED" }))).toBeNull();
  });
});

describe("railDot", () => {
  it("greens money-in rows and reds money-out rows, gray otherwise", () => {
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
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("ADD") }),
      ),
    ).toBe("buy");
    expect(railDot(row({ type: "CLOSED" }))).toBe("sell");
    expect(
      railDot(
        row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("PARTIAL_CLOSE"),
        }),
      ),
    ).toBe("sell");
    expect(railDot(row({ type: "TRIGGER_FIRED" }))).toBeNull();
    expect(railDot(row({ type: "PROPOSAL_REJECTED" }))).toBeNull();
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

  it("renders composite movement from the scoring diff", () => {
    const lines = fieldChangeLines(
      row({
        fieldChanges: {
          scoring: { from: { composite: 6 }, to: { composite: 8 } },
        },
      }),
    );
    expect(lines).toContain("Composite 6 → 8/10");
  });

  it("returns nothing for null/absent fieldChanges", () => {
    expect(fieldChangeLines(row({ fieldChanges: null }))).toEqual([]);
    expect(fieldChangeLines(row({ fieldChanges: {} }))).toEqual([]);
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
    const lines = triggerDiffLines({ from: [floor64, trail8], to: [floor71, trail8] });
    expect(lines).toEqual(["Price below $64 → Price below $71"]);
  });

  it("renders added and removed rungs with +/− prefixes", () => {
    const lines = triggerDiffLines({ from: [floor64], to: [floor64, trail8] });
    expect(lines).toEqual(["+ Gives back 8% from the high → exit"]);
    const gone = triggerDiffLines({ from: [floor64, trail8], to: [floor64] });
    expect(gone).toEqual(["− Gives back 8% from the high → exit"]);
  });

  it("ignores rationale/cooldown/lastFiredAt churn", () => {
    const noisy = {
      ...trail8,
      rationale: "new words",
      cooldownDays: 3,
      lastFiredAt: "2026-07-13T13:40:00Z",
    };
    expect(triggerDiffLines({ from: [trail8], to: [noisy] })).toEqual([]);
  });

  it("cancels id-churn: a rung re-minted with a fresh id but identical content is not a change (the Aug 12 EME case)", () => {
    // Agent wholesale-replaced the ladder, minting new ids for every rung.
    // Content-identical pairs must pair off; only the real change survives.
    const beatOld = {
      id: "old-beat",
      action: "REVIEW",
      predicate: { kind: "EARNINGS_BEAT", minSurprisePct: 5 },
    };
    const beatNew = { ...beatOld, id: "new-beat", rationale: "reworded" };
    const floorOld = floor64;
    const floorNew = { ...floor71, id: "fresh-floor-id" };
    const lines = triggerDiffLines({
      from: [beatOld, floorOld],
      to: [beatNew, floorNew],
    });
    // The re-minted-but-identical beat rung vanishes; the floor move shows
    // as an add+remove pair (different content, different ids).
    expect(lines).toEqual([
      "+ Price below $71 → exit",
      "− Price below $64 → exit",
    ]);
  });

  it("renders nothing when a fresh-id ladder is content-identical end to end", () => {
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
    expect(triggerDiffLines({ from: null, to: { note: "backfill" } })).toEqual(
      [],
    );
  });

  it("skips rungs with unknown predicate shapes instead of lying", () => {
    const legacy = {
      id: "t-legacy",
      action: "ENTER",
      condition: { type: "PRICE_ABOVE", value: 110 },
    };
    // Added legacy rung: falls back to kind/action label, never "undefined".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = triggerDiffLines({ from: [], to: [legacy as any] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("undefined");
  });
});
