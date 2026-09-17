/**
 * entry-raises.test.ts — the MSFT shape (DAV-253). Replayed from the
 * thesis's real audit rows: on 2026-09-09 the buy level was raised from
 * $480 to $497 with the stock at $493.95 and no structure cited ("Mandate
 * rule 5 is unambiguous… the stock moved structurally higher"). The two
 * August edits moved the level toward the price (a pullback level under
 * the tape) and don't count; the 09-14 set-down (to null) doesn't either.
 */
import { citesStructure, entryRaisesAway } from "./entry-raises";
import { computePlanSanity } from "./plan-sanity";

const MSFT = [
  { type: "UPDATED", timestamp: new Date("2026-08-28T16:03:49Z"), priceAtTime: 504.98, rationale: "MSFT's old priced plan is stale and the row needs a live entry framework again.", fieldChanges: { entryPrice: { from: null, to: 470 } } },
  { type: "UPDATED", timestamp: new Date("2026-08-28T17:31:41Z"), priceAtTime: 506.24, rationale: "Reviewed after the entry trigger fired and passed on the trade.", fieldChanges: { entryPrice: { from: 470, to: 480 } } },
  { type: "UPDATED", timestamp: new Date("2026-09-09T06:15:57Z"), priceAtTime: 493.95, rationale: "The prior WATCHING thesis sat below $480 for months while Azure reaccelerated to 43% and the stock moved structurally higher. Mandate rule 5 is unambiguous.", fieldChanges: { entryPrice: { from: 480, to: 497 } } },
  { type: "UPDATED", timestamp: new Date("2026-09-14T16:02:46Z"), priceAtTime: 495.63, rationale: "MSFT's buy level sitting on the live tape was a bad standing instruction.", fieldChanges: { entryPrice: { from: 497, to: null } } },
];
const NOW = new Date("2026-09-15T12:00:00Z");

describe("entryRaisesAway — MSFT 2026-09-09", () => {
  it("counts the one raise above the price with no structure cited", () => {
    expect(entryRaisesAway({ direction: "LONG", updates: MSFT, now: NOW })).toEqual([
      { date: "2026-09-09", from: 480, to: 497, price: 493.95 },
    ]);
  });
  it("a raise that names the structure is a re-priced condition, not a raise away", () => {
    const priced = [{ ...MSFT[2], rationale: "Re-priced to the base pivot $497 — a close above it on volume is the breakout entry." }];
    expect(entryRaisesAway({ direction: "LONG", updates: priced, now: NOW })).toEqual([]);
    expect(citesStructure("the stock moved structurally higher")).toBe(false);
    expect(citesStructure("under the 50-day average")).toBe(true);
  });
  it("outside the 30-day window nothing counts", () => {
    expect(entryRaisesAway({ direction: "LONG", updates: MSFT, now: new Date("2026-10-20T00:00:00Z") })).toEqual([]);
  });
  it("the plan-sanity flag says it with the count and the numbers", () => {
    const flags = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 497,
      targetPrice: 560,
      stopLoss: 470,
      currentPrice: 493.95,
      entryRaisesAway: entryRaisesAway({ direction: "LONG", updates: MSFT, now: NOW }),
    });
    const flag = flags.find((f) => f.kind === "ENTRY_RAISED_AWAY");
    expect(flag?.text).toContain("moved above the price once in the last 30 days with no structure cited (2026-09-09: $480.00 → $497.00 with the stock at $493.95)");
  });
});
