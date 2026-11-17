/**
 * A pre-catalyst buy carries its window (2026-11-17): "within 70 days before the event date" inside
 * an "and". It is true from 70 days before the thesis's event date until the event, so the buy fires
 * only in the run-up; standing alone, a date count before the event is a schedule that can't buy.
 *
 * EXEL (Catalyst Event PM, WATCHING), event date 2027-03-03, 50-day $62.45 on the 2026-11-16 snapshot.
 */
import { shouldFire } from "./evaluate";
import { allowedActions, readsTheTape, sentenceOf, shapeOf, whenProblem, type When } from "./condition";
import { PLAYBOOK_TEMPLATES } from "@/lib/agent/knowledge/playbook-templates";
import type { Trigger } from "./types";

const EVENT = new Date("2027-03-03T00:00:00Z");
const NEAR_50 = PLAYBOOK_TEMPLATES.PRE_CATALYST.find((t) => t.action === "ENTER" && "match" in t.predicate && t.predicate.conditions[0].watch === "move")!;
const buy = { id: "exel-buy", action: "ENTER", predicate: NEAR_50.predicate, rationale: "x", fireMode: "ASK_NOW" } as unknown as Trigger;
const ctx = (now: string, price = 63.1) =>
  ({
    latestQuote: { price, changePct: 0.4, prevClose: 62.85 },
    indicators: { sma: { 50: 62.45 } },
    thesis: { createdAt: new Date("2026-11-10T00:00:00Z"), lastReviewedAt: null, catalystDate: EVENT, direction: "LONG" },
    now: new Date(now),
  }) as never;

describe("EXEL — 'Buy if within 2% of the 50-day average and within 70 days before the event date'", () => {
  it("reads as a window", () => {
    expect(sentenceOf(buy)).toBe("Buy if within 2% of the 50-day average and within 70 days before the event date");
    expect(sentenceOf({ ...buy, action: "STOP_WATCHING", predicate: { watch: "from_date", is: "before", value: 21, variable: "event" } } as Trigger)).toBe("Stop watching 21 days before the event date");
  });

  it("at $63.10 on 2026-11-18, 105 days out: no; on 2026-12-24, 69 days out: it fires; after the event: no", () => {
    expect(shouldFire(buy, ctx("2026-11-18T15:00:00Z"))).toEqual({ fires: false, reason: "no-match" });
    expect(shouldFire(buy, ctx("2026-12-24T15:00:00Z"))).toEqual({ fires: true, reason: "match" });
    expect(shouldFire(buy, ctx("2027-03-04T15:00:00Z"))).toEqual({ fires: false, reason: "no-match" });
  });

  it("with no event date on the thesis, it never fires", () => {
    const none = { ...(ctx("2026-12-24T15:00:00Z") as object), thesis: { createdAt: new Date("2026-11-10T00:00:00Z"), lastReviewedAt: null, catalystDate: null, direction: "LONG" } };
    expect(shouldFire(buy, none as never).fires).toBe(false);
  });

  it("the dialog and the save take it; the morning read counts it as read off the tape", () => {
    const w = shapeOf(buy.predicate)!;
    expect(whenProblem(w, { level: "THESIS", held: false })).toBeNull();
    expect(allowedActions(w, { held: false, standing: false })).toContain("ENTER");
    expect(readsTheTape(w)).toBe(true);
  });

  it("standing alone, a date count before the event is a schedule: it can't buy, and two windows alone are refused", () => {
    const lone = { watch: "from_date", is: "before", value: 70, variable: "event" } as When;
    expect(allowedActions(lone, { held: false, standing: false })).not.toContain("ENTER");
    expect(whenProblem({ match: "all", conditions: [lone, { ...lone, value: 30 }] } as When, { level: "THESIS", held: false })).toBe("A window needs a condition beside it.");
    // A date count after the event (or from the buy) is still a schedule that stands alone.
    expect(whenProblem({ match: "all", conditions: [{ watch: "price", is: "above", value: 60 }, { watch: "from_date", is: "after", value: 10, variable: "event" }] } as When, { level: "THESIS", held: false })).toBe("A schedule stands alone. Add it as its own trigger.");
  });
});
