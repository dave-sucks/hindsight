/**
 * update-thesis.sold-review-replay.test.ts — DAV-240's two answers, through
 * the tool the run actually calls (DAV-311).
 *
 * This is the test that would have stopped #701 shipping a dead rule.
 *
 * #701 gave `checkWatchingOptOut` a RETIRED(SOLD) exemption and proved it with
 * a unit test that called `checkWatchingOptOut`. Green. In production
 * `update_thesis` calls `checkStatusTransition` first, that returned at the
 * terminal rule seven hundred lines earlier, and the exemption was
 * unreachable. SMMT was handed to the Catalyst Event PM on 2026-09-23, the run
 * tried twice to answer it, and was refused both times — with the suite green.
 *
 * DAV-308's own test file fixed the aim one level up, asserting through
 * `checkStatusTransition` rather than the helper. This goes the rest of the
 * way: through `update_thesis.execute`, the entry point the model reaches, so
 * the rule ordering, the audit write and the status patch are all live. Every
 * gate between the argument and the row runs for real; only the database and
 * the price vendor are doubled.
 *
 * Replay: SMMT, thesis cmtc1kp7o000l04ikm6kf9h1b, RETIRED/SOLD since
 * 2026-09-21 11:18 ET, on that morning's `sold_to_review` list. Refused at
 * 08:02:52 and again at 08:02:57 with `terminal_status`.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const SMMT_ID = "cmtc1kp7o000l04ikm6kf9h1b";

/** SMMT exactly as the run found it that morning. */
const smmt = (over: Record<string, unknown> = {}) =>
  thesisRow({
    id: SMMT_ID,
    ticker: "SMMT",
    status: "RETIRED",
    retiredReason: "SOLD",
    direction: "LONG",
    horizon: "CATALYST",
    catalystDate: new Date("2026-11-14T00:00:00Z"),
    closedAt: new Date("2026-09-21T15:18:44.281Z"),
    closeReason: "STOP",
    entryPrice: null,
    targetPrice: null,
    stopLoss: null,
    analystId: REPLAY_ANALYST_ID,
    ...over,
  });

describe("SMMT — the two answers the prompt asks for, through update_thesis", () => {
  it("lets it go: a rationale-only write on the sold row is accepted and recorded", async () => {
    // 08:02:52 ET — refused `terminal_status` on #701.
    const { refused, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt()] },
      args: {
        thesis_id: SMMT_ID,
        rationale:
          "Letting SMMT go. We banked +17.9% on the stop and the re-entry would be a fresh trade, not this one.",
      },
      quotes: { SMMT: 16.92 },
    });

    expect(refused).toBe(false);
    // The answer is on the record, which is the point — a review nobody can
    // write down is a review that did not happen.
    expect(db.store.thesisUpdate).toHaveLength(1);
    expect(db.store.thesisUpdate[0].thesisId).toBe(SMMT_ID);
  });

  it("puts it back on watch, and the terminal stamps come off", async () => {
    // 08:02:57 ET — refused `terminal_status` on #701.
    const { refused, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt()] },
      args: {
        thesis_id: SMMT_ID,
        change_status: "WATCHING",
        rationale:
          "Back on watch: the November 14 PDUFA is still ahead and we exited on price, not on the story.",
      },
      quotes: { SMMT: 16.92 },
    });

    expect(refused).toBe(false);
    const row = db.store.thesis.find((t) => t.id === SMMT_ID)!;
    expect(row.status).toBe("WATCHING");
    // An ordinary watch again — the five-minute check only scores WATCHING
    // rows, so a re-entry level is worthless if these survive.
    expect(row.retiredReason).toBeNull();
    expect(row.closedAt).toBeNull();
    expect(row.closeReason).toBeNull();
  });
});

describe("and the terminal gate still protects what it protected", () => {
  it("refuses a rationale-only write on a DROPPED row — that is editing history", async () => {
    const { refused, refusal } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt({ retiredReason: "DROPPED" })] },
      args: { thesis_id: SMMT_ID, rationale: "Second thoughts about a name we walked away from." },
    });
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("terminal_status");
  });

  it("refuses an INVALIDATED verb on the sold row", async () => {
    const { refused, refusal } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt()] },
      args: {
        thesis_id: SMMT_ID,
        change_status: "INVALIDATED",
        rationale: "Re-grading a closed trade after the fact.",
      },
    });
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("terminal_status");
  });

  it("refuses a PASSED row", async () => {
    const { refused, refusal } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [smmt({ status: "PASSED", retiredReason: null })] },
      args: { thesis_id: SMMT_ID, rationale: "Revisiting a pass." },
    });
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("terminal_status");
  });
});
