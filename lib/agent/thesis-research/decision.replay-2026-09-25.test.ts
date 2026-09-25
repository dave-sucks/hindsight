/**
 * decision.replay-2026-09-25.test.ts — the three catalyst decisions the
 * writer refused and threw away on 2026-09-25, through the same validator
 * (DAV-316).
 *
 * The runs: DYN cmugfv69n000904jt5u0nhozo, IBRX cmugfung5000504jtclq53vki,
 * BBIO cmugfuw5q000704jtzd3joghm. Each had done its research and reached a
 * decision — watch, no priced plan until the window opens, a dated review.
 * DYN was refused for a conviction rationale of 501 characters against a
 * 400 rule; IBRX and BBIO for that and a trigger kind that doesn't exist
 * (`REVIEW_AFTER_DAYS`, meant as "look again in N days"). None got a retry.
 *
 * On main all three fail validation. After the fix all three pass: the
 * rationale is kept whole, the invented kind is read as the review cadence
 * it meant, and what was fixed is written on the decision so it shows on
 * the stock.
 */
import raw from "@/lib/agent/__fixtures__/writer-and-trade-refusals-2026-09-25.json";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { validateThesisDecision, type ThesisDecisionInput } from "./decision";

type Fixture = { runId: string; last: { toolName: string; input: ThesisDecisionInput } };
const fx = raw as unknown as Record<"DYN" | "IBRX" | "BBIO", Fixture>;

// The Catalyst Event PM's setups on 2026-09-25 (AgentConfig.setupIds).
const opts = {
  mode: "mint" as const,
  existingStatus: null,
  currentPrice: null,
  setups: setupsForAnalyst(["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"]),
  chart: null,
};

describe("the 2026-09-25 catalyst decisions are accepted, with the fixes written down", () => {
  it("DYN: a 501-character conviction rationale is kept whole", () => {
    const v = validateThesisDecision(fx.DYN.last.input, opts);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction_rationale?.length).toBeGreaterThan(400);
    expect(v.decision?.triggers?.map((t) => t.predicate.kind)).toEqual(["REVIEW_CADENCE"]);
    expect(v.decision?.notes).toBeUndefined();
  });

  it.each(["IBRX", "BBIO"] as const)("%s: the invented REVIEW_AFTER_DAYS becomes the review cadence it meant, and says so", (t) => {
    const input = fx[t].last.input;
    const sent = (input.triggers as Array<{ predicate: { kind: string; days: number } }>)[0].predicate;
    expect(sent.kind).toBe("REVIEW_AFTER_DAYS");

    const v = validateThesisDecision(input, opts);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    const trig = v.decision?.triggers ?? [];
    expect(trig).toHaveLength(1);
    expect(trig[0].predicate).toMatchObject({ kind: "REVIEW_CADENCE", days: sent.days });
    expect(trig[0].action).toBe("REVIEW");
    expect(v.decision?.notes?.join(" ")).toMatch(/REVIEW_AFTER_DAYS.*saved as a review in \d+ days/);
  });

  it("a top-tier call without a variant view is stored one tier down, with the reason, not refused", () => {
    const v = validateThesisDecision({ ...fx.DYN.last.input, conviction: "HIGH", variant_view: undefined }, opts);
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction).toBe("MEDIUM");
    expect(v.decision?.notes?.join(" ")).toMatch(/Conviction stored as MEDIUM: HIGH needs a variant view/);
  });

  it("a trigger the app cannot read at all is dropped with a note; the decision still saves", () => {
    const v = validateThesisDecision(
      { ...fx.DYN.last.input, triggers: [{ predicate: { kind: "MOON_PHASE", full: true }, action: "REVIEW", rationale: "?" } as never, ...(fx.DYN.last.input.triggers ?? [])] },
      opts,
    );
    expect(v.ok).toBe(true);
    expect(v.decision?.triggers).toHaveLength(1);
    expect(v.decision?.notes?.join(" ")).toMatch(/Dropped one trigger the app couldn't read/);
  });
});
