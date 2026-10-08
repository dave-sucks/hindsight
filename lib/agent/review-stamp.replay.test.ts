/**
 * review-stamp.replay.test.ts — a review that changes nothing is recorded
 * as a review, and a fired buy answered by one lets the run finish.
 *
 * From 2026-08-25 update_thesis put the review stamp (`lastReviewedAt`) into
 * every patch, so no call was ever "no change": runs wrote no REVIEWED row
 * for six weeks, and complete_run's bars that a review must not clear
 * cleared on any call. The stamp is when we looked, not a change.
 *
 * The fired-buy bar is deleted rather than revived: a buy a run passes on
 * comes back on the next morning run as a plan flag or a live match, and
 * re-arms on its next crossing. The declined-sale bar stays (see
 * declined-sale.replay.test.ts, case 4).
 *
 * Production: ETN 2026-09-18 09:45 ET. Its buy ("Price above $418") fired at
 * $418.61 while the Secular Compounder held 4 of its 4 slots (ABT, ASML,
 * CEG, WST). Trigger run cmu70gouf000004l7cu3mcbuw. place_trade was refused
 * at the limit, and the run closed out with the update_thesis call replayed
 * here, argument for argument.
 */
import {
  replayTool,
  thesisRow,
  positionRow,
  agentConfigRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";
import type { Row } from "@/lib/replay/prisma-double";

const FIRED_AT = new Date("2026-09-18T13:45:22.523Z");
const AT = new Date("2026-09-18T13:45:38.000Z");
const PRICE = 418.61;
const ENTER_ID = "d2580188-96ad-4d0f-ad03-d8fa29e89ccd";
const THESIS_ID = "cmqeg5hyu000a04l1jsoavysc";

/** The ladder the run read: buy above $418, floor $355, target $560, the 30-day review. */
const LADDER = [
  {
    id: ENTER_ID,
    action: "ENTER",
    source: "AGENT",
    predicate: { watch: "price", is: "above", value: 418 },
    rationale:
      "Buy on a clean breakout above the recent repair range near $418, which would confirm the pullback has ended and the secular datacenter/electrical thesis is re-asserting.",
    cooldownDays: 1,
    lastFiredAt: FIRED_AT.toISOString(),
  },
  {
    id: "4c2973c3-0d36-4600-9f04-97ea589d57be",
    action: "EXIT",
    source: "DEFAULT",
    predicate: { watch: "price", is: "below", value: 355 },
    rationale: "Floor — sell if the price drops to $355.00. Below this the plan is wrong.",
    cooldownDays: 1,
  },
  {
    id: "96d88edd-0439-4d85-9995-c86256c55692",
    action: "REVIEW",
    source: "DEFAULT",
    predicate: { watch: "price", is: "above", value: 560 },
    rationale: "Target $560.00 — decide here: take it, trim it, or raise the target.",
    cooldownDays: 1,
  },
  {
    id: "721b083f-6ca8-47c6-bd1c-60cc63d7759c",
    action: "REVIEW",
    source: "DEFAULT",
    predicate: { watch: "repeat", value: 30 },
    rationale: "Look at this every 30 days, counting from the last real review.",
    cooldownDays: 30,
  },
];

/** The fire, as its row in the audit table. */
const FIRE_LINE = { id: "fire_etn", thesisId: THESIS_ID, type: "TRIGGER_FIRED", triggerId: ENTER_ID, timestamp: FIRED_AT, runId: REPLAY_RUN_ID, rationale: null, fieldChanges: {} };

/** The run's own close-out call, verbatim from its thread. */
const CLOSE_OUT = {
  thesis_id: THESIS_ID,
  trigger_id: ENTER_ID,
  price_at_time: PRICE,
  rationale:
    "$ETN's entry trigger validated and I attempted to promote it, but the trade could not be opened because the strategy is already at its 4-position cap. The live quote still held the trigger at $418.61, price was back above the 50-day average at $415.49, and I saw no contradicting company-specific headline. Core belief remains operative: no guidance cut, no evidence of Electrical Americas margin breakdown, and no management-instability signal. Ladder intact: entry confirmation remains valid, floor $355 still under the thesis break level, and target $560 still matches the multi-year compounding case.",
  structural_unchanged_reason:
    "The underlying business thesis is unchanged; this was an execution constraint, not a change in Eaton's fundamentals or setup.",
};

const etn = () =>
  thesisRow({
    id: THESIS_ID,
    ticker: "ETN",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    setupId: "COMPOUNDER_ACCUMULATION",
    entryPrice: 418,
    targetPrice: 560,
    stopLoss: 355,
    triggers: LADDER,
    createdAt: new Date("2026-06-15T00:00:07.734Z"),
    researchUpdatedAt: new Date("2026-09-03T00:03:01.301Z"),
    lastReviewedAt: new Date("2026-09-14T13:30:41.113Z"),
  });

/** What it held at 09:45 — four open, all opened before the fire. */
const HELD = [
  ["CEG", "2026-08-13T14:26:27.706Z"],
  ["WST", "2026-08-20T19:55:54.453Z"],
  ["ASML", "2026-09-04T14:23:33.865Z"],
  ["ABT", "2026-09-11T13:36:00.482Z"],
].map(([symbol, openedAt]) => positionRow({ id: `pos_${symbol}`, symbol, openedAt: new Date(openedAt) }));

const tacticalRun = () => ({
  id: REPLAY_RUN_ID,
  status: "RUNNING",
  mode: "INTRADAY_TACTICAL",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: { action: "ENTER", ticker: "ETN", thesisId: THESIS_ID, triggerId: ENTER_ID, triggeredBy: "trigger-fired" },
  startedAt: FIRED_AT,
  completedAt: null,
});

const fakeClock = (at: Date) =>
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

const CTX = { runMode: "INTRADAY_TACTICAL", maxOpenPositions: 4 };

function seedWith(held: Row[]) {
  return {
    researchRun: [tacticalRun()],
    thesis: [etn()],
    position: held,
    agentConfig: [agentConfigRow({ name: "Secular Compounder", maxOpenPositions: 4 })],
  };
}

/** The run's close-out through today's update_thesis, then complete_run on the rows it wrote. */
async function closeOutThenComplete(held: Row[]) {
  fakeClock(AT);
  try {
    const seed = seedWith(held);
    const closeOut = await replayTool("update-thesis", "updateThesis", { seed, args: CLOSE_OUT, ctx: CTX, quotes: { ETN: PRICE } });
    // The double applies no column defaults; production stamps every row.
    const written = (closeOut.db.store.thesisUpdate ?? []).map((u: Row): Row => ({ ...u, timestamp: u.timestamp ?? AT }));
    // The fire and the close-out's line, in the audit table the preflight reads.
    const complete = await replayTool("complete-run", "completeRun", {
      seed: { ...seed, thesis: [closeOut.db.store.thesis[0] as Row], thesisUpdate: [...written, FIRE_LINE] },
      args: {},
      ctx: CTX,
      quotes: { ETN: PRICE },
    });
    return { closeOut, written, complete };
  } finally {
    jest.useRealTimers();
  }
}

describe("a review that changes nothing is recorded as one", () => {
  it("a note and nothing else lands REVIEWED, and stamps when we looked", async () => {
    const before = new Date("2026-09-01T00:00:00Z");
    const { db, refused, crashed } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ lastReviewedAt: before })] },
      args: { thesis_id: "thesis_replay", rationale: "Checked the chart and the news; the plan stands." },
      quotes: { AAA: 101 },
    });
    expect(crashed).toBe(false);
    expect(refused).toBe(false);
    expect((db.store.thesisUpdate ?? []).map((u) => u.type)).toEqual(["REVIEWED"]);
    expect((db.store.thesis[0].lastReviewedAt as Date).getTime()).toBeGreaterThan(before.getTime());
  });

  it("ETN 2026-09-18: the run's own close-out lands REVIEWED (it was saved as UPDATED, with an empty diff)", async () => {
    const { closeOut, written } = await closeOutThenComplete(HELD);
    expect(closeOut.crashed).toBe(false);
    expect(closeOut.refused).toBe(false);
    expect(written.map((u) => u.type)).toEqual(["REVIEWED"]);
  });
});

describe("a fired buy answered by a review lets the run finish", () => {
  it("ETN 2026-09-18, 4 of 4 held: the review is the answer", async () => {
    const { complete } = await closeOutThenComplete(HELD);
    expect(complete.crashed).toBe(false);
    expect(complete.result.summary ?? "").not.toMatch(/refused/i);
    expect(complete.db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("the same review with a slot free finishes too — the buy comes back on the next read, not as a refusal", async () => {
    const { complete } = await closeOutThenComplete(HELD.slice(0, 3));
    expect(complete.crashed).toBe(false);
    expect(complete.result.summary ?? "").not.toMatch(/refused/i);
  });

  it("a fired buy nobody answered still keeps the run open", async () => {
    fakeClock(AT);
    try {
      const { result, crashed, db } = await replayTool("complete-run", "completeRun", {
        seed: { ...seedWith(HELD), thesisUpdate: [FIRE_LINE] },
        args: {},
        ctx: CTX,
        quotes: { ETN: PRICE },
      });
      expect(crashed).toBe(false);
      expect(result.summary ?? "").toMatch(/refused/i);
      expect(JSON.stringify(result)).toContain("ETN");
      expect(db.store.researchRun[0].status).toBe("RUNNING");
    } finally {
      jest.useRealTimers();
    }
  });
});
