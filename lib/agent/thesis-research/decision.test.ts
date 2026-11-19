/**
 * decision.test.ts — validateThesisDecision(), the V2 writer's in-loop
 * Layer-1 pre-validation. These rules are what turns a would-be persist
 * rejection into a one-step repair inside the research loop, so the
 * accept/reject boundary is pinned hard. The decision carries no trigger:
 * the save writes the playbook's watch triggers and the writer tailors them
 * with edit_triggers after it (run-thesis-writer.ts).
 */

import { zodSchema } from "ai";
import {
  heldDecisionSchema,
  lookAgainTrigger,
  thesisDecisionSchema,
  validateThesisDecision,
  type ThesisDecisionInput,
} from "./decision";

const validLong: ThesisDecisionInput = {
  direction: "LONG",
  rationale: "Blackwell ramp is underpriced; the breakout is the buy.",
  horizon: "TARGET",
  setup_id: "BASE_BREAKOUT",
  core_belief:
    "NVDA prints ≥$50B data-center revenue by Q4 FY26 as Blackwell replaces Hopper at hyperscalers.",
  key_assumptions: ["DC capex stays above $200B/yr", "Blackwell yields hold above 60%"],
  invalidation_conditions: ["Gross margin below 70% on next print", "Guidance cut on DC revenue"],
  conviction: "HIGH",
  conviction_rationale:
    "I really like this setup — the catalyst is ahead and consensus is too conservative on DC revenue.",
  variant_view: "Consensus models $42B DC; channel checks support $50B+ — 2 quarters underweighted.",
};

const mintOpts = { mode: "mint" as const, existingStatus: null, currentPrice: 101 };

describe("validateThesisDecision — accept paths", () => {
  it("accepts a fully-specified LONG mint, and reports no reward/risk (the house sets no target)", () => {
    const v = validateThesisDecision(validLong, mintOpts);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect("riskReward" in v).toBe(false);
  });

  it("accepts a PASS with only rationale + horizon (no prices, no conviction)", () => {
    const v = validateThesisDecision(
      { direction: "PASS", rationale: "No setup at current prices; revisit below the 50d around $85.", horizon: "TARGET" },
      mintOpts,
    );
    expect(v.ok).toBe(true);
  });

  it("accepts a LONG with no playbook named: the view stays, and its review comes after the save", () => {
    const v = validateThesisDecision({ ...validLong, setup_id: undefined }, mintOpts);
    expect(v.ok).toBe(true);
  });
});

describe("validateThesisDecision — belief + conviction requirements (LONG/SHORT)", () => {
  it("rejects missing core_belief / thin assumptions / thin invalidations", () => {
    const v = validateThesisDecision({ ...validLong, core_belief: undefined, key_assumptions: ["only one"], invalidation_conditions: [] }, mintOpts);
    expect(v.ok).toBe(false);
    const all = v.errors.join(" ");
    expect(all).toContain("core_belief");
    expect(all).toContain("key_assumptions");
    expect(all).toContain("invalidation_conditions");
  });

  it("STRONG/HIGH conviction without a variant view is stored as MEDIUM, with the reason — not refused", () => {
    const v = validateThesisDecision({ ...validLong, conviction: "STRONG", variant_view: undefined }, mintOpts);
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction).toBe("MEDIUM");
    expect(v.decision?.notes?.join(" ")).toContain("Conviction stored as MEDIUM");
  });

  it("allows MEDIUM conviction without a variant view", () => {
    expect(validateThesisDecision({ ...validLong, conviction: "MEDIUM", variant_view: undefined }, mintOpts).ok).toBe(true);
  });
});

describe("validateThesisDecision — horizon conditionals", () => {
  it("CATALYST requires catalyst_date", () => {
    const v = validateThesisDecision({ ...validLong, horizon: "CATALYST", catalyst_date: undefined }, mintOpts);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("catalyst_date");
  });

  it("rejects an unparseable catalyst_date", () => {
    const v = validateThesisDecision({ ...validLong, horizon: "CATALYST", catalyst_date: "next month sometime" }, mintOpts);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("not a parseable date");
  });
});

describe("submit_thesis carries no trigger language", () => {
  it("its schema has the thesis fields and the playbook, and no trigger or condition", () => {
    const json = JSON.stringify(zodSchema(thesisDecisionSchema).jsonSchema);
    for (const word of ['"triggers"', '"add_triggers"', '"edit_triggers"', '"remove_trigger_ids"', '"Condition"', '"predicate"', '"watch"']) expect([word, json.includes(word)]).toEqual([word, false]);
    expect(json).toContain('"setup_id"');
  });
});

describe("look_again: a view with no buy yet says when to look again, instead of a pass (SNDK 2026-11-04)", () => {
  const opts = { ...mintOpts, todayEt: "2026-11-04" };
  const view = { ...validLong, setup_id: undefined };

  it("after the next report, or on a day 1 to 365 days out, with why: accepted", () => {
    expect(validateThesisDecision({ ...view, look_again: { after_next_report: true, why: "Whether the January report confirms NAND pricing." } }, opts).ok).toBe(true);
    expect(validateThesisDecision({ ...view, look_again: { on_date: "2027-01-28", why: "After the January report." } }, opts).ok).toBe(true);
  });

  it("neither or both, a day out of reach, or no why: sent back with the fix", () => {
    expect(validateThesisDecision({ ...view, look_again: { why: "w" } }, opts).errors).toEqual(["look_again: give one of after_next_report or on_date, with why."]);
    expect(validateThesisDecision({ ...view, look_again: { after_next_report: true, on_date: "2027-01-28", why: "w" } }, opts).ok).toBe(false);
    expect(validateThesisDecision({ ...view, look_again: { on_date: "2026-11-01", why: "w" } }, opts).errors[0]).toMatch(/not a day 1 to 365 days from today/);
    expect(validateThesisDecision({ ...view, look_again: { after_next_report: true, why: " " } }, opts).errors[0]).toMatch(/look_again\.why/);
  });

  it("a PASS takes none: the view it describes is a LONG or SHORT with this look-again", () => {
    const v = validateThesisDecision({ direction: "PASS", rationale: "No setup today; I would look again after the January report.", horizon: "TARGET", look_again: { after_next_report: true, why: "w" } }, opts);
    expect(v.errors).toEqual(["look_again: a PASS takes none. A view you would look again at is LONG or SHORT with no buy and this look-again; or pass with none."]);
  });

  it("code writes the one review: the day after the next report, or every that many days from the day", () => {
    expect(lookAgainTrigger({ after_next_report: true, why: " After the report. " }, "2026-11-04")).toEqual({ action: "REVIEW", predicate: { watch: "report", is: "after", value: 1 }, rationale: "After the report." });
    expect(lookAgainTrigger({ on_date: "2026-11-18", why: "Two weeks on." }, "2026-11-04")).toEqual({ action: "REVIEW", predicate: { watch: "repeat", value: 14 }, rationale: "Two weeks on." });
    expect(lookAgainTrigger(undefined, "2026-11-04")).toBeNull();
  });
});

describe("the Holding refresh's save names no playbook", () => {
  it("its schema has no setup_id, and a call that sends one, or a trigger list, is parsed without it", () => {
    const json = JSON.stringify(zodSchema(heldDecisionSchema).jsonSchema);
    expect(json).not.toContain('"setup_id"');
    const parsed = heldDecisionSchema.parse({ ...validLong, setup_id: "COMPOUNDER_ACCUMULATION", triggers: [{ action: "EXIT" }] });
    expect("setup_id" in parsed).toBe(false);
    expect("triggers" in parsed).toBe(false);
  });
});
