/**
 * CEG, 2026-11-02: the analyst's "Sell if below $289.59" was stored with a
 * wait of 0 days (a September template's "explicit opt-out"). The 9:30 check
 * fired it, the trigger run reviewed and held, and with nothing waiting the
 * 9:35 and 9:40 checks fired it again: one run every five minutes for as
 * long as CEG stayed under the line and the analyst kept holding. The guard
 * "a waiting sale drops the repeats" guards nothing when the run holds.
 *
 * The trigger below is the row exactly as stored after the 9:40 fire. Every
 * write path saves a 0 as the measure's default (a day on a price), and the
 * 2026-11-21 migration wrote the day onto every stored 0, so a sale asks once
 * a trading day and never more. Nothing at check time reads a 0 as anything
 * but a 0.
 */
import { shouldFire, type EvaluationContext } from "./evaluate";
import { applyTriggerDefaults } from "./defaults";
import type { Trigger } from "./types";

const CEG_SELL = {
  id: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e",
  action: "EXIT",
  source: "AGENT",
  fireMode: "ASK_NOW",
  predicate: { is: "below", value: 289.59049999999996, watch: "price" },
  rationale: "under the failed 200-day reclaim at $289.59; I am not lowering protection on a held stock even though the business case still appears intact ahead of earnings.",
  lastFiredAt: "2026-11-02T14:40:21.337Z",
  cooldownDays: 0,
} as unknown as Trigger;

/** A check pass: the clock and CEG's price then (prevClose is Friday's $262.38). */
const pass = (iso: string, price: number): EvaluationContext => ({
  now: new Date(iso),
  latestQuote: { price, changePct: 0, prevClose: 262.38 },
  thesis: { createdAt: new Date("2026-08-13T13:31:26.000Z"), lastReviewedAt: null },
});

/** The row as a write path saves it, and as the migration left the stored one. */
const [SAVED] = applyTriggerDefaults([CEG_SELL]);

describe("CEG's sale stored with a wait of 0 days", () => {
  it("is saved with a one-day wait", () => {
    expect(SAVED.cooldownDays).toBe(1);
  });

  it("the 9:45 pass, five minutes after the 9:40 fire, is inside the wait", () => {
    expect(shouldFire(SAVED, pass("2026-11-02T14:45:24.000Z", 264.29))).toEqual({ fires: false, reason: "cooldown" });
  });

  it("the 9:35 pass on main's sequence would have been inside the wait too", () => {
    const stampedAt0931 = { ...SAVED, lastFiredAt: "2026-11-02T14:31:04.000Z" } as Trigger;
    expect(shouldFire(stampedAt0931, pass("2026-11-02T14:35:16.000Z", 264.55))).toEqual({ fires: false, reason: "cooldown" });
  });

  it("asks again the next trading day while CEG is still under the line", () => {
    expect(shouldFire(SAVED, pass("2026-11-03T14:41:00.000Z", 264.29))).toEqual({ fires: true, reason: "match" });
  });

  it("an Auto-sell stored at 0 is saved the same way", () => {
    const [auto] = applyTriggerDefaults([{ ...CEG_SELL, fireMode: "DO_IT" } as Trigger]);
    expect(auto.cooldownDays).toBe(1);
    expect(shouldFire(auto, pass("2026-11-02T14:45:24.000Z", 264.29))).toEqual({ fires: false, reason: "cooldown" });
  });
});
