/**
 * Wall Street's targets as a line a rule can watch (2026-11-04): three price
 * variables, `street_avg`, `street_high`, `street_low`, read off the newest
 * StreetConsensus row within 14 days. From below only: the Street is
 * evidence, never a floor. No row (none stored, too old, the feed down) reads
 * false. V's real Street row from 2026-11-04 is the case.
 */
import type { EvaluationContext } from "../evaluate";
import { predicateInputSchema, triggerPredicateSchema } from "../schema";
import { conditionProblem } from "./check";
import { describeStreetFire } from "./facts";
import { SHAPE_CHECKER } from "./read";
import { readsSource } from "./rules";
import { triggerText } from "./describe";
import { refusalOf } from "./valid";
import type { Condition, When } from "./types";

const held = { level: "THESIS" as const, held: true };
/** V's StreetConsensus row as get_theses read it on 2026-11-04: 25 buy / 2 hold / 0 sell, targets $405–$500, avg $454. */
const street = { targetAvg: 454, targetHigh: 500, targetLow: 405, asOf: "2026-11-04" };
const ctx = (price: number, row: EvaluationContext["street"] = street): EvaluationContext => ({
  latestQuote: { price, changePct: 0 },
  street: row,
  thesis: { createdAt: new Date("2026-10-01T00:00:00Z"), direction: "LONG" },
  now: new Date("2026-11-04T15:00:00Z"),
});
const above: Condition = { watch: "price", is: "above", variable: "street_avg" };

describe("the Street as a variable: the words and what fits", () => {
  it("reads as a sentence with the Street's words", () => {
    expect(triggerText("REVIEW", above, true)).toBe("Review if above the Street's average target");
    expect(triggerText("TRIM", { watch: "price", is: "above", variable: "street_high" } as When, true)).toContain("above the Street's high target");
  });

  it("fits from below only: a sell (or anything) below a Street target is refused, by the form and by the save", () => {
    const below: Condition = { watch: "price", is: "below", variable: "street_avg" };
    expect(conditionProblem(above, held)).toBeNull();
    expect(conditionProblem(below, held)).toMatch(/doesn't work with Below/);
    expect(refusalOf(above)).toBeNull();
    expect(refusalOf(below)).toMatch(/never below the Street/);
    // The save's schema (the stored shape) and the agents' schema (the line in `value`) give the same answer.
    expect(triggerPredicateSchema.safeParse(above).success).toBe(true);
    expect(triggerPredicateSchema.safeParse(below).success).toBe(false);
    expect(predicateInputSchema().safeParse({ watch: "price", is: "above", value: "street_avg" }).success).toBe(true);
    expect(predicateInputSchema().safeParse({ watch: "price", is: "below", value: "street_avg" }).success).toBe(false);
    expect(predicateInputSchema().safeParse({ watch: "price", is: "below", value: "street_low" }).success).toBe(false);
  });

  it("tells the check to load the Street row, not the chart snapshot", () => {
    expect(readsSource(above, "street")).toBe(true);
    expect(readsSource(above, "snapshot")).toBe(false);
    expect(readsSource({ watch: "price", is: "above", variable: "sma50" }, "street")).toBe(false);
  });
});

describe("the Street as a variable: the check, on V's real row (avg $454, high $500, low $405 as of 11-04)", () => {
  it("holds above the average, not at or under it", () => {
    expect(SHAPE_CHECKER.holds(above, ctx(street.targetAvg + 1))).toBe(true);
    expect(SHAPE_CHECKER.holds(above, ctx(street.targetAvg))).toBe(false);
    expect(SHAPE_CHECKER.holds(above, ctx(434.35))).toBe(false);
    expect(SHAPE_CHECKER.holds({ watch: "price", is: "above", variable: "street_high" }, ctx(street.targetHigh + 0.01))).toBe(true);
    expect(SHAPE_CHECKER.holds({ watch: "price", is: "above", variable: "street_low" }, ctx(434.35))).toBe(true);
  });

  it("with no row (none stored, a row too old, the feed down) the condition does not hold", () => {
    expect(SHAPE_CHECKER.holds(above, ctx(999, null))).toBe(false);
    expect(SHAPE_CHECKER.holds(above, { ...ctx(999), street: undefined })).toBe(false);
  });

  it("the fire carries the target it read and the price against it", () => {
    expect(describeStreetFire(above, street, 460)).toBe("Street average target $454.00 (as of 11-04); price $460.00 (+1.3% from it)");
    expect(describeStreetFire(above, null, 460)).toBeNull();
    expect(describeStreetFire({ watch: "price", is: "above", value: 100 }, street, 460)).toBeNull();
  });
});
