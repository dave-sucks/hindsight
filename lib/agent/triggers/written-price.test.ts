/**
 * written-price.test.ts — a buy trigger set on a down day is not dead on
 * arrival.
 *
 * The replay uses MSFT's real 2026-09-08 session: prior close $499.70
 * (09-04; 09-07 was Labor Day), traded $490.15–$495.19, closed $493.95
 * (Alpaca daily bars). No production write has hit this yet — every buy
 * level written during market hours since the crossing rule shipped
 * (2026-09-02) was on an up day or was a fill — so the write itself is the
 * shape it describes: an analyst sets "buy above $492.50" with MSFT at $492
 * mid-morning, and MSFT trades up through it inside that day's real range.
 * It runs through the real write path (applyTriggerOps, as update_thesis
 * calls it) and the real fire rule (shouldFire, as the evaluator calls it).
 * On main the buy reads "no-crossing" — yesterday's $499.70 close already
 * clears $492.50 — and never fires that day.
 */

import { applyTriggerOps } from "./ops";
import { shouldFire } from "./evaluate";
import { stampWrittenPrice } from "./written-price";
import type { Trigger } from "./types";

const floor: Trigger = { id: "floor", predicate: { kind: "PRICE_BELOW", level: 470 }, action: "EXIT", rationale: "Floor under the August low.", source: "AGENT" };
const target: Trigger = { id: "target", predicate: { kind: "PRICE_ABOVE", level: 560 }, action: "REVIEW", rationale: "Target at the prior high.", source: "AGENT" };

// 2026-09-08, ET = UTC−4.
const at = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00-04:00`);
const MSFT_PRIOR_CLOSE = 499.7;

function writeBuy(level: number, price: number, when: Date): Trigger {
  const out = applyTriggerOps({
    stored: [floor, target],
    ops: [{ op: "level", slot: "ENTRY", price: level }],
    direction: "LONG",
    status: "WATCHING",
    actor: "AGENT",
    currentPrice: price,
    now: when,
    mintId: () => "buy",
  } as Parameters<typeof applyTriggerOps>[0]);
  return out.triggers.find((t) => t.action === "ENTER")!;
}

const check = (t: Trigger, price: number, when: Date, prevClose = MSFT_PRIOR_CLOSE) =>
  shouldFire(t, {
    thesis: { createdAt: new Date("2026-08-01T00:00:00Z"), direction: "LONG" },
    now: when,
    latestQuote: { price, changePct: ((price - prevClose) / prevClose) * 100, prevClose },
  });

describe("MSFT, 2026-09-08 — a buy level set on a down day", () => {
  const buy = writeBuy(492.5, 492, at("10:30"));

  it("is stored as a breakout above the price it was set at", () => {
    expect(buy.predicate).toMatchObject({ kind: "PRICE_ABOVE", level: 492.5 });
  });

  it("fires when MSFT trades up through it that morning (on main: no-crossing, never fires that day)", () => {
    expect(check(buy, 493, at("11:00"))).toEqual({ fires: true, reason: "match" });
  });

  it("does not fire before the price reaches it", () => {
    expect(check(buy, 492.2, at("10:35")).fires).toBe(false);
  });

  it("the next day the ordinary rule is back: already above at 09-08's $493.95 close → no re-fire", () => {
    expect(check(buy, 494, new Date("2026-09-09T10:00:00-04:00"), 493.95)).toEqual({ fires: false, reason: "no-crossing" });
  });

  it("a pullback buy set the same way fires on the first dip", () => {
    // Set at $492 with the level under the price → "buy below $491.50".
    const dip = writeBuy(491.5, 492, at("10:30"));
    expect(dip.predicate).toMatchObject({ kind: "PRICE_BELOW", level: 491.5 });
    // Yesterday's close was $499.70, so on main this one already worked — the
    // stamp must not break it.
    expect(check(dip, 491.2, at("11:00"))).toEqual({ fires: true, reason: "match" });
  });
});

describe("stampWrittenPrice — only the server sets it", () => {
  const now = new Date("2026-09-08T14:30:00Z");
  const enter = (id: string, level: number, extra: Partial<Trigger> = {}): Trigger => ({
    id, predicate: { kind: "PRICE_ABOVE", level }, action: "ENTER", rationale: "buy", ...extra,
  });

  it("stamps a new buy trigger with the live price and time", () => {
    expect(stampWrittenPrice([], [enter("a", 100)], 99, now)[0]).toMatchObject({ writtenPrice: 99, writtenAt: now.toISOString() });
  });

  it("keeps the original stamp on a buy trigger this write didn't change", () => {
    const old = enter("a", 100, { writtenPrice: 95, writtenAt: "2026-09-01T14:00:00.000Z" });
    expect(stampWrittenPrice([old], [old], 99, now)[0]).toMatchObject({ writtenPrice: 95 });
  });

  it("re-stamps a buy trigger whose level moved", () => {
    const old = enter("a", 100, { writtenPrice: 95, writtenAt: "2026-09-01T14:00:00.000Z" });
    expect(stampWrittenPrice([old], [enter("a", 102)], 99, now)[0]).toMatchObject({ writtenPrice: 99 });
  });

  it("overwrites a stamp an agent supplied, and drops it when there is no live price", () => {
    const forged = enter("a", 100, { writtenPrice: 1, writtenAt: now.toISOString() });
    expect(stampWrittenPrice([], [forged], 99, now)[0].writtenPrice).toBe(99);
    expect(stampWrittenPrice([], [forged], null, now)[0].writtenPrice).toBeUndefined();
  });

  it("never stamps a sell or review", () => {
    const sell: Trigger = { id: "s", predicate: { kind: "PRICE_BELOW", level: 90 }, action: "EXIT", rationale: "floor", writtenPrice: 95, writtenAt: now.toISOString() };
    expect(stampWrittenPrice([], [sell], 99, now)[0].writtenPrice).toBeUndefined();
  });
});
