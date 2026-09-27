/**
 * no-buy-level.replay.test.ts — DAV-321, from the rows as they stand.
 *
 * On 2026-09-26, 21 of 29 watched stocks carried no ENTER trigger. They woke
 * on a review clock, were reviewed, cost tokens, and could never become a
 * position. Ten of the Catalyst seat's eleven names were in that state, which
 * is why it held nothing.
 *
 * `NOTHING_CAN_WAKE` passed every one of them, because they all kept a review
 * clock. It asks "can anything reach this stock?"; this asks "can this ever
 * be bought?"
 *
 * Through `get_theses`'s real execute, so the flag is proven to reach the run
 * rather than just to compute.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Row = {
  ticker: string;
  resolved?: { planSanity?: Array<{ kind: string; text: string }> | null } | null;
};

const flags = (result: unknown, ticker: string): string[] => {
  const rows = ((result as { data?: { theses?: Row[] } }).data?.theses ?? []).filter(
    (t) => t.ticker === ticker,
  );
  return (rows[0]?.resolved?.planSanity ?? []).map((f) => f.kind);
};

/** MSFT as it stands: the buy, stop and target were removed on 09-14. */
const msft = () =>
  thesisRow({
    id: "t_msft",
    ticker: "MSFT",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    setupId: null,
    conviction: "HIGH",
    entryPrice: null,
    targetPrice: null,
    stopLoss: null,
    triggers: [
      {
        id: "t1",
        action: "REVIEW",
        predicate: { kind: "REVIEW_CADENCE", days: 30 },
        rationale: "Monthly look.",
        cooldownDays: 30,
      },
      {
        id: "t2",
        action: "REVIEW",
        predicate: { kind: "EARNINGS_BEAT" },
        rationale: "Beat.",
        cooldownDays: 7,
      },
    ],
  });

const EVENT = new Date("2027-03-03T05:00:00.000Z");

/** EXEL: a pre-catalyst row whose decision is 158 days out. */
const exel = (triggers: unknown[]) =>
  thesisRow({
    id: "t_exel",
    ticker: "EXEL",
    status: "WATCHING",
    direction: "LONG",
    horizon: "CATALYST",
    setupId: "PRE_CATALYST",
    catalystDate: EVENT,
    entryPrice: null,
    targetPrice: null,
    stopLoss: null,
    triggers,
  });

const plainClock = {
  id: "x1",
  action: "REVIEW",
  predicate: { kind: "REVIEW_CADENCE", days: 112 },
  rationale: "Look again in a while.",
  cooldownDays: 112,
};

/** The wake that brings a parked row back when its window opens. */
const windowWake = {
  id: "x2",
  action: "REVIEW",
  predicate: { kind: "REVIEW_CADENCE", days: 70, from: "EVENT", side: "BEFORE" },
  rationale: "Price the entry when the window opens.",
  cooldownDays: 70,
};

describe("DAV-321 — a watched stock with no way to buy it", () => {
  it("MSFT is flagged: HIGH conviction, a review clock, and nothing that can buy it", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [msft()] },
      args: {},
      quotes: { MSFT: 512 },
    });

    expect(flags(result, "MSFT")).toContain("NO_BUY_LEVEL");
    // Not the old flag: MSFT has two triggers of its own, so "nothing can
    // wake it" is false. That is exactly why it went unnoticed.
    expect(flags(result, "MSFT")).not.toContain("NOTHING_CAN_WAKE");
  });

  it("a moving-average entry counts — the flag reads the trigger, not the price column", async () => {
    // GD, GEV and SYK carry a VS_SMA buy and no entry PRICE. Keying this on
    // `entryPrice` would have flagged all three for having a plan.
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [
          thesisRow({
            id: "t_gd",
            ticker: "GD",
            status: "WATCHING",
            direction: "LONG",
            entryPrice: null,
            targetPrice: null,
            stopLoss: null,
            triggers: [
              {
                id: "g1",
                action: "ENTER",
                predicate: { kind: "VS_SMA", period: 50, direction: "ABOVE" },
                rationale: "Reclaim the 50-day.",
                cooldownDays: 1,
              },
            ],
          }),
        ],
      },
      args: {},
      quotes: { GD: 330 },
    });

    expect(flags(result, "GD")).not.toContain("NO_BUY_LEVEL");
  });

  it("EXEL as it stands is flagged — a 112-day clock is not a park", async () => {
    // Its decision is 158 days out, so having no buy level is legitimate.
    // What makes it a park rather than a skip is a wake timed to the window
    // opening, and a plain day-count clock is not that.
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [exel([plainClock])] },
      args: {},
      quotes: { EXEL: 41 },
    });

    expect(flags(result, "EXEL")).toContain("NO_BUY_LEVEL");
  });

  it("EXEL parked until its window opens is not flagged", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [exel([plainClock, windowWake])] },
      args: {},
      quotes: { EXEL: 41 },
    });

    expect(flags(result, "EXEL")).not.toContain("NO_BUY_LEVEL");
  });

  it("inside the window the park expires — the same wake no longer excuses it", async () => {
    // The event is 40 days out: inside 14–70, so the ruling says it carries
    // a buy level, chart or no chart.
    const soon = new Date(Date.now() + 40 * 86_400_000);
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [
          thesisRow({
            id: "t_cytk",
            ticker: "CYTK",
            status: "WATCHING",
            direction: "LONG",
            horizon: "CATALYST",
            setupId: "PRE_CATALYST",
            catalystDate: soon,
            entryPrice: null,
            targetPrice: null,
            stopLoss: null,
            triggers: [windowWake],
          }),
        ],
      },
      args: {},
      quotes: { CYTK: 62 },
    });

    expect(flags(result, "CYTK")).toContain("NO_BUY_LEVEL");
  });
});
