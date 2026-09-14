/**
 * quote-age.test.ts — one rule for how old a price is (buys, chat, research).
 *
 * ETN, 2026-09-14 09:30:25 ET (DAV-261): the quote still reported Friday's
 * close $425.37 as "now" and Thursday's $409.15 as the prior close, so
 * Friday's move above the $418 buy level counted a second time. ETN's high
 * that day was $404.86. Only the Compounder's 4-stock limit stopped the buy.
 * On main the buy fires; here it waits, and a sell on the same quote still
 * fires.
 */

import { freshQuotePrice, readPrice, staleForTrading } from "./quote-age";
import { shouldFire } from "@/lib/agent/triggers/evaluate";
import type { Trigger } from "@/lib/agent/triggers/types";

const NOW = new Date("2026-09-14T13:30:25Z"); // Mon 09:30:25 ET
const FRIDAY_CLOSE_T = Math.floor(new Date("2026-09-11T20:00:00Z").getTime() / 1000);
const etnQuote = { c: 425.37, pc: 409.15, t: FRIDAY_CLOSE_T };

const etnBuy: Trigger = {
  id: "etn-buy",
  predicate: { kind: "PRICE_ABOVE", level: 418 },
  action: "ENTER",
  rationale: "Buy on a clean breakout above the recent repair range near $418.",
  source: "AGENT",
};
const etnFloor: Trigger = { id: "etn-floor", predicate: { kind: "PRICE_BELOW", level: 430 }, action: "EXIT", rationale: "floor", source: "AGENT" };

const ctxFor = (quote: { c: number; pc: number; t: number }) => ({
  thesis: { createdAt: new Date("2026-06-01T00:00:00Z"), direction: "LONG" as const },
  now: NOW,
  latestQuote: {
    price: quote.c,
    changePct: ((quote.c - quote.pc) / quote.pc) * 100,
    prevClose: quote.pc,
    stale: staleForTrading(quote, NOW),
  },
});

describe("ETN at 09:30 on 2026-09-14 — Friday's close served as today's price", () => {
  it("the quote is stale for trading", () => {
    expect(staleForTrading(etnQuote, NOW)).toBe(true);
  });

  it("the $418 buy does not fire (on main it fired)", () => {
    expect(shouldFire(etnBuy, ctxFor(etnQuote))).toEqual({ fires: false, reason: "stale-quote" });
  });

  it("a sell on the same stale quote still fires — skipping a stop is worse", () => {
    expect(shouldFire(etnFloor, { ...ctxFor(etnQuote), latestQuote: { ...ctxFor(etnQuote).latestQuote, price: 404 } }).fires).toBe(true);
  });

  it("once a fresh quote arrives the buy is judged normally", () => {
    const fresh = { c: 419, pc: 425.37, t: Math.floor(NOW.getTime() / 1000) - 60 };
    expect(staleForTrading(fresh, NOW)).toBe(false);
  });
});

describe("readPrice — the words", () => {
  it("a live quote needs no warning", () => {
    const r = readPrice({ ticker: "IOT", quote: { c: 39.6, t: Math.floor(NOW.getTime() / 1000) - 120 }, now: NOW });
    expect(r).toMatchObject({ price: 39.6, live: true, warning: null, ageMinutes: 2 });
  });

  it("a stale quote during market hours says how old it is", () => {
    const r = readPrice({ ticker: "ETN", quote: etnQuote, now: NOW });
    expect(r.live).toBe(false);
    expect(r.warning).toMatch(/^Live price for \$ETN is not current: \$425\.37 printed Fri, 09\/11, 4:00 PM ET/);
  });

  it("outside market hours the last print is simply the last price — no alarm", () => {
    const sunday = new Date("2026-09-13T15:00:00Z");
    expect(readPrice({ ticker: "ETN", quote: etnQuote, now: sunday }).warning).toBeNull();
  });

  it("freshQuotePrice is the same rule the written-price stamp uses", () => {
    expect(freshQuotePrice(etnQuote, NOW)).toBeNull();
  });
});
