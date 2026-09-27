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

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

type FlagRow = { kind: string; text: string };
const flagRows = (result: unknown, ticker: string): FlagRow[] => {
  const rows = ((result as { data?: { theses?: Row[] } }).data?.theses ?? []).filter((t) => t.ticker === ticker);
  return rows[0]?.resolved?.planSanity ?? [];
};

const earningsWakes = [
  { id: "e1", action: "REVIEW", predicate: { kind: "EARNINGS_BEAT" }, rationale: "Beat.", cooldownDays: 7 },
  { id: "e2", action: "REVIEW", predicate: { kind: "EARNINGS_MISS" }, rationale: "Miss.", cooldownDays: 7 },
];

const watch = (over: Record<string, unknown>) =>
  thesisRow({ status: "WATCHING", direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, triggers: [], ...over });

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

  // ── The two honest parks (QB ruling 2026-09-27, from the real book) ─────
  // On the 31 watched rows as they stood, the first version of this flag
  // parked nothing: it asked for a "70 days before the event" review on the
  // thesis, and no row carries one. The flag is computed when the row is
  // read, so it brings a parked row back by itself.

  it("EXEL as it stands is parked — 156 days out, and a plain clock is all it carries", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [exel([plainClock])] },
      args: {},
      quotes: { EXEL: 41 },
    });
    expect(flags(result, "EXEL")).not.toContain("NO_BUY_LEVEL");
  });

  it("the day its window opens the same row is flagged, with no trigger having fired", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_exel", ticker: "EXEL", horizon: "CATALYST", setupId: "PRE_CATALYST", catalystDate: inDays(69), triggers: [plainClock] })] },
      args: {},
      quotes: { EXEL: 41 },
    });
    const f = flagRows(result, "EXEL").find((x) => x.kind === "NO_BUY_LEVEL");
    expect(f).toBeDefined();
    expect(f?.text).toContain("The buying window is open");
    expect(f?.text).toContain("highest high of the last 20 sessions");
  });

  it("BMRN is parked too — a CATALYST row written before setups were named, 153 days out", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_bmrn", ticker: "BMRN", horizon: "CATALYST", setupId: null, catalystDate: inDays(153), triggers: [plainClock] })] },
      args: {},
      quotes: { BMRN: 60 },
    });
    expect(flags(result, "BMRN")).not.toContain("NO_BUY_LEVEL");
  });

  it("CYTK is flagged — 47 days out is inside the window, whatever the setup is called", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_cytk", ticker: "CYTK", horizon: "CATALYST", setupId: "NONE", catalystDate: inDays(47), triggers: [plainClock] })] },
      args: {},
      quotes: { CYTK: 62 },
    });
    expect(flags(result, "CYTK")).toContain("NO_BUY_LEVEL");
  });

  it("AIR the day before its print is parked — the drift entry does not exist until the gap does", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_air", ticker: "AIR", horizon: "CATALYST", setupId: "PEAD", catalystDate: inDays(1), triggers: earningsWakes })] },
      args: {},
      quotes: { AIR: 70 },
    });
    expect(flags(result, "AIR")).not.toContain("NO_BUY_LEVEL");
  });

  it("two days after the print the same row owes a buy level or a goodbye", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_air", ticker: "AIR", horizon: "CATALYST", setupId: "PEAD", catalystDate: inDays(-2), triggers: earningsWakes })] },
      args: {},
      quotes: { AIR: 70 },
    });
    expect(flags(result, "AIR")).toContain("NO_BUY_LEVEL");
  });

  it("MSFT's flag offers two answers, not a park — a compounder has no date to park until", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [msft()] },
      args: {},
      quotes: { MSFT: 512 },
    });
    const f = flagRows(result, "MSFT").find((x) => x.kind === "NO_BUY_LEVEL");
    expect(f?.text).toContain("one of two ways");
    expect(f?.text).not.toContain("park");
  });
});

describe("DAV-321 ruling 4 — a buy still live inside the last 21 days", () => {
  const buy = { id: "b1", action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 97.5 }, rationale: "Reclaim.", cooldownDays: 1 };

  it("MIRM on 09-17: a $97.50 buy nine days before the decision is flagged", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_mirm", ticker: "MIRM", horizon: "CATALYST", setupId: "PRE_CATALYST", catalystDate: inDays(9), entryPrice: 97.5, targetPrice: 137, stopLoss: 88, triggers: [buy] })] },
      args: {},
      quotes: { MIRM: 98 },
    });
    const f = flagRows(result, "MIRM").find((x) => x.kind === "BUY_INSIDE_CUTOFF");
    expect(f).toBeDefined();
    expect(f?.text).toContain("9 days away");
  });

  it("AGIO at 34 days, with its buy, is inside the window and outside the cut-off — no flag", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_agio", ticker: "AGIO", horizon: "CATALYST", setupId: "PRE_CATALYST", catalystDate: inDays(34), entryPrice: 31.5, targetPrice: 40, stopLoss: 27.5, triggers: [{ ...buy, predicate: { kind: "PRICE_ABOVE", level: 31.5 } }] })] },
      args: {},
      quotes: { AGIO: 30 },
    });
    expect(flags(result, "AGIO")).not.toContain("BUY_INSIDE_CUTOFF");
    expect(flags(result, "AGIO")).not.toContain("NO_BUY_LEVEL");
  });

  it("a compounder with a buy is never flagged for a date it does not have", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch({ id: "t_gd", ticker: "GD", horizon: "COMPOUNDER", setupId: "COMPOUNDER_ACCUMULATION", catalystDate: null, entryPrice: 356, targetPrice: 435, stopLoss: 315, triggers: [{ ...buy, predicate: { kind: "PRICE_ABOVE", level: 356 } }] })] },
      args: {},
      quotes: { GD: 340 },
    });
    expect(flags(result, "GD")).not.toContain("BUY_INSIDE_CUTOFF");
  });
});
