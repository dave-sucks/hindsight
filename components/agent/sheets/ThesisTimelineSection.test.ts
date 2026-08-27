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
 *
 * Fixtures mirror live production rows (XENE / EME / HPE arcs).
 */

import {
  titleSegments,
  triggerPhrase,
  updatedSecondary,
  railDot,
  triggerDiffLines,
  buildTimeline,
  outcomePhrase,
  groupTitle,
  proposalSpanSegments,
  clusterLabel,
  toRow,
  relativeTimestamp,
  type TimelineItem,
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
        row({
          type: "PROPOSAL_PROPOSED",
          fieldChanges: {
            proposal: {
              to: { intent: "OPEN", quantity: 10, status: "AWAITING_APPROVAL" },
            },
          },
        }),
      ),
    ).toEqual({
      primary: "Proposed",
      secondary: "buy 10 shares — awaiting your review",
    });
    // Decided proposal's anchor row: no "awaiting" clause.
    expect(
      titleSegments(
        row({
          type: "PROPOSAL_PROPOSED",
          fieldChanges: proposalFc("CLOSE", 75),
        }),
      ),
    ).toEqual({ primary: "Proposed", secondary: "sell 75 shares" });
  });
});

describe("titleSegments — the rest of the grammar", () => {
  it("Trigger: <condition> with the action clause and ticker stripped", () => {
    expect(
      titleSegments(
        row({
          type: "TRIGGER_FIRED",
          summary: "Trailing 12% from high — exit position",
        }),
      ),
    ).toEqual({
      primary: "Trigger:",
      secondary: "Trailing 12% from high",
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
    expect(railDot(row({ type: "PROPOSAL_PROPOSED" }))).toBe("proposed");
    expect(railDot(row({ type: "TRIGGER_FIRED" }))).toBeNull();
    expect(railDot(row({ type: "REVIEWED" }))).toBeNull();
  });
});

describe("buildTimeline", () => {
  // Newest-first, like the API returns.
  const fire = row({
    id: "f1",
    type: "TRIGGER_FIRED",
    triggerId: "t1",
    summary: "Trailing 12% from high — exit position",
    timestamp: "2026-08-18T11:10:00Z",
  });
  const answer = row({
    id: "r1",
    type: "UPDATED",
    triggerId: "t1",
    timestamp: "2026-08-18T11:10:30Z",
  });

  it("nests an adjacent fire + its response into one group", () => {
    const items = buildTimeline([answer, fire], "all");
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("group");
  });

  it("pairs across an interleaved Proposed row, keeping it as its own step", () => {
    // Tactical fires → proposes the sell (Proposed lands between) → writes
    // its close-out update. The fire pairs with the update and READS the
    // proposal for its verb ("— proposed sell", never "— passed"), but the
    // Proposed row stays visible: staging an order is its own moment
    // (principal, 2026-08-21).
    const proposed = row({
      id: "order:o9:proposed",
      type: "PROPOSAL_PROPOSED",
      fieldChanges: proposalFc("CLOSE", 100),
      timestamp: "2026-08-19T11:16:00Z",
    });
    const items = buildTimeline([answer, proposed, fire], "all");
    expect(items.map((i) => i.kind)).toEqual(["group", "event"]);
    const g = items[0] as Extract<TimelineItem, { kind: "group" }>;
    expect(g.fire.id).toBe("f1");
    expect(g.response.id).toBe("r1");
    expect(g.proposal?.id).toBe("order:o9:proposed");
    expect(outcomePhrase(g.fire, g.response, g.proposal)).toBe("proposed sell");
    expect(
      groupTitle(g.fire, g.response, g.proposal).outcome,
    ).toBe("— proposed sell");
  });

  it("strings the dashed span from the Proposed step to its outcome", () => {
    const sold = row({ id: "order:o9:approved", type: "PROPOSAL_APPROVED" });
    const proposed = row({
      id: "order:o9:proposed",
      type: "PROPOSAL_PROPOSED",
      fieldChanges: proposalFc("CLOSE", 100),
    });
    const items = buildTimeline([sold, answer, proposed, fire], "all");
    // [Sold event, trigger episode, Proposed event]
    expect(items.map((i) => i.kind)).toEqual(["event", "group", "event"]);
    // Segments under rows 0 and 1 connect Sold ← … ← Proposed.
    expect(proposalSpanSegments(items)).toEqual(new Set([0, 1]));
  });

  it("does not nest across unrelated triggerIds/runs", () => {
    const other = { ...answer, triggerId: "t-other", runId: null };
    const items = buildTimeline([other, fire], "all");
    expect(items.map((i) => i.kind)).toEqual(["event", "event"]);
  });

  it("folds ≥2 consecutive quiet rows into a cluster; real fires stay visible", () => {
    const quiet1 = row({
      id: "q1",
      type: "REVIEWED",
      timestamp: "2026-08-17T12:00:00Z",
    });
    const quiet2 = row({
      id: "q2",
      type: "TRIGGER_FIRED",
      summary: "Scheduled review due on CYTK (HOLDING)",
      timestamp: "2026-08-16T12:00:00Z",
    });
    const items = buildTimeline([answer, fire, quiet1, quiet2], "all");
    expect(items.map((i) => i.kind)).toEqual(["group", "cluster"]);
    const label = clusterLabel(
      (items[1] as Extract<TimelineItem, { kind: "cluster" }>).items,
    );
    expect(label.label).toBe("2 quiet check-ins");
  });

  it("folds consecutive identical episodes into one ×N repeat row (the CEG wall)", () => {
    // Same ENTER rung re-fires daily, same "passed" outcome each time.
    const mk = (day: number, trig: string, resp: string) => [
      row({
        id: resp,
        type: "UPDATED",
        triggerId: "t-enter",
        fieldChanges: {},
        timestamp: `2026-08-0${day}T09:45:00Z`,
      }),
      row({
        id: trig,
        type: "TRIGGER_FIRED",
        triggerId: "t-enter",
        summary: "Price above $255 — consider entry",
        timestamp: `2026-08-0${day}T09:40:00Z`,
      }),
    ];
    const rows = [...mk(7, "f3", "r3"), ...mk(6, "f2", "r2"), ...mk(5, "f1", "r1")];
    const items = buildTimeline(rows, "all");
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("repeat");
    const rep = items[0] as Extract<TimelineItem, { kind: "repeat" }>;
    expect(rep.episodes).toHaveLength(3);
  });

  it("does not fold episodes whose decision differs", () => {
    const fired = (id: string, day: number) =>
      row({
        id,
        type: "TRIGGER_FIRED",
        triggerId: "t-enter",
        summary: "Price above $255 — consider entry",
        timestamp: `2026-08-0${day}T09:40:00Z`,
      });
    const rows = [
      row({
        id: "r-raise",
        type: "UPDATED",
        triggerId: "t-enter",
        fieldChanges: { stopLoss: { from: 54, to: 62 } },
        timestamp: "2026-08-07T09:45:00Z",
      }),
      fired("f-b", 7),
      row({
        id: "r-pass",
        type: "UPDATED",
        triggerId: "t-enter",
        fieldChanges: {},
        timestamp: "2026-08-06T09:45:00Z",
      }),
      fired("f-a", 6),
    ];
    const items = buildTimeline(rows, "all");
    expect(items.map((i) => i.kind)).toEqual(["group", "group"]);
  });

  it("money filter keeps only proposal/lifecycle rows", () => {
    const bought = row({
      id: "b1",
      type: "PROPOSAL_APPROVED",
      fieldChanges: proposalFc("OPEN", 10),
    });
    const items = buildTimeline([answer, fire, bought], "money");
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("event");
  });
});

describe("trigger episodes — one sentence, fire + decision", () => {
  const exitFire = row({
    type: "TRIGGER_FIRED",
    summary: "Trailing 12% from high — exit position",
  });
  const entryFire = row({
    type: "TRIGGER_FIRED",
    summary: "Price above $255 — consider entry",
  });

  it("held for an exit fire answered without action", () => {
    expect(outcomePhrase(exitFire, row({ type: "REVIEWED" }))).toBe("held");
  });

  it("passed for an entry fire answered without a buy", () => {
    expect(
      outcomePhrase(entryFire, row({ type: "UPDATED", fieldChanges: {} })),
    ).toBe("passed");
  });

  it("raised floor to $X when the stop moved up", () => {
    expect(
      outcomePhrase(
        exitFire,
        row({
          type: "UPDATED",
          fieldChanges: { stopLoss: { from: 54, to: 62 } },
        }),
      ),
    ).toBe("raised floor to $62.00");
  });

  it("groupTitle composes the full sentence with the decision medium-weight", () => {
    expect(groupTitle(entryFire, row({ type: "REVIEWED" }))).toEqual({
      primary: "Trigger:",
      secondary: "Price above $255",
      outcome: "— passed",
    });
  });
});

describe("proposalSpanSegments", () => {
  it("tints the rail between a Proposed anchor and its outcome", () => {
    const bought = row({ id: "order:o1:approved", type: "PROPOSAL_APPROVED" });
    const between = row({ id: "x", type: "REVIEWED" });
    const proposed = row({ id: "order:o1:proposed", type: "PROPOSAL_PROPOSED" });
    const items: TimelineItem[] = [
      { kind: "event", row: bought },
      { kind: "event", row: between },
      { kind: "event", row: proposed },
    ];
    expect(proposalSpanSegments(items)).toEqual(new Set([0, 1]));
  });

  it("no span for a still-awaiting proposal (nothing to connect yet)", () => {
    const proposed = row({ id: "order:o2:proposed", type: "PROPOSAL_PROPOSED" });
    expect(
      proposalSpanSegments([{ kind: "event", row: proposed }]),
    ).toEqual(new Set());
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
    expect(lines).toEqual([
      { kind: "edit", text: "Price below $64 → Price below $71" },
    ]);
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

describe("toRow — one shape for every item", () => {
  it("Bought/Sold show their description without a click (principal ask)", () => {
    const bought = toRow({
      kind: "event",
      row: row({
        type: "PROPOSAL_APPROVED",
        fieldChanges: proposalFc("OPEN", 37),
        priceAtTime: 183.83,
        rationale: "Entry trigger validated; structure intact.",
      }),
    });
    expect(bought.title).toEqual({
      primary: "Bought",
      secondary: "37 shares at $183.83",
    });
    expect(bought.showDescription).toBe(true);
    expect(bought.description).toBe("Entry trigger validated; structure intact.");
    expect(bought.dot).toBe("buy");
  });

  it("quiet types keep their prose until asked", () => {
    const reviewed = toRow({
      kind: "event",
      row: row({ type: "REVIEWED", rationale: "Nothing moved." }),
    });
    expect(reviewed.showDescription).toBe(false);
    expect(reviewed.description).toBe("Nothing moved."); // available on click
  });

  it("every transaction shows its reasoning, proposals included", () => {
    for (const type of [
      "PROPOSAL_PROPOSED",
      "PROPOSAL_APPROVED",
      "PROPOSAL_REJECTED",
      "PROPOSAL_EXPIRED",
      "STATUS_CHANGED",
      "CLOSED",
    ]) {
      expect(
        toRow({ kind: "event", row: row({ type, rationale: "why" }) })
          .showDescription,
      ).toBe(true);
    }
  });

  it("never repeats scalar edits below a title that already names them", () => {
    const updated = toRow({
      kind: "event",
      row: row({
        type: "UPDATED",
        fieldChanges: { targetSizePct: { from: 4, to: 6.5 } },
        rationale: "Sizing heal.",
      }),
    });
    expect(updated.title.secondary).toBe("size 4% → 6.5%");
    expect(updated.chips).toEqual([]); // the duplicate sub-row is gone
  });

  it("ladder edits become typed changes (add / remove / edit)", () => {
    const withLadder = toRow({
      kind: "event",
      row: row({
        type: "UPDATED",
        fieldChanges: {
          triggers: {
            from: [],
            to: [
              {
                id: "t1",
                action: "EXIT",
                predicate: { kind: "PRICE_BELOW", level: 64 },
              },
            ],
          },
        },
      }),
    });
    expect(withLadder.chips).toEqual([
      { kind: "add", text: "Price below $64 → exit" },
    ]);
  });

  it("the principal's rejection note is quoted; [USER] markers are stripped", () => {
    const declined = toRow({
      kind: "event",
      row: row({
        type: "PROPOSAL_REJECTED",
        fieldChanges: {
          proposal: { to: { intent: "CLOSE", quantity: 75, userMessage: "Holding this one." } },
        },
      }),
    });
    expect(declined.quoted).toBe(true);
    expect(declined.description).toBe("Holding this one.");

    const edit = toRow({
      kind: "event",
      row: row({ type: "UPDATED", rationale: "[USER] Set the floor at $64." }),
    });
    expect(edit.quoted).toBe(false);
    expect(edit.description).toBe("Set the floor at $64.");
  });

  it("fold rows carry a range label instead of a timestamp", () => {
    const cluster = toRow({
      kind: "cluster",
      items: [
        { kind: "event", row: row({ id: "a", type: "REVIEWED", timestamp: "2026-08-14T12:00:00Z" }) },
        { kind: "event", row: row({ id: "b", type: "REVIEWED", timestamp: "2026-08-13T12:00:00Z" }) },
      ],
    });
    expect(cluster.fold).toBe(true);
    expect(cluster.timestamp).toBeNull();
    expect(cluster.rangeLabel).toBe("Aug 13 – 14");
    expect(cluster.title.secondary).toBe("2 quiet check-ins");
  });
});

describe("relativeTimestamp — precision decays with age", () => {
  const now = new Date("2026-08-21T15:00:00Z");
  const at = (iso: string) => relativeTimestamp(iso, now);

  it("uses minutes then hours within the same day", () => {
    expect(at("2026-08-21T14:59:30Z")).toBe("now");
    expect(at("2026-08-21T14:45:00Z")).toBe("15m");
    expect(at("2026-08-21T12:00:00Z")).toBe("3h");
  });

  it("names yesterday, then the weekday, for the last week", () => {
    expect(at("2026-08-20T12:00:00Z")).toMatch(/^Yesterday /);
    // 4 days back → weekday + clock, not a bare date.
    expect(at("2026-08-17T12:00:00Z")).toMatch(/^[A-Z][a-z]{2} /);
  });

  it("falls back to a bare date past a week, with the year when it differs", () => {
    expect(at("2026-08-01T12:00:00Z")).toBe("Aug 1");
    expect(at("2025-11-03T12:00:00Z")).toBe("Nov 3, 2025");
  });
});

describe("price on the row model", () => {
  it("carries the quote, except on trade rows whose title already shows it", () => {
    expect(
      toRow({
        kind: "event",
        row: row({ type: "TRIGGER_FIRED", priceAtTime: 186.45 }),
      }).price,
    ).toBe(186.45);
    // "Bought 37 shares at $183.83" — no second copy on the right.
    expect(
      toRow({
        kind: "event",
        row: row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("OPEN", 37),
          priceAtTime: 183.83,
        }),
      }).price,
    ).toBeNull();
  });
});

describe("triggers filter keeps episodes intact", () => {
  it("retains the response rows so decisions survive the filter", () => {
    const fire = row({
      id: "f1",
      type: "TRIGGER_FIRED",
      triggerId: "t1",
      summary: "Price above $255 — consider entry",
      timestamp: "2026-08-18T11:10:00Z",
    });
    const answer = row({
      id: "r1",
      type: "UPDATED",
      triggerId: "t1",
      fieldChanges: {},
      timestamp: "2026-08-18T11:10:30Z",
    });
    const unrelated = row({ id: "x", type: "REVIEWED", triggerId: null });
    const items = buildTimeline([answer, fire, unrelated], "triggers");
    expect(items.map((i) => i.kind)).toEqual(["group"]);
  });
});
