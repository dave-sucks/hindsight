/**
 * The whole life of a stock, in one file.
 *
 * Every question the principal asked before merging, as an assertion:
 *
 *   a stock is minted with a buy, a floor and a take-profit
 *     -> are those three real triggers, and do the displayed numbers match?
 *   the price hits one
 *     -> does it fire, and does the right thing happen for held vs watched?
 *   we buy it
 *     -> does "entry" become what we actually paid?
 *   the daily run comes round
 *     -> does the review cadence bring it up, at the right interval for
 *        the strategy?
 *   the analyst wants to move a level
 *     -> does the thing that fires move with the number on screen?
 *
 * A stock has triggers and nothing else (2026-11-16): the analyst writes
 * each of them, and edits one by its id.
 *
 * These run against the same functions the app uses. Nothing is mocked
 * except the clock.
 */

import { priceLines, typedPriceOf } from "./price-levels";
import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { resolveLadder } from "./levels";
import { sentenceOf } from "./condition";
import { applyTriggerOps, type TriggerOp } from "./ops";
import { evaluateTrigger } from "./evaluate";
import {
  reviewCadenceTrigger,
  derivedNextReviewAt,
} from "./defaults";
import { computeNeedsAction } from "@/lib/agent/needs-action";

/** The lead: the first entry on the stock's list, null when nothing is true. */
const leadOf = (...a: Parameters<typeof computeNeedsAction>) => computeNeedsAction(...a)[0] ?? null;
import type { Trigger } from "./types";
import type { When } from "@/lib/agent/triggers/condition";

const NOW = new Date("2026-08-25T14:00:00Z");

// What an analyst writes: buy at 100, look again at 150, wrong below 90.
const written = (): Trigger[] => [
  { id: "buy", predicate: { watch: "price", is: "above", value: 100 }, action: "ENTER", rationale: "I buy the breakout above $100." },
  { id: "floor", predicate: { watch: "price", is: "below", value: 90 }, action: "EXIT", rationale: "Below $90 the base has failed." },
  { id: "upside", predicate: { watch: "price", is: "above", value: 150 }, action: "REVIEW", rationale: "At $150 I take profit or let it run." },
];

describe("1. minting a stock", () => {
  const minted = written();

  it("its buy, floor and take-profit are three triggers and nothing else: the chart draws each as its own sentence", () => {
    expect(priceLines(minted).map((l) => [l.price, l.says])).toEqual([
      [90, "Sell if below $90"],
      [100, "Buy if above $100"],
      [150, "Review if above $150"],
    ]);
  });
});

describe("2. the price reaches a level", () => {
  const at = (price: number) => ({
    latestQuote: { price, changePct: 0 },
    thesis: { createdAt: NOW, direction: "LONG" },
    now: NOW,
  });
  const buyAt100: When = { watch: "price", is: "above", value: 100 };
  const floorAt90: When = { watch: "price", is: "below", value: 90 };

  it("fires the buy level when it breaks up through it", () => {
    expect(evaluateTrigger(buyAt100, at(101))).toBe(true);
    expect(evaluateTrigger(buyAt100, at(99))).toBe(false);
  });

  it("fires the floor when it drops through it", () => {
    expect(evaluateTrigger(floorAt90, at(89))).toBe(true);
    expect(evaluateTrigger(floorAt90, at(91))).toBe(false);
  });
});

describe("3. each trigger says what it does, whether we own the stock or not", () => {
  const [buy, floor, upside] = written();

  it("a sale sells, the upside review asks, the buy buys", () => {
    expect(sentenceOf(floor)).toBe("Sell if below $90");
    expect(sentenceOf(upside)).toBe("Review if above $150");
    expect(sentenceOf(buy)).toBe("Buy if above $100");
  });
  it("a watch ends on its own Stop watching line (stop-watching.ts retires the thesis), never on a sale", () => {
    expect(sentenceOf({ ...floor, action: "STOP_WATCHING" })).toBe("Stop watching if below $90");
  });
});

describe("4. we buy it", () => {
  const held = written().filter((t) => t.action !== "ENTER");

  it("the buy is gone: what we paid is the position's, never a trigger's", () => {
    expect(held.some((t) => t.action === "ENTER")).toBe(false);
  });

  it("keeps the floor it had and still has somewhere to go", () => {
    expect(priceLines(held).map((l) => l.says)).toEqual(["Sell if below $90", "Review if above $150"]);
  });
});

describe("5. the review cadence", () => {
  it("brings a thesis up once its interval has passed", () => {
    const cadence = reviewCadenceTrigger(7).predicate;
    const since = (days: number) => ({
      thesis: {
        createdAt: new Date("2026-01-01"),
        lastReviewedAt: new Date(NOW.getTime() - days * 86_400_000),
      },
      now: NOW,
    });
    expect(evaluateTrigger(cadence, since(8))).toBe(true);
    expect(evaluateTrigger(cadence, since(2))).toBe(false);
  });

  it("restarts when the analyst actually looks", () => {
    const cadence = reviewCadenceTrigger(7).predicate;
    expect(
      evaluateTrigger(cadence, {
        thesis: { createdAt: new Date("2026-01-01"), lastReviewedAt: NOW },
        now: NOW,
      }),
    ).toBe(false);
  });

  it("a compounder waits a month while a catalyst comes up daily", () => {
    const twelveDaysAgo = {
      thesis: {
        createdAt: new Date("2026-01-01"),
        lastReviewedAt: new Date(NOW.getTime() - 12 * 86_400_000),
      },
      now: NOW,
    };
    expect(evaluateTrigger(reviewCadenceTrigger(30).predicate, twelveDaysAgo)).toBe(false);
    expect(evaluateTrigger(reviewCadenceTrigger(1).predicate, twelveDaysAgo)).toBe(true);
  });

  it("reaches a thesis carrying no cadence of its own", () => {
    const ladder = resolveLadder({
      thesis: [],
      account: [reviewCadenceTrigger(7)],
      direction: "LONG",
    });
    expect(ladder.some((t) => shapeName(t.predicate) === "repeat")).toBe(true);
  });
});

describe("6. the analyst changes its mind, one trigger by its id", () => {
  const held = () => written().filter((t) => t.action !== "ENTER");
  const edit = (stored: Trigger[], ops: TriggerOp[], status: string) => {
    const out = applyTriggerOps({ stored, ops, direction: "LONG", status, actor: "AGENT", mintId: () => "new" });
    const price = (id: string) => { const t = out.triggers.find((x) => x.id === id); return t ? typedPriceOf(t) : null; };
    return { triggers: out.triggers, buy: price("buy"), upside: price("upside"), floor: price("floor") };
  };

  it("raising the upside level moves the thing that fires, not just the label", () => {
    const out = edit(held(), [{ op: "edit", id: "upside", value: 180, rationale: "The Street raised its average to $180." }], "HOLDING");
    expect(out.upside).toBe(180);
  });

  it("tightening the floor moves the thing that fires", () => {
    const out = edit(held(), [{ op: "edit", id: "floor", value: 98, rationale: "Under the new base at $98." }], "HOLDING");
    expect(out.floor).toBe(98);
    expect(
      evaluateTrigger(
        { watch: "price", is: "below", value: out.floor! },
        { latestQuote: { price: 97, changePct: 0 }, thesis: { createdAt: NOW }, now: NOW },
      ),
    ).toBe(true);
  });

  it("re-pricing the buy on a watch item moves it", () => {
    const out = edit(written(), [{ op: "edit", id: "buy", value: 92, rationale: "The pullback to the 50-day at $92." }], "WATCHING");
    expect(out.buy).toBe(92);
    expect(out.triggers.filter((t) => t.action === "ENTER")).toHaveLength(1);
  });

  it("removing the floor clears the number too", () => {
    const out = edit(written(), [{ op: "remove", id: "floor" }, { op: "remove", id: "buy" }], "WATCHING");
    expect(out.floor).toBeNull();
  });
});

describe("7. the review date the rest of the app reads", () => {
  // The review date is DERIVED at read time, everywhere — the cached column
  // is gone (DAV-221). It existed once, froze when its writers were deleted
  // (L7), and every thesis past its last written date read as permanently
  // overdue; five of one analyst's seven names were flagged within a day of
  // deploy. A value nothing stores cannot freeze.
  const { nextReviewFrom } = require("./defaults");
  const reviewed = new Date("2026-08-26T14:00:00Z");
  const days = (d: Date) =>
    Math.round((d.getTime() - reviewed.getTime()) / 86_400_000);

  const clock = [{ predicate: { watch: "repeat", value: 3 } }];

  it("moves forward when a thesis is reviewed — never a date in the past (the overdue-forever bug)", () => {
    expect(nextReviewFrom(reviewed, clock).getTime()).toBeGreaterThan(reviewed.getTime());
  });

  it("uses the clock on the ladder it is given", () => {
    expect(days(nextReviewFrom(reviewed, clock))).toBe(3);
  });

  it("with no clock on the ladder there is no review date: nothing comes from the horizon", () => {
    expect(nextReviewFrom(reviewed, [])).toBeNull();
  });

  it("shows no review date on a watch item with no cadence of its own", () => {
    // W1: watch items opt IN to a cadence. A soft watch with only wake
    // triggers has no scheduled review — displaying a horizon-derived one
    // would promise a fire that never comes.
    expect(
      derivedNextReviewAt({
        status: "WATCHING",
        lastReviewedAt: null,
        createdAt: new Date("2026-08-01"),
        triggers: [],
      }),
    ).toBeNull();
  });

  it("shows no review date on a terminal row", () => {
    for (const status of ["RETIRED", "PASSED"]) {
      expect(
        derivedNextReviewAt({
          status,
          lastReviewedAt: reviewed,
          createdAt: new Date("2026-08-01"),
          triggers: [reviewCadenceTrigger(7)],
        }),
      ).toBeNull();
    }
  });

  it("a held row with no clock on its ladder has no review date; the account's inherited clock is on the resolved ladder", () => {
    const held = { status: "HOLDING", lastReviewedAt: reviewed, createdAt: new Date("2026-08-01") };
    expect(derivedNextReviewAt({ ...held, triggers: [] })).toBeNull();
    expect(days(derivedNextReviewAt({ ...held, triggers: [reviewCadenceTrigger(7)] })!)).toBe(7);
  });
});

describe("8. a watchlist seed surfaces for its first research", () => {
  // Every seed path (user add, builder, editor) mints direction=null,
  // status WATCHING, a 7-day cadence trigger, and NO lastReviewedAt.
  // Post-DAV-221 there is no date column seeding this — due-ness must fall
  // out of the trigger + the createdAt fallback alone, or seeds go
  // invisible forever.
  const mintedAt = new Date("2026-08-20T14:00:00Z");
  const seed = {
    id: "seed-1",
    direction: null,
    status: "WATCHING",
    triggers: [{ ...reviewCadenceTrigger(7), source: "DEFAULT" as const }],
    createdAt: mintedAt,
    lastReviewedAt: null,
  };
  const daysLater = (d: number) =>
    new Date(mintedAt.getTime() + d * 86_400_000);

  it("shows its first-research date: createdAt + the 7-day seed cadence", () => {
    expect(derivedNextReviewAt(seed)).toEqual(
      daysLater(7),
    );
  });

  it("is quiet before the cadence elapses", () => {
    expect(
      leadOf({
        thesis: seed,
        activity: [],
        latestQuote: null,
        now: daysLater(3),
      }),
    ).toBeNull();
  });

  it("carries no flag once the week is up: it has no case to review, and code sends it to the Writer", () => {
    expect(leadOf({ thesis: seed, activity: [], latestQuote: null, now: daysLater(7) })).toBeNull();
    expect(leadOf({ thesis: { ...seed, direction: "LONG" }, activity: [], latestQuote: null, now: daysLater(7) })).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("a recycled sold name (1-day cadence) is back on the desk next morning", () => {
    // thesis-flips recycles a profit-take to WATCHING with a 1-day cadence
    // — the replacement for the deleted due-date write. With the daily
    // run's 24h look-ahead, that means the very next morning.
    const recycled = {
      id: "recycled-1",
      direction: "LONG",
      status: "WATCHING",
      triggers: [{ ...reviewCadenceTrigger(1), source: "DEFAULT" as const }],
      createdAt: mintedAt,
      lastReviewedAt: daysLater(10), // reviewed the morning it was sold
    };
    const result = leadOf({
      thesis: recycled,
      activity: [],
      latestQuote: null,
      now: daysLater(10.5), // the next daily run
    });
    expect(result?.kind).toBe("REVIEW_DUE");
  });
});
