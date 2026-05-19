/**
 * defaults.test.ts — coverage for per-horizon trigger templates.
 *
 * Focus: REVIEW_DATE_HIT cooldown by horizon (A5) and the WATCHING vs
 * HELD template split. Pure function tests; no DB.
 */

import { defaultTriggersForHorizon } from "./defaults";
import type { Trigger } from "./types";

function findReviewDateHit(triggers: Trigger[]): Trigger | undefined {
  return triggers.find((t) => t.predicate.kind === "REVIEW_DATE_HIT");
}

describe("defaultTriggersForHorizon — REVIEW_DATE_HIT cooldown by horizon", () => {
  // The WATCHING templates each include a REVIEW_DATE_HIT trigger whose
  // cooldown should match the horizon's hygiene cadence. Pre-A5 the
  // cooldown was a flat 1 day across every horizon, which let COMPOUNDER
  // theses with stale nextReviewAt re-fire every market day.

  it("CATALYST WATCHING has REVIEW_DATE_HIT cooldown of 7 days", () => {
    const triggers = defaultTriggersForHorizon(
      "CATALYST",
      { targetPrice: 100, direction: "LONG" },
      "WATCHING",
    );
    const r = findReviewDateHit(triggers);
    expect(r).toBeDefined();
    expect(r!.cooldownDays).toBe(7);
  });

  it("TRADE WATCHING has REVIEW_DATE_HIT cooldown of 7 days", () => {
    const triggers = defaultTriggersForHorizon(
      "TRADE",
      { targetPrice: 100, direction: "LONG" },
      "WATCHING",
    );
    const r = findReviewDateHit(triggers);
    expect(r).toBeDefined();
    expect(r!.cooldownDays).toBe(7);
  });

  it("TARGET WATCHING has REVIEW_DATE_HIT cooldown of 14 days", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      { targetPrice: 100, direction: "LONG" },
      "WATCHING",
    );
    const r = findReviewDateHit(triggers);
    expect(r).toBeDefined();
    expect(r!.cooldownDays).toBe(14);
  });

  it("COMPOUNDER WATCHING has REVIEW_DATE_HIT cooldown of 60 days (not 1d)", () => {
    // The regression to prevent: a COMPOUNDER WATCHING thesis with a
    // 1-day REVIEW_DATE_HIT cooldown re-fires every market day until
    // update_thesis bumps nextReviewAt. 60d aligns with the quarterly
    // hygiene cadence.
    const triggers = defaultTriggersForHorizon(
      "COMPOUNDER",
      { targetPrice: 100, direction: "LONG" },
      "WATCHING",
    );
    const r = findReviewDateHit(triggers);
    expect(r).toBeDefined();
    expect(r!.cooldownDays).toBe(60);
  });
});

describe("defaultTriggersForHorizon — HELD vs WATCHING shape", () => {
  it("HELD COMPOUNDER does NOT include REVIEW_DATE_HIT", () => {
    // HELD positions use Thesis.nextReviewAt for cron-based scheduled
    // review; the REVIEW_DATE_HIT trigger is a WATCHING-side convenience.
    const triggers = defaultTriggersForHorizon(
      "COMPOUNDER",
      { entryPrice: 100, targetPrice: 150, stopLoss: 90, direction: "LONG" },
      "HELD",
    );
    expect(findReviewDateHit(triggers)).toBeUndefined();
  });

  it("WATCHING LONG attaches an ENTER trigger on targetPrice (breakout)", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      { targetPrice: 100, direction: "LONG" },
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeDefined();
    expect(enter!.predicate.kind).toBe("PRICE_ABOVE");
    if (enter!.predicate.kind === "PRICE_ABOVE") {
      expect(enter!.predicate.level).toBe(100);
    }
  });

  it("WATCHING SHORT attaches an ENTER trigger on PRICE_BELOW target (mirror)", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      { targetPrice: 100, direction: "SHORT" },
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeDefined();
    expect(enter!.predicate.kind).toBe("PRICE_BELOW");
  });

  it("HELD does NOT attach an ENTER trigger (you can't enter what you hold)", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      { entryPrice: 100, targetPrice: 150, stopLoss: 90, direction: "LONG" },
      "HELD",
    );
    expect(triggers.find((t) => t.action === "ENTER")).toBeUndefined();
  });
});
