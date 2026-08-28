/**
 * The whole life of a stock, in one file.
 *
 * Every question the principal asked before merging, as an assertion:
 *
 *   a stock is minted with a buy price, a target and a floor
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
 * These run against the same functions the app uses. Nothing is mocked
 * except the clock.
 */

import { canonicalLevels, applyLevelArgs } from "./price-levels";
import { resolveLadder } from "./levels";
import { effectiveTriggerAction } from "./types";
import { evaluateTrigger } from "./evaluate";
import {
  defaultTriggersForHorizon,
  CADENCE_DAYS_BY_HORIZON,
  reviewCadenceTrigger,
} from "./defaults";
import type { Trigger, TriggerPredicate } from "./types";
import type { ResolvedTrigger } from "./levels";

const NOW = new Date("2026-08-25T14:00:00Z");
const asResolved = (ts: Trigger[]): ResolvedTrigger[] =>
  ts.map((t) => ({ ...t, level: "THESIS" as const, inherited: false }));

// The plan an analyst writes: buy at 100, take profit at 150, wrong below 90.
const PLAN = { entryPrice: 100, targetPrice: 150, stopLoss: 90 };

describe("1. minting a stock with a plan", () => {
  const minted = defaultTriggersForHorizon(
    "TARGET",
    { ...PLAN, direction: "LONG" },
    "WATCHING",
  );

  it("turns all three prices into triggers", () => {
    const levels = canonicalLevels({
      triggers: asResolved(minted),
      direction: "LONG",
      status: "WATCHING",
    });
    expect(levels.entry?.price).toBe(100);
    expect(levels.target?.price).toBe(150);
    expect(levels.floor?.price).toBe(90);
  });

  it("keeps the buy price and the target as SEPARATE things", () => {
    // They were conflated once: the buy trigger read targetPrice, so the
    // analyst would buy at the take-profit level (MDB, 2026-05-25).
    const buy = minted.find((t) => t.action === "ENTER");
    expect(buy?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 100 });
    expect(buy?.predicate).not.toEqual({ kind: "PRICE_ABOVE", level: 150 });
  });

  it("shows the same numbers on the card as it will fire on", () => {
    const levels = canonicalLevels({
      triggers: asResolved(minted),
      direction: "LONG",
      status: "WATCHING",
    });
    expect(levels.columns).toEqual({
      entryPrice: 100,
      targetPrice: 150,
      stopLoss: 90,
    });
  });
});

describe("2. the price reaches a level", () => {
  const at = (price: number) => ({
    latestQuote: { price, changePct: 0 },
    thesis: { createdAt: NOW, direction: "LONG" },
    now: NOW,
  });
  const buyAt100: TriggerPredicate = { kind: "PRICE_ABOVE", level: 100 };
  const floorAt90: TriggerPredicate = { kind: "PRICE_BELOW", level: 90 };

  it("fires the buy level when it breaks up through it", () => {
    expect(evaluateTrigger(buyAt100, at(101))).toBe(true);
    expect(evaluateTrigger(buyAt100, at(99))).toBe(false);
  });

  it("fires the floor when it drops through it", () => {
    expect(evaluateTrigger(floorAt90, at(89))).toBe(true);
    expect(evaluateTrigger(floorAt90, at(91))).toBe(false);
  });
});

describe("3. what happens depends on whether we own it", () => {
  const floor = { action: "EXIT" as const, predicate: { kind: "PRICE_BELOW" as const, level: 90 } };
  const target = { action: "REVIEW" as const, predicate: { kind: "PRICE_ABOVE" as const, level: 150 } };
  const buy = { action: "ENTER" as const, predicate: { kind: "PRICE_ABOVE" as const, level: 100 } };
  const held = { status: "HOLDING", direction: "LONG" };
  const watched = { status: "WATCHING", direction: "LONG" };

  it("held + floor broken -> sell", () => {
    expect(effectiveTriggerAction(floor, held)).toBe("EXIT");
  });
  it("held + target reached -> wake a decision, never an auto-sell", () => {
    expect(effectiveTriggerAction(target, held)).toBe("REVIEW");
  });
  it("watched + floor broken -> set the plan down (the plan was wrong)", () => {
    expect(effectiveTriggerAction(floor, watched)).toBe("DEMOTE");
  });
  it("watched + target reached -> set the plan down (it ran without us)", () => {
    expect(effectiveTriggerAction(target, watched)).toBe("DEMOTE");
  });
  it("watched + buy level hit -> buy", () => {
    expect(effectiveTriggerAction(buy, watched)).toBe("ENTER");
  });
});

describe("4. we buy it", () => {
  it("entry becomes what we PAID, not what we planned", () => {
    const minted = defaultTriggersForHorizon(
      "TARGET",
      { ...PLAN, direction: "LONG" },
      "HELD",
    );
    const levels = canonicalLevels({
      triggers: asResolved(minted),
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42, // filled above the planned 100
    });
    expect(levels.entry?.price).toBe(103.42);
    expect(levels.columns.entryPrice).toBe(103.42);
  });

  it("still protects and still has somewhere to go", () => {
    const minted = defaultTriggersForHorizon(
      "TARGET",
      { ...PLAN, direction: "LONG" },
      "HELD",
    );
    const levels = canonicalLevels({
      triggers: asResolved(minted),
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42,
    });
    expect(levels.floor?.price).toBe(90);
    expect(levels.target?.price).toBe(150);
  });
});

describe("5. the review cadence", () => {
  it("matches the strategy, not one number for everything", () => {
    expect(CADENCE_DAYS_BY_HORIZON).toEqual({
      CATALYST: 1,
      TRADE: 1,
      TARGET: 7,
      COMPOUNDER: 30,
    });
  });

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
    expect(ladder.some((t) => t.predicate.kind === "REVIEW_CADENCE")).toBe(true);
  });
});

describe("6. the analyst changes its mind", () => {
  const mint = () =>
    defaultTriggersForHorizon("TARGET", { ...PLAN, direction: "LONG" }, "HELD");

  it("raising the target moves the thing that fires, not just the label", () => {
    const out = applyLevelArgs({
      stored: mint(),
      levels: { target: 180 },
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42,
      mintId: () => "new",
    });
    expect(out.columns.targetPrice).toBe(180);
    const fires = canonicalLevels({
      triggers: asResolved(out.triggers),
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42,
    });
    expect(fires.target?.price).toBe(180);
  });

  it("tightening the floor moves the thing that fires", () => {
    const out = applyLevelArgs({
      stored: mint(),
      levels: { floor: 98 },
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42,
      mintId: () => "new",
    });
    expect(out.columns.stopLoss).toBe(98);
    expect(
      evaluateTrigger(
        { kind: "PRICE_BELOW", level: out.columns.stopLoss! },
        { latestQuote: { price: 97, changePct: 0 }, thesis: { createdAt: NOW }, now: NOW },
      ),
    ).toBe(true);
  });

  it("re-pricing the buy level on a watch item moves it", () => {
    const watching = defaultTriggersForHorizon(
      "TARGET",
      { ...PLAN, direction: "LONG" },
      "WATCHING",
    );
    const out = applyLevelArgs({
      stored: watching,
      levels: { entry: 92 },
      direction: "LONG",
      status: "WATCHING",
      mintId: () => "new",
    });
    expect(out.columns.entryPrice).toBe(92);
    expect(out.triggers.filter((t) => t.action === "ENTER")).toHaveLength(1);
  });

  it("dropping a level from a resent list clears the number too", () => {
    // update_thesis replaces the whole trigger list. A level the agent
    // forgot to resend must not linger on screen as protection.
    const out = applyLevelArgs({
      stored: mint().filter(
        (t) => !(t.action === "EXIT" && t.predicate.kind === "PRICE_BELOW"),
      ),
      levels: {},
      direction: "LONG",
      status: "HOLDING",
      avgCost: 103.42,
    mintId: () => "new",
    });
    expect(out.columns.stopLoss).toBeNull();
  });
});

describe("7. the review date the rest of the app reads", () => {
  // nextReviewAt is a derived display value — and for one day it was derived
  // by nothing. L7 deleted both blocks that advanced it, stamped
  // lastReviewedAt instead, and left five readers pointed at a frozen
  // column. The overdue cron read every thesis past its last written date as
  // permanently overdue; five of one analyst's seven names were flagged
  // within a day of deploy.
  const { nextReviewFrom } = require("./defaults");
  const reviewed = new Date("2026-08-26T14:00:00Z");
  const days = (d: Date) =>
    Math.round((d.getTime() - reviewed.getTime()) / 86_400_000);

  it("moves forward when a thesis is reviewed", () => {
    expect(nextReviewFrom(reviewed, [], "TARGET").getTime()).toBeGreaterThan(
      reviewed.getTime(),
    );
  });

  it("uses the thesis's own cadence when it has one", () => {
    const own = [{ predicate: { kind: "REVIEW_CADENCE", days: 3 } }];
    expect(days(nextReviewFrom(reviewed, own, "COMPOUNDER"))).toBe(3);
  });

  it("falls back to the horizon, which is what it would inherit anyway", () => {
    expect(days(nextReviewFrom(reviewed, [], "CATALYST"))).toBe(1);
    expect(days(nextReviewFrom(reviewed, [], "TRADE"))).toBe(1);
    expect(days(nextReviewFrom(reviewed, [], "TARGET"))).toBe(7);
    expect(days(nextReviewFrom(reviewed, [], "COMPOUNDER"))).toBe(30);
  });

  it("never returns a date in the past — the overdue-forever bug", () => {
    for (const h of ["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const) {
      expect(nextReviewFrom(reviewed, [], h).getTime()).toBeGreaterThan(
        reviewed.getTime(),
      );
    }
  });
});
