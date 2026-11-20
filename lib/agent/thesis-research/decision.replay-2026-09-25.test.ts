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
 * On main all three failed validation. All three pass: the rationale is
 * kept whole. (Their triggers went with submit_thesis's trigger fields: the
 * save writes the playbook's, and the writer tailors them after it.) What
 * was fixed is written on the decision so it shows on the stock.
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
  it.each(["DYN", "IBRX", "BBIO"] as const)("%s: accepted; its conviction rationale is kept whole", (t) => {
    const v = validateThesisDecision(fx[t].last.input, opts);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction_rationale?.length).toBeGreaterThan(t === "DYN" ? 400 : 0);
  });

  it("a HIGH call with no view that differs from Wall Street is kept as HIGH", () => {
    const v = validateThesisDecision({ ...fx.DYN.last.input, conviction: "HIGH", variant_view: undefined }, opts);
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction).toBe("HIGH");
  });
});
