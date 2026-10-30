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
  proposalSpanSegments,
  toRow,
  dropRepeatedProse,
  relativeTimestamp,
  notAppliedLines,
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
    // Since 2026-10-06 your own edit's note is plain words; the row is marked in fieldChanges.
    expect(k("UPDATED", { source: { from: null, to: "USER" } }, "You added this trigger: Sell if below $150. It stands until you change it.")).toBe("edited-by-you");
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


describe("buildTimeline — each line itself, identical neighbours folded", () => {
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

  it("a fire and the review after it are two lines, as the agent reads them", () => {
    const items = buildTimeline([answer, fire], "all");
    expect(items.map((i) => i.kind)).toEqual(["event", "event"]);
  });

  it("folds ≥2 consecutive rows that print the same sentence; a row with prose never folds", () => {
    const due = (id: string, day: number) =>
      row({ id, type: "TRIGGER_FIRED", summary: "Scheduled review due on CYTK (HOLDING)", timestamp: `2026-08-${day}T12:00:00Z` });
    const items = buildTimeline([answer, due("q1", 17), due("q2", 16), fire], "all");
    expect(items.map((i) => i.kind)).toEqual(["event", "fold", "event"]);
    expect(toRow(items[1]).title.secondary).toBe("Scheduled review due ×2");
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

  it("a review shows its note without a click", () => {
    const reviewed = toRow({
      kind: "event",
      row: row({ type: "REVIEWED", rationale: "Nothing moved." }),
    });
    expect(reviewed.showDescription).toBe(true);
    expect(reviewed.description).toBe("Nothing moved.");
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

  it("a fold row carries one date, in the same field every other row uses", () => {
    const folded = toRow({
      kind: "fold",
      items: [
        { kind: "event", row: row({ id: "a", type: "REVIEWED", timestamp: "2026-08-14T12:00:00Z" }) },
        { kind: "event", row: row({ id: "b", type: "REVIEWED", timestamp: "2026-08-13T12:00:00Z" }) },
      ],
    });
    expect(folded.fold).toBe(true);
    expect(folded.when).toBe("Aug 14");
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

describe("prose is not printed twice in a row", () => {
  // ISRG: Proposed, then Expired, then the episode that staged it — all
  // three carry the ORIGINAL rationale, stacked.
  it("drops the repeat and keeps the row", () => {
    const same = "I am buying $ISRG here because the entry level confirmed.";
    // Not adjacent: the episode that staged the order sits between the
    // Proposed row and the Expired row, and all three carry the original.
    const out = dropRepeatedProse([
      { ...baseRow(), key: "proposed", description: same, showDescription: true },
      { ...baseRow(), key: "episode", description: "A different paragraph.", showDescription: true },
      { ...baseRow(), key: "expired", description: same, showDescription: true },
    ]);
    expect(out.map((r) => r.description)).toEqual([same, "A different paragraph.", null]);
    expect(out[2].showDescription).toBe(false);
    expect(out[2].key).toBe("expired");
  });
});

function baseRow() {
  return {
    key: "",
    type: "UPDATED",
    dot: "default" as const,
    title: { primary: "Updated", secondary: null },
    chips: [],
    price: null,
    description: null as string | null,
    quoted: false,
    showDescription: false,
    when: "",
    runId: null,
    orderId: null,
    fold: false,
  };
}

describe("a review that changed nothing still shows its note", () => {
  const show = (r: ReturnType<typeof row>) =>
    toRow({ kind: "event", row: r }).showDescription;

  it("a review that recorded nothing shows its paragraph — trigger or no trigger", () => {
    // Standalone: the review clock came round and the run wrote a
    // re-attestation.
    expect(show(row({ type: "REVIEWED", rationale: "Still holds." }))).toBe(true);
    expect(show(row({ type: "UPDATED", fieldChanges: {}, rationale: "Still holds." }))).toBe(true);
    // Answering a fire: same rule, via the episode's outcome.
    const items = buildTimeline(
      [
        row({ id: "r", type: "UPDATED", fieldChanges: {}, rationale: "Still holds.", timestamp: "2026-09-18T12:00:00Z" }),
        row({ id: "f", type: "TRIGGER_FIRED", summary: "Price below the 200-day — review", timestamp: "2026-09-17T13:35:00Z" }),
      ],
      "all",
    );
    expect(toRow(items[0]).showDescription).toBe(true);
  });

  it("a review that changed something still shows it", () => {
    expect(
      show(row({ type: "UPDATED", fieldChanges: { stopLoss: { from: 54, to: 62 } }, rationale: "Floor up." })),
    ).toBe(true);
  });

  it("a proposal shows its note", () => {
    expect(show(row({ type: "PROPOSAL_PROPOSED", fieldChanges: proposalFc("OPEN", 16), rationale: "I am buying here because…" }))).toBe(true);
  });
});

describe("what a call asked for and did not get", () => {
  // The ASML close-out: the note landed, "back to watching" did not (update_thesis's notApplied).
  const notApplied = {
    notApplied: { from: null, to: [{ field: "change_status", to: "WATCHING", why: "the position is still open", reason: "change_status: WATCHING puts back…" }] },
  };

  it("reads as one muted chip in plain words", () => {
    expect(notAppliedLines(row({ type: "REVIEWED", fieldChanges: notApplied }))).toEqual([
      { kind: "not-applied", text: "Not applied: back to watching — the position is still open" },
    ]);
    expect(notAppliedLines(row({ fieldChanges: { notApplied: { from: null, to: [{ field: "target_price", to: 2400, why: "you set it by hand at 8:05 AM" }] } } }))).toEqual([
      { kind: "not-applied", text: "Not applied: target $2400 — you set it by hand at 8:05 AM" },
    ]);
  });

  it("sits under the row, and the review is still a plain review", () => {
    const reviewed = row({ type: "REVIEWED", fieldChanges: notApplied });
    expect(toRow({ kind: "event", row: reviewed }).chips).toEqual([{ kind: "not-applied", text: "Not applied: back to watching — the position is still open" }]);
    expect(isPlainReview(reviewed)).toBe(true);
  });
});

// ── The owner's row design, 2026-10-30 ───────────────────────────────────────

import { isPlainReview, withPriceChanges } from "./thesis-timeline-utils";

describe("a plain review is titled Review; everything that happened keeps its own title", () => {
  it("a review, or an update that changed nothing, is plain", () => {
    expect(isPlainReview(row({ type: "REVIEWED", rationale: "Holding." }))).toBe(true);
    expect(isPlainReview(row({ type: "UPDATED", fieldChanges: {}, rationale: "Holding." }))).toBe(true);
  });

  it("a plan change, a fire, a proposal, your edit and your note are not", () => {
    expect(isPlainReview(row({ type: "UPDATED", fieldChanges: { triggerOps: { to: [{ op: "edit", text: "Stop $220 → $248" }] } } }))).toBe(false);
    expect(isPlainReview(row({ type: "UPDATED", fieldChanges: { targetPrice: { from: 80, to: 95 } } }))).toBe(false);
    expect(isPlainReview(row({ type: "TRIGGER_FIRED", summary: "Sell if below $868" }))).toBe(false);
    expect(isPlainReview(row({ type: "PROPOSAL_PROPOSED", fieldChanges: proposalFc("CLOSE", 9) }))).toBe(false);
    expect(isPlainReview(row({ type: "UPDATED", fieldChanges: { source: { to: "USER" }, triggerOps: { to: [{ op: "remove", text: "Removed: Review if above $52" }] } } }))).toBe(false);
    expect(isPlainReview(row({ type: "NOTE", rationale: "Holding into the report." }))).toBe(false);
  });
});

describe("each priced row carries its move from the row before it in time", () => {
  const at = (price: number | null, id: string) => toRow({ kind: "event", row: row({ id, type: "TRIGGER_FIRED", summary: "Sell if below $868", priceAtTime: price }) });

  it("newest first: the move is measured against the next older priced row; the oldest has none", () => {
    const rows = withPriceChanges([at(881.14, "a"), at(null, "b"), at(848.6, "c"), at(855.12, "d")]);
    expect(rows[0].priceChange).toEqual({ dollars: expect.closeTo(32.54, 2), pct: expect.closeTo(3.83, 2) });
    expect(rows[1].priceChange).toBeNull();
    expect(rows[2].priceChange).toEqual({ dollars: expect.closeTo(-6.52, 2), pct: expect.closeTo(-0.76, 2) });
    expect(rows[3].priceChange).toBeNull();
  });

  it("a row at the same price as the one before it shows no move, not a 0.00% up arrow", () => {
    const rows = withPriceChanges([at(848.6, "a"), at(848.6, "b"), at(850, "c")]);
    expect(rows[0].priceChange).toBeNull();
    expect(rows[1].priceChange).toEqual({ dollars: expect.closeTo(-1.4, 2), pct: expect.closeTo(-0.16, 2) });
  });

});
