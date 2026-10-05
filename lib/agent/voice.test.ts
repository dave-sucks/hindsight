/**
 * voice.test.ts — what Dave reads is written in one voice (lib/agent/voice.ts).
 *
 * Built from real production text, 2026-09-14 → 2026-10-05: the Visa buy and
 * its Activity note (10-05), the AGIO buy (10-05), Samsara's automatic floor
 * sale (09-25), ServiceNow's refused plan (10-05), the research runs that
 * failed on Anthropic credit (09-29), Visa's first research note (09-29).
 * Each assertion below failed on main, where the same inputs printed the old
 * wording.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { VOICE_RULES } from "@/lib/agent/voice";
import { sizeByRisk } from "@/lib/agent/position-sizing";
import { heatLine, type OpenRisk } from "@/lib/agent/portfolio-risk";
import { computeRegime } from "@/lib/agent/regime";
import { buildHeldThroughNote } from "@/lib/proposals/held-through-context";
import { blockedReason } from "@/lib/portfolio/attempt-outcomes";
import { withoutSourceTags } from "@/lib/thesis/source-tags";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

/** Words the rules forbid, in the forms the old text used them. */
const ANALYST_TALK = [/\b[A-Z]{2,}_[A-Z_]+\b/, /\[Belief unchanged/, /\bseat\b/i, /\bthe principal\b/i, /\bOVER the cap\b/, /stop distance/, /\(HIGH\)|\(MEDIUM\)/];
const plain = (text: string) => ANALYST_TALK.filter((re) => re.test(text)).map(String);

describe("every agent's text carries the rules, once", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") }));
  afterAll(() => jest.useRealTimers());

  for (const name of Object.keys(SAMPLE_PROMPTS) as Array<keyof typeof SAMPLE_PROMPTS>) {
    it(name, () => {
      expect(SAMPLE_PROMPTS[name]().split(VOICE_RULES).length - 1).toBe(1);
    });
  }
});

describe("the lines the app writes under a buy", () => {
  it("Visa, 2026-10-05: 27 shares capped at the largest trade, every number kept", () => {
    const r = sizeByRisk({ equity: 114_480, entry: 368.9, stop: 344, conviction: "HIGH", band: { floor: 3_000, ceiling: 10_000, floorClampedByCeiling: false } } as never)!;
    expect(r.line).toBe(
      "27 shares, $9,960, capped at this analyst's largest trade. Risk alone said 45 shares ($16,601): " +
        "1% of the $114,480 account at high conviction = $1,145 at risk, over $24.90 to the stop. " +
        "At the stop this loses $672, 0.59% of the account.",
    );
    expect(plain(r.line)).toEqual([]);
  });

  it("AGIO, 2026-10-05: raised to the smallest trade, the event halving named in words", () => {
    const r = sizeByRisk({ equity: 114_249, entry: 31.38, stop: 26, conviction: "MEDIUM", binary: true, band: { floor: 3_000, ceiling: 10_000, floorClampedByCeiling: false } } as never)!;
    expect(r.line).toBe(
      "96 shares, $3,012, raised to this analyst's smallest trade. Risk alone said 79 shares ($2,479): " +
        "1% of the $114,249 account × 0.75 for medium conviction × 0.5 for an all-or-nothing event = $428 at risk, over $5.38 to the stop. " +
        "At the stop this loses $516, 0.45% of the account, above the 0.38% this trade aims for because the stop is wide.",
    );
    expect(plain(r.line)).toEqual([]);
  });

  it("Visa, 2026-10-05: the open-risk line", () => {
    const open: OpenRisk = {
      riskDollars: 9_746,
      riskPct: 8.5,
      perName: [
        { symbol: "ASML", riskDollars: 1_429 },
        { symbol: "NVDA", riskDollars: 1_268 },
        { symbol: "GEV", riskDollars: 1_117 },
      ],
      unstopped: [],
      byIndustry: new Map(),
    };
    const line = heatLine(open, 114_480, 672.3);
    expect(line).toBe("If every open stop hit after this buy, the account would lose 9.1%, over the 6% limit. Biggest: ASML $1,429, NVDA $1,268, GEV $1,117.");
    expect(plain(line)).toEqual([]);
  });

  it("Visa, 2026-10-05: the market line", () => {
    const snap = (close: number, s50: number, s200: number) =>
      ({ asOf: "2026-10-02", sma: { 20: null, 50: s50, 150: null, 200: s200 }, closes: [close] }) as unknown as IndicatorSnapshot;
    // 91% of the stocks above their 50-day: 10 of 11.
    const book = [...Array.from({ length: 10 }, () => snap(10, 9, 8)), snap(10, 11, 8)];
    const r = computeRegime(snap(769.64, 763.7, 720.47), book)!;
    expect(r.line).toBe("Market risk-on: SPY $769.64, above its 50-day ($763.70) and above its 200-day ($720.47), so full size. 91% of our stocks are above their 50-day.");
    expect(plain(r.line)).toEqual([]);
  });
});

describe("Samsara, 2026-09-25: the automatic floor sale, asked a third time", () => {
  it("says which ask this is, and how to keep holding", () => {
    const note = buildHeldThroughNote({ declineCount: 2, rejectMessage: null, recentExtreme: 37.77, direction: "LONG" })!;
    expect(note).toBe(
      "Third ask: you declined it or let it expire twice in the last 7 days, and it's still below the line. " +
        "The recent low is $37.77; to keep holding, decline and move the line just under it.",
    );
  });
});

describe("the dashboard's Blocked lines", () => {
  it("Visa, Travelers, Apple since 2026-09-29: the research writer's billing error, in words", () => {
    expect(
      blockedReason({
        tool: "thesis_writer",
        gateCode: "writer_failed",
        summary: "Thesis research on $V produced no thesis (mint)",
        detail: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      }),
    ).toBe("The research couldn't run: the Anthropic account was out of credit.");
  });

  it("ServiceNow, 2026-10-05: a refused plan, without the trigger ids written for the analyst", () => {
    const line = blockedReason({
      tool: "update_thesis",
      gateCode: "invalid_thesis_shape",
      summary: "Refused update on $NOW — the resulting plan is invalid (invalid_thesis_shape).",
      detail:
        "R/R floor: 1.77:1 is below the mandatory 2:1 minimum ((target − entry) / (entry − stop) with entry=$147.6, target=$185, stop=$126.5). " +
        'Tighten the stop to a REAL technical level, raise the target to a CITED level. To set the plan down, remove all of them in one call: remove_trigger_ids: ["c4d1952a-2e3a-43a4-962f-e4bacf6d5f0e"].',
    });
    expect(line).toBe("The plan was refused: the target pays 1.77 times what the stop risks, under the 2-to-1 minimum (buy $147.60, target $185, stop $126.50).");
  });

  it("a refusal whose first sentence is already plain prints that sentence", () => {
    expect(
      blockedReason({
        tool: "update_thesis",
        gateCode: "missing_enter_trigger",
        summary: "Refused update on $SYK — the resulting plan is invalid (missing_enter_trigger).",
        detail: "This thesis carries a plan level (a floor or a target) with no buy level to reach it from. Either finish the plan — set entry_price (the level the buy trigger fires on) — or remove the floor and target triggers.",
      }),
    ).toBe("This thesis carries a plan level (a floor or a target) with no buy level to reach it from.");
  });
});

describe("Visa, 2026-09-29: the research writer's source tags stay out of the sentence", () => {
  it("drops [STRUCTURED: …] and [WEB: …] tags", () => {
    expect(
      withoutSourceTags(
        "Visa Inc. ($V) is a $687B-market-cap electronic payments network operating what is effectively a global infrastructure duopoly alongside Mastercard. [STRUCTURED: MarketCap] The stock closed at $367.74 on September 28 [WEB:https://example.com/v]. Its pivot is $385.57. [STRUCTURED: Base]",
      ),
    ).toBe(
      "Visa Inc. ($V) is a $687B-market-cap electronic payments network operating what is effectively a global infrastructure duopoly alongside Mastercard. The stock closed at $367.74 on September 28. Its pivot is $385.57.",
    );
  });
});

describe("the old wording is gone from every line the app writes for Dave", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const cases: Array<[string, string[]]> = [
    ["lib/agent/tools/update-thesis.ts", ["[Belief unchanged: ${"]],
    ["lib/proposals/execute.ts", ["User approved the ${intent}", "Alpaca order id ${"]],
    ["lib/proposals/thesis-flips.ts", ["Entry filled at $", "the watchlist row is now a live position"]],
    ["lib/inngest/functions/proposal-expiry.ts", ["no approve / reject within the expiry window", "Original rationale:"]],
    ["lib/inngest/functions/reconcile-orders.ts", ["Once the stock is owned the buy price is what was paid, not the plan."]],
    ["lib/agent/system-prompts/intraday-tactical.ts", ["ladder intact:", "level no longer holds at\n           execution time", "False fire."]],
  ];
  for (const [path, phrases] of cases) {
    it(path, () => {
      const src = read(path);
      expect(phrases.filter((p) => src.includes(p))).toEqual([]);
    });
  }
});
