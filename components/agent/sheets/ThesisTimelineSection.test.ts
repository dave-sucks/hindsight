/**
 * ThesisTimelineSection.test.ts — pins the Activity tab's pure helpers
 * (P1-33 slice 1, principal visual spec 2026-08-20):
 *
 *   - titleSegments: one consistent two-tone sentence per event —
 *     medium core ("Bought", "Trigger:") + light variable values
 *     ("10 shares at $832.84"). Stored summaries never render verbatim.
 *   - railDot: green = money in, red = money out, amber = proposal that
 *     didn't trade
 *   - ladderChangeLines: the trigger ops on a row, one chip each
 *
 * Fixtures mirror live production rows (XENE / EME / HPE arcs).
 */

import {
  titleSegments,
  triggerPhrase,
  updatedSecondary,
  dotFor,
  eventKind,
  ladderChangeLines,
  buildTimeline,
  outcomePhrase,
  groupTitle,
  proposalSpanSegments,
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

describe("one kind per row, then one table each", () => {
  // The stored type is not the event: STATUS_CHANGED is four of them and
  // UPDATED is two. eventKind resolves that ONCE; the title, the dot and the
  // prose-visible set all read the kind and never re-derive it.
  it("resolves the overloaded types", () => {
    const k = (type: string, fieldChanges?: unknown, rationale?: string) =>
      eventKind(row({ type, fieldChanges: fieldChanges as never, rationale: rationale as never }));
    expect(k("STATUS_CHANGED", { status: { from: "WATCHING", to: "HOLDING" } })).toBe("opened");
    expect(k("STATUS_CHANGED", { retiredReason: { to: "SOLD" } })).toBe("sold");
    expect(k("STATUS_CHANGED", { retiredReason: { to: "DROPPED" } })).toBe("dropped");
    expect(k("STATUS_CHANGED", { status: { to: "WATCHING" } })).toBe("back-to-watching");
    expect(k("UPDATED", {}, "The run's own words")).toBe("updated");
    expect(k("UPDATED", {}, "[USER] Principal set Price = 248")).toBe("edited-by-you");
  });

  it("green in, red out, amber for proposals that didn't trade", () => {
    expect(
      dotFor(
        row({
          type: "STATUS_CHANGED",
          fieldChanges: { status: { from: "WATCHING", to: "HOLDING" } },
        }),
      ),
    ).toBe("buy");
    expect(
      dotFor(
        row({ type: "PROPOSAL_APPROVED", fieldChanges: proposalFc("ADD", 5) }),
      ),
    ).toBe("buy");
    expect(dotFor(row({ type: "CLOSED" }))).toBe("sell");
    expect(
      dotFor(
        row({
          type: "PROPOSAL_APPROVED",
          fieldChanges: proposalFc("PARTIAL_CLOSE", 5),
        }),
      ),
    ).toBe("sell");
    expect(dotFor(row({ type: "PROPOSAL_REJECTED" }))).toBe("declined");
    expect(dotFor(row({ type: "PROPOSAL_EXPIRED" }))).toBe("declined");
    expect(dotFor(row({ type: "PROPOSAL_PROPOSED" }))).toBe("open-ask");
    expect(dotFor(row({ type: "TRIGGER_FIRED" }))).toBe("default");
    expect(dotFor(row({ type: "REVIEWED" }))).toBe("default");
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
    expect(g.fires[0].id).toBe("f1");
    expect(g.response.id).toBe("r1");
    expect(g.proposal?.id).toBe("order:o9:proposed");
    expect(outcomePhrase(g.response, g.proposal)).toBe("proposed sell");
    expect(
      groupTitle(g.fires[0], g.response, g.proposal).outcome,
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

  // The rule used to be "same triggerId or runId", which split the feed in
  // two. A REVIEW fire is deferred to the next daily review, and that run
  // writes its answer carrying neither id — ISRG's "price below the 200-day"
  // fired 9× between Sep 15 and Sep 25 and not one joined the 5 reviews that
  // answered it. One rule now: the next review answers it, ids or not.
  it("pairs a fire with the next review even when it shares no ids", () => {
    const other = { ...answer, triggerId: "t-other", runId: null };
    const items = buildTimeline([other, fire], "all");
    expect(items.map((i) => i.kind)).toEqual(["group"]);
  });

  // ISRG Sep 16 + Sep 17 fires, both answered by the Sep 18 morning review.
  it("one review answers every fire since the last one", () => {
    const r = (id: string, type: string, ts: string, summary = "") =>
      row({ id, type, timestamp: ts, summary });
    const items = buildTimeline(
      [
        r("resp", "UPDATED", "2026-09-18T12:06:00Z"),
        r("f2", "TRIGGER_FIRED", "2026-09-17T13:35:00Z", "Price below the 200-day — review"),
        r("f1", "TRIGGER_FIRED", "2026-09-16T13:35:00Z", "Price below the 200-day — review"),
      ],
      "all",
    );
    expect(items).toHaveLength(1);
    const g = items[0] as Extract<TimelineItem, { kind: "group" }>;
    expect(g.kind).toBe("group");
    expect(g.fires.map((f) => f.id)).toEqual(["f2", "f1"]);
    expect(toRow(g).title.secondary).toBe("Price below the 200-day ×2");
    expect(toRow(g).when).toBe("fired Sep 16 – 17 · answered Sep 18");
  });

  it("folds ≥2 consecutive identical check-ins; real fires stay visible", () => {
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
    const quiet3 = row({
      id: "q3",
      type: "REVIEWED",
      timestamp: "2026-08-15T12:00:00Z",
    });
    const quiet4 = row({
      id: "q4",
      type: "TRIGGER_FIRED",
      summary: "Scheduled review due on CYTK (HOLDING)",
      timestamp: "2026-08-14T12:00:00Z",
    });
    // quiet1+quiet2 and quiet3+quiet4 each pair into a quiet episode; two
    // quiet items in a row is what a cluster is made of.
    const items = buildTimeline(
      [answer, fire, quiet1, quiet2, quiet3, quiet4],
      "all",
    );
    // One rule folds them: two rows that print the same sentence. The
    // folded row keeps that sentence rather than a separate "N quiet
    // check-ins" vocabulary — it says which check-in repeated.
    expect(items.map((i) => i.kind)).toEqual(["group", "fold"]);
    const folded = toRow(items[1]);
    expect(folded.title.secondary).toBe("Scheduled review due ×2");
    expect(folded.title.outcome).toBe("— no change");
  });

  it("folds consecutive identical episodes into one ×N row (the CEG wall)", () => {
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
    expect(items[0].kind).toBe("fold");
    const rep = items[0] as Extract<TimelineItem, { kind: "fold" }>;
    expect(rep.items).toHaveLength(3);
    expect(toRow(rep).title.secondary).toBe("Price above $255 ×3");
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

  // One table, read top to bottom, keyed only on what the REVIEW did. The
  // kind of fire never enters into it — "passed" vs "held" was two words
  // for the one fact that nothing changed.
  it("no change — the review looked and left it alone", () => {
    expect(outcomePhrase(row({ type: "REVIEWED" }))).toBe("no change");
    expect(outcomePhrase(row({ type: "UPDATED", fieldChanges: {} }))).toBe(
      "no change",
    );
  });

  it("the same words whether an entry fire or an exit fire asked", () => {
    const review = row({ type: "REVIEWED" });
    expect(groupTitle(entryFire, review).outcome).toBe(
      groupTitle(exitFire, review).outcome,
    );
  });

  it("levels moved when a price level changed", () => {
    expect(
      outcomePhrase(
        row({ type: "UPDATED", fieldChanges: { stopLoss: { from: 54, to: 62 } } }),
      ),
    ).toBe("levels moved");
  });

  // ISRG Sep 23 removed the buy, the floor AND the target — the month's
  // biggest decision on the name, and it used to render "held".
  it("plan set down when the review removed rungs", () => {
    expect(
      outcomePhrase(
        row({
          type: "UPDATED",
          fieldChanges: {
            triggerOps: {
              to: [
                { op: "remove", text: "Removed: buy above $383" },
                { op: "remove", text: "Removed: sell below $325" },
              ],
            },
          },
        }),
      ),
    ).toBe("plan set down");
  });

  it("archived when the stock left the book", () => {
    expect(
      outcomePhrase(
        row({ type: "UPDATED", fieldChanges: { status: { to: "PASSED" } } }),
      ),
    ).toBe("archived");
  });

  it("groupTitle composes the full sentence with the decision medium-weight", () => {
    expect(groupTitle(entryFire, row({ type: "REVIEWED" }))).toEqual({
      primary: "Trigger:",
      secondary: "Price above $255",
      outcome: "— no change",
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

describe("ladderChangeLines — the chips are the ops the caller sent (DAV-242)", () => {
  // FLIPPED 2026-09-09: the chips used to be a diff of two whole lists with
  // id-churn cancelled — the replace-all write made visible. One op, one chip.
  it("one chip per op, in the words the op was written in", () => {
    const lines = ladderChangeLines(
      row({
        fieldChanges: {
          triggerOps: {
            from: null,
            to: [
              { op: "edit", id: "t-floor", text: "Stop $64 → $71 (tightened)" },
              { op: "remove", id: "t-old", text: "Removed: sell below $110" },
              { op: "add", id: "t-new", text: "Added: review every 14 days" },
            ],
          },
        },
      }),
    );
    expect(lines).toEqual([
      { kind: "edit", text: "Stop $64 → $71 (tightened)" },
      { kind: "remove", text: "Removed: sell below $110" },
      { kind: "add", text: "Added: review every 14 days" },
    ]);
  });

  it("renders nothing for rows from before ops (a whole-list diff, or a count)", () => {
    expect(ladderChangeLines(row({ fieldChanges: { triggers: { from: [], to: [{ id: "x" }] } } }))).toEqual([]);
    expect(ladderChangeLines(row({ fieldChanges: { triggers: { from: 11, to: 14 } } }))).toEqual([]);
  });

  it("each change prints once: the op as a chip, everything else in the clause", () => {
    const u = row({
      fieldChanges: {
        triggerOps: { from: null, to: [{ op: "edit", id: "buy", text: "Entry $183 → $190" }] },
        entryPrice: { from: 183, to: 190 },
        conviction: { from: "MEDIUM", to: "HIGH" },
      },
    });
    // The op renders as a chip under the title; naming it here too printed
    // the same change twice — visible on CEG as "Edited by you Stop $220 →
    // $248" above a chip reading "Stop $220 → $248".
    expect(updatedSecondary(u)).toBe("conviction MEDIUM → HIGH");
    expect(ladderChangeLines(u).map((o) => o.text)).toEqual([
      "Entry $183 → $190",
    ]);
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
        fieldChanges: { targetPrice: { from: 120, to: 130 } },
        rationale: "Target heal.",
      }),
    });
    expect(updated.title.secondary).toBe("target $120.00 → $130.00");
    expect(updated.chips).toEqual([]); // the duplicate sub-row is gone
  });

  it("ladder edits become typed changes (add / remove / edit)", () => {
    const withLadder = toRow({
      kind: "event",
      row: row({
        type: "UPDATED",
        fieldChanges: {
          triggerOps: { from: null, to: [{ op: "add", id: "t1", text: "Added: sell below $64" }] },
        },
      }),
    });
    expect(withLadder.chips).toEqual([
      { kind: "add", text: "Added: sell below $64" },
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

  it("a fold row says when it spans, in the same field every other row uses", () => {
    const folded = toRow({
      kind: "fold",
      items: [
        { kind: "event", row: row({ id: "a", type: "REVIEWED", timestamp: "2026-08-14T12:00:00Z" }) },
        { kind: "event", row: row({ id: "b", type: "REVIEWED", timestamp: "2026-08-13T12:00:00Z" }) },
      ],
    });
    expect(folded.fold).toBe(true);
    expect(folded.when).toBe("Aug 13 – 14");
    expect(folded.title.secondary).toBe("no changes ×2");
  });

  // A row with its own write-up is never "the same row twice".
  it("never folds rows that carry prose", () => {
    const items = buildTimeline(
      [
        row({ id: "a", type: "UPDATED", rationale: "First paragraph.", timestamp: "2026-08-14T12:00:00Z" }),
        row({ id: "b", type: "UPDATED", rationale: "Second paragraph.", timestamp: "2026-08-13T12:00:00Z" }),
      ],
      "all",
    );
    expect(items.map((i) => i.kind)).toEqual(["event", "event"]);
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

// ── The sheet header leads with the latest note (DAV-304) ────────────────────
// The header does not get its own grammar: it calls `titleSegments` on the one
// most recent ThesisUpdate row, exactly as the timeline does for every row.
// Replay: SMMT's real top-of-log row on 2026-09-21 — the +$1,157.94 sale —
// and ETN's, the "full — waiting" review that changed nothing.
describe("the most recent durable event, worded once", () => {
  it("SMMT's sale reads as a sale", () => {
    const smmt = row({
      id: "cmube4bxw000204kxgvatmgdb",
      type: "PROPOSAL_APPROVED",
      timestamp: "2026-09-21T15:18:44.852Z",
      summary: "Approved CLOSE on SMMT — submitted to Alpaca (idem=63d4c566)",
      priceAtTime: null,
      fieldChanges: {
        proposal: {
          from: { status: "AWAITING_APPROVAL", orderId: "cmubdn37i000d04jv1ky7jip0", quantity: 450 },
          to: {
            intent: "CLOSE",
            status: "APPROVED",
            orderId: "cmubdn37i000d04jv1ky7jip0",
            quantity: 450,
          },
        },
      },
    });
    expect(titleSegments(smmt)).toEqual({ primary: "Sold", secondary: "450 shares" });
  });

  it("ETN's review that changed nothing still says a run looked", () => {
    const etn = row({
      id: "cmub7cjb4002b04l8u3e4moti",
      type: "UPDATED",
      timestamp: "2026-09-21T12:09:10.336Z",
      summary: "Updated ETN thesis",
      priceAtTime: 424.77,
      fieldChanges: {},
    });
    expect(titleSegments(etn).primary).toBe("Updated");
  });
});
