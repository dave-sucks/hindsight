/**
 * CEG, 2026-11-02: the analyst's "Sell if below $289.59" was stored with a
 * wait of 0 days (a September template's "explicit opt-out"). The 9:30 check
 * fired it, the trigger run reviewed and held, and with nothing waiting the
 * 9:35 and 9:40 checks fired it again: one run every five minutes for as
 * long as CEG stayed under the line and the analyst kept holding. The guard
 * "a waiting sale drops the repeats" guards nothing when the run holds.
 *
 * The trigger below is the row exactly as stored after the 9:40 fire (its
 * wait is gone, 2026-11-17). A trigger fires when it becomes true and again
 * only after a close finds it false, so the sale fires once; the morning read
 * keeps listing it while it holds (needs-action).
 */
import { shouldFire, type EvaluationContext } from "./evaluate";
import type { Trigger } from "./types";

const CEG_SELL = {
  id: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e",
  action: "EXIT",
  source: "AGENT",
  fireMode: "ASK_NOW",
  predicate: { is: "below", value: 289.59049999999996, watch: "price" },
  rationale: "under the failed 200-day reclaim at $289.59; I am not lowering protection on a held stock even though the business case still appears intact ahead of earnings.",
  lastFiredAt: "2026-11-02T14:40:21.337Z",
} as unknown as Trigger;

/** A check pass: the clock and CEG's price then (prevClose is Friday's $262.38). */
const pass = (iso: string, price: number): EvaluationContext => ({
  now: new Date(iso),
  latestQuote: { price, changePct: 0, prevClose: 262.38 },
  thesis: { createdAt: new Date("2026-08-13T13:31:26.000Z"), lastReviewedAt: null },
});

describe("CEG's sale, fired at 9:40 on 2026-11-02", () => {
  it("the 9:45 pass doesn't fire it again", () => {
    expect(shouldFire(CEG_SELL, pass("2026-11-02T14:45:24.000Z", 264.29))).toEqual({ fires: false, reason: "fired" });
  });

  it("nor the next trading day while CEG is still under the line: no close has found it false", () => {
    expect(shouldFire(CEG_SELL, pass("2026-11-03T14:41:00.000Z", 264.29))).toEqual({ fires: false, reason: "fired" });
  });

  it("after a close back above $289.59, it fires again when CEG is back under", () => {
    const backAbove = { ...CEG_SELL, falseAtCloseAt: "2026-11-05T21:20:00.000Z" } as Trigger;
    expect(shouldFire(backAbove, pass("2026-11-06T14:41:00.000Z", 284.1))).toEqual({ fires: true, reason: "match" });
  });

  it("an Auto-sell reads the same way", () => {
    expect(shouldFire({ ...CEG_SELL, fireMode: "DO_IT" } as Trigger, pass("2026-11-02T14:45:24.000Z", 264.29))).toEqual({ fires: false, reason: "fired" });
  });
});
