/**
 * decision.test.ts — validateThesisDecision(), the V2 writer's in-loop
 * Layer-1 pre-validation. These rules are what turns a would-be persist
 * rejection into a one-step repair inside the research loop, so the
 * accept/reject boundary is pinned hard.
 */

import { zodSchema } from "ai";
import {
  thesisDecisionSchema,
  validateThesisDecision,
  type ThesisDecisionInput,
} from "./decision";
import { editTriggerOpSchema, editNumber } from "@/lib/agent/triggers/schema";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";

const validLong: ThesisDecisionInput = {
  direction: "LONG",
  rationale: "Blackwell ramp is underpriced; entry at the breakout with a clean 2.5:1.",
  horizon: "TARGET",
  entry_price: 100,
  target_price: 125,
  stop_loss: 90,
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
  it("accepts a fully-specified LONG mint and computes R/R", () => {
    const v = validateThesisDecision(validLong, mintOpts);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.riskReward).toBeCloseTo(2.5);
  });

  it("accepts a PASS with only rationale + horizon (no prices, no conviction)", () => {
    const v = validateThesisDecision(
      {
        direction: "PASS",
        rationale: "No 2:1 setup at current prices; revisit below the 50d around $85.",
        horizon: "TARGET",
      },
      mintOpts,
    );
    expect(v.ok).toBe(true);
  });

  it("accepts a valid SHORT with mirrored price ordering", () => {
    const v = validateThesisDecision(
      {
        ...validLong,
        direction: "SHORT",
        entry_price: 100,
        target_price: 80,
        stop_loss: 108,
      },
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.riskReward).toBeCloseTo(2.5);
  });

  it("accepts omitted triggers (horizon defaults apply downstream)", () => {
    const v = validateThesisDecision({ ...validLong, triggers: undefined }, mintOpts);
    expect(v.ok).toBe(true);
    expect(v.decision?.triggers).toBeUndefined();
  });

  it("accepts a well-formed WATCHING trigger ladder (ENTER + REVIEW)", () => {
    const v = validateThesisDecision(
      {
        ...validLong,
        triggers: [
          {
            predicate: { watch: "price", is: "above", value: 100 },
            action: "ENTER",
            rationale: "breakout entry",
          },
          {
            predicate: { watch: "surprise", is: "miss", value: 3 },
            action: "REVIEW",
            rationale: "guidance miss kills the thesis",
          },
        ],
      },
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.decision?.triggers).toHaveLength(2);
    // Kept as the save takes them; the save mints each id.
    expect(v.decision?.triggers?.[0]).toEqual({ predicate: { watch: "price", is: "above", value: 100 }, action: "ENTER", rationale: "breakout entry" });
  });
});

describe("validateThesisDecision — price ordering; the ratio is reported, not a floor", () => {
  it("accepts a LONG under 2:1 and reports the ratio", () => {
    const v = validateThesisDecision(
      { ...validLong, target_price: 115, stop_loss: 90 }, // 15/10 = 1.5
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.riskReward).toBeCloseTo(1.5);
  });

  it("rejects inverted LONG ordering (stop above entry)", () => {
    const v = validateThesisDecision(
      { ...validLong, stop_loss: 105 },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("price ordering");
  });

  it("accepts a priced plan with a buy and a floor and no target (ETN as read 2026-11-04: buy $410, floor $358.50); no ratio to report", () => {
    const v = validateThesisDecision({ ...validLong, entry_price: 410, target_price: undefined, stop_loss: 358.5 }, mintOpts);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.riskReward).toBeUndefined();
  });

  it("a target, when given, still has to be positive and in order", () => {
    expect(validateThesisDecision({ ...validLong, target_price: 0 }, mintOpts).errors.join(" ")).toContain("target_price: positive when given");
    expect(validateThesisDecision({ ...validLong, target_price: 95 }, mintOpts).errors.join(" ")).toContain("price ordering");
  });

  it("rejects a half-priced plan (target + stop, no entry)", () => {
    const v = validateThesisDecision(
      { ...validLong, entry_price: undefined },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("entry_price");
  });
});

describe("validateThesisDecision — a view with no entry yet (unpriced LONG/SHORT)", () => {
  const unpriced: ThesisDecisionInput = {
    ...validLong,
    entry_price: undefined,
    target_price: undefined,
    stop_loss: undefined,
    rationale: "Bullish into the January readout; entry to be priced after the data. Not a PASS.",
  };

  it("mint: no levels AND no triggers is sent back — a watch's defaults carry no wake (LUXE 2026-09-18 saved with an empty trigger list)", () => {
    const v = validateThesisDecision(unpriced, mintOpts);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/can never come back/);
  });

  it("mint: accepted with no levels and the wake that brings it back", () => {
    const v = validateThesisDecision(
      {
        ...unpriced,
        triggers: [{ predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Price this after the January readout." }],
      } as ThesisDecisionInput,
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.riskReward).toBeUndefined();
  });

  it("refresh on a priced row: omitting the levels AND the triggers is refused — the plan would silently stay", () => {
    const v = validateThesisDecision(unpriced, {
      mode: "refresh",
      existingStatus: "WATCHING",
      currentPrice: 101,
      existingTargetPrice: 130,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("remove_trigger_ids");
  });

  it("refresh on a priced row: removing the plan triggers (and keeping a REVIEW wake) is accepted", () => {
    // FLIPPED 2026-09-09 (DAV-242): the set-down is ops by id, not a resent list.
    const v = validateThesisDecision(
      {
        ...unpriced,
        remove_trigger_ids: ["buy", "floor", "target"],
        add_triggers: [
          { predicate: { watch: "repeat", value: 120 }, action: "REVIEW", rationale: "Price it after the January readout." },
        ],
      },
      { mode: "refresh", existingStatus: "WATCHING", currentPrice: 101, existingTargetPrice: 130 },
    );
    expect(v.ok).toBe(true);
    expect(v.decision?.add_triggers).toHaveLength(1);
  });
});

describe("validateThesisDecision — belief + conviction requirements (LONG/SHORT)", () => {
  it("rejects missing core_belief / thin assumptions / thin invalidations", () => {
    const v = validateThesisDecision(
      {
        ...validLong,
        core_belief: undefined,
        key_assumptions: ["only one"],
        invalidation_conditions: [],
      },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    const all = v.errors.join(" ");
    expect(all).toContain("core_belief");
    expect(all).toContain("key_assumptions");
    expect(all).toContain("invalidation_conditions");
  });

  it("STRONG/HIGH conviction without a variant view is stored as MEDIUM, with the reason — not refused", () => {
    const v = validateThesisDecision(
      { ...validLong, conviction: "STRONG", variant_view: undefined },
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.decision?.conviction).toBe("MEDIUM");
    expect(v.decision?.notes?.join(" ")).toContain("Conviction stored as MEDIUM");
  });

  it("allows MEDIUM conviction without a variant view", () => {
    const v = validateThesisDecision(
      { ...validLong, conviction: "MEDIUM", variant_view: undefined },
      mintOpts,
    );
    expect(v.ok).toBe(true);
  });

});

describe("validateThesisDecision — horizon conditionals", () => {
  it("CATALYST requires catalyst_date", () => {
    const v = validateThesisDecision(
      { ...validLong, horizon: "CATALYST", catalyst_date: undefined },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("catalyst_date");
  });

  it("no longer requires max_hold_days on a TRADE", () => {
    // The column is gone (DAV-195 L8). "This has been open long enough" is a
    // review cadence the TRADE template mints — on the ladder,
    // where it can be seen and edited, instead of a field that fed a
    // template once at mint and then drifted from it.
    const v = validateThesisDecision(
      { ...validLong, horizon: "TRADE" },
      mintOpts,
    );
    expect(v.ok).toBe(true);
  });

  it("rejects an unparseable catalyst_date", () => {
    const v = validateThesisDecision(
      { ...validLong, horizon: "CATALYST", catalyst_date: "next month sometime" },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("not a parseable date");
  });
});

describe("validateThesisDecision — trigger action-set by position state", () => {
  const enterTrigger = {
    predicate: { watch: "price", is: "above", value: 100 } as const,
    action: "ENTER" as const,
    rationale: "breakout",
  };
  const exitTrigger = {
    predicate: { watch: "price", is: "below", value: 90 } as const,
    action: "EXIT" as const,
    rationale: "stop",
  };

  it("mint (no position): EXIT/TRIM/ADD are forbidden", () => {
    const v = validateThesisDecision({ ...validLong, triggers: [exitTrigger] }, mintOpts);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("no position exists");
  });

  // On a refresh the same rules run on `add_triggers` (DAV-242: a refresh
  // edits one trigger at a time; `triggers` is a mint-only argument).
  it("HOLDING refresh: adding an ENTER is forbidden", () => {
    const v = validateThesisDecision(
      { ...validLong, add_triggers: [enterTrigger] },
      { mode: "refresh", existingStatus: "HOLDING", currentPrice: 101 },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("ENTER triggers are forbidden");
  });

  it("HOLDING refresh: adding EXIT + REVIEW is legal", () => {
    const v = validateThesisDecision(
      {
        ...validLong,
        add_triggers: [
          exitTrigger,
          {
            predicate: { watch: "repeat", value: 7 },
            action: "REVIEW" as const,
            rationale: "scheduled hygiene",
          },
        ],
      },
      { mode: "refresh", existingStatus: "HOLDING", currentPrice: 101 },
    );
    expect(v.ok).toBe(true);
  });

  it("PROMOTED refresh (no live position): adding EXIT is forbidden, ENTER is legal", () => {
    const promotedOpts = { mode: "refresh" as const, existingStatus: "PROMOTED", currentPrice: 101 };
    expect(
      validateThesisDecision({ ...validLong, add_triggers: [exitTrigger] }, promotedOpts).ok,
    ).toBe(false);
    expect(
      validateThesisDecision({ ...validLong, add_triggers: [enterTrigger] }, promotedOpts).ok,
    ).toBe(true);
  });

  it("refresh: a whole `triggers` list is refused — edit one at a time", () => {
    const v = validateThesisDecision(
      { ...validLong, triggers: [exitTrigger] },
      { mode: "refresh", existingStatus: "HOLDING", currentPrice: 101 },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("one at a time");
  });

  it("refresh: a level edit without a rationale is refused in the loop", () => {
    const v = validateThesisDecision(
      { ...validLong, edit_triggers: [{ id: "floor", value: 95 }] },
      { mode: "refresh", existingStatus: "HOLDING", currentPrice: 101 },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("requires a rationale");
  });

  it("mint: ops are refused — there is nothing to edit yet", () => {
    const v = validateThesisDecision({ ...validLong, remove_trigger_ids: ["x"] }, mintOpts);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("a mint has no existing triggers");
  });

  it("a trigger the app cannot read is dropped and named for the stock's Activity; the decision is not refused", () => {
    const v = validateThesisDecision(
      { ...validLong, triggers: [{ nonsense: true } as never] },
      mintOpts,
    );
    expect(v.ok).toBe(true);
    expect(v.decision?.triggers).toEqual([]);
    expect(v.decision?.dropped).toEqual([{ field: "triggers", why: "the a trigger", reason: expect.any(String) }]);
  });

  // PRAX and AAOI 2026-11-13: the filing in `variable` passed here and the save refused it; in `value` it was dropped here.
  it("a filing or a line written where storage keeps it is moved to `value`; written as the save wants it, it is kept", () => {
    const filing = (predicate: Record<string, unknown>) => ({ action: "REVIEW", fireMode: "ASK_NOW", predicate, rationale: "Any 8-K other-events filing from Praxis." });
    for (const predicate of [{ watch: "filing", variable: "item:8.01" }, { watch: "filing", value: "item:8.01" }]) {
      const v = validateThesisDecision({ ...validLong, triggers: [filing(predicate)] as never }, mintOpts);
      expect(v.decision?.triggers).toEqual([filing({ watch: "filing", value: "item:8.01" })]);
      expect(v.decision?.dropped).toBeUndefined();
    }
    const line = validateThesisDecision({ ...validLong, triggers: [{ action: "REVIEW", predicate: { watch: "price", is: "below", variable: "sma50" }, rationale: "r" }] as never }, mintOpts);
    expect(line.decision?.triggers?.[0].predicate).toEqual({ watch: "price", is: "below", value: "sma50" });
  });
});

describe("validateThesisDecision — persist-gate mirrors (review finding #4)", () => {
  it("rejects a PASS carrying triggers", () => {
    const v = validateThesisDecision(
      {
        direction: "PASS",
        rationale: "No edge at current prices; keep an eye on the reclaim level.",
        horizon: "TARGET",
        triggers: [
          { predicate: { watch: "price", is: "above", value: 100 }, action: "ENTER", rationale: "x" },
        ],
      },
      mintOpts,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("a PASS stores no triggers");
  });

  it("a refresh on a thesis with no triggers may omit triggers — zero is legal (DAV-209)", () => {
    const v = validateThesisDecision({ ...validLong, triggers: undefined }, {
      mode: "refresh",
      existingStatus: "WATCHING",
      currentPrice: 101,
      existingTargetPrice: 130,
    });
    expect(v.ok).toBe(true);
  });

  it("refresh: adding a REVIEW wake on a watch is accepted — the buy trigger already on the row is not being replaced", () => {
    // FLIPPED 2026-09-09 (DAV-242): the "ladder must carry an ENTER / EXIT"
    // mirrors existed because a resent list replaced the whole ladder. An
    // op adds one trigger; the buy and sell triggers on the row stay, and
    // the tool checks the resulting plan once at persist.
    const v = validateThesisDecision(
      {
        ...validLong,
        add_triggers: [
          { predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "hygiene" },
        ],
      },
      { mode: "refresh", existingStatus: "WATCHING", currentPrice: 90, existingTargetPrice: 130 },
    );
    expect(v.ok).toBe(true);
  });
});

// ─── DAV-257: one edit form for the writer and the save ─────────────────────
// PRAX 2026-09-11: the writer put the review cadence's wording into
// edit_triggers[0].action. submit_thesis accepted it (its copy of the form had
// action: string), update_thesis refused it at save (the enum), and the whole
// paid refresh was thrown away — the save has no retry, the submit loop does.

describe("submit_thesis edit_triggers — the same form update_thesis saves (DAV-257)", () => {
  const PRAX_0911_EDIT = {
    id: "3998148e-9487-4d0a-9dca-99b71178e1a9",
    action:
      "Weekly PDUFA-path check-in — monitor for any new FDA correspondence, BIMO outcomes, or analyst updates ahead of the December 27 relutrigine PDUFA.",
  };

  it("rejects PRAX's 09-11 edit at submit, where the writer can fix it", () => {
    const parsed = thesisDecisionSchema.safeParse({ ...validLong, edit_triggers: [PRAX_0911_EDIT] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["edit_triggers", 0, "action"]);
  });

  it("accepts a real action name", () => {
    const parsed = thesisDecisionSchema.safeParse({
      ...validLong,
      edit_triggers: [{ id: PRAX_0911_EDIT.id, action: "REVIEW", days: 7, rationale: "Weekly into the PDUFA." }],
    });
    expect(parsed.success).toBe(true);
  });

  it("the writer and update_thesis edit a trigger with the one schema, and an old `days` reads as the value", () => {
    // Two hand-written copies drifted once (PRAX 09-11); there is one now.
    expect(thesisDecisionSchema.shape.edit_triggers.unwrap().element).toBe(editTriggerOpSchema);
    const op = { id: PRAX_0911_EDIT.id, action: "REVIEW", days: 7, rationale: "Weekly into the PDUFA." };
    const parsed = editTriggerOpSchema.parse(op);
    expect(parsed).toMatchObject({ id: PRAX_0911_EDIT.id, action: "REVIEW", rationale: "Weekly into the PDUFA." });
    expect(editNumber(parsed)).toEqual({ value: 7, unit: "days" });
  });
});

describe("submit_thesis carries the trigger once", () => {
  it("triggers and add_triggers point at one definition, so each measure appears one time", () => {
    const json = JSON.stringify(zodSchema(thesisDecisionSchema).jsonSchema);
    expect(json.split('"$ref":"#/definitions/Trigger"').length - 1).toBe(2);
    // The condition, with its lists and settings, is defined once too.
    expect(json.split('"Condition":{').length - 1).toBe(1);
    expect(json.split('"const":"price"').length - 1).toBe(1);
    expect(json.split('"sma150"').length - 1).toBe(2); // once as a price's line, once as what a move is measured from
  });
});

// SNDK 2026-11-04, the writer's second submit for the PEAD Specialist (run cmw1f80da000007i6ct1fll02),
// cut to the fields the check reads. Its rationale: "I am passing rather than forcing a setup that does
// not exist. I would look again if the stock re-establishes a base above the 200-day average…". The
// save refused its two reviews on a PASS, so it saved a pass with nothing to bring it back.
describe("validateThesisDecision — a view with no setup yet is a watch, not a pass (SNDK 2026-11-04)", () => {
  const sndk: ThesisDecisionInput = {
    direction: "PASS",
    horizon: "TARGET",
    rationale:
      "A clean beat-and-raise the market sold 13.5%; the chart is broken. I am passing rather than forcing a setup that does not exist. I would look again above the 200-day or after the January report.",
    core_belief:
      "SanDisk is the leading independent NAND flash producer, embedded in AI data centres through multi-year supply agreements covering half its fiscal 2027 bits. If NAND pricing holds through fiscal 2027, the earnings make it cheap; what has to stay true is that data-centre pricing does not roll over.",
    key_assumptions: [
      "Data centre NAND pricing holds through fiscal Q2 2027, confirmed by the gross margin result (84.5–85.5% guided) at the January earnings release.",
      "Supply agreements covering 50% of fiscal 2027 bits hold revenue in the $12.2–$12.6B guide, checked at the January earnings release.",
    ],
    invalidation_conditions: [
      "Q2 FY2027 EPS below the raised guidance midpoint of $56 (pre-split), checked at the January 2027 earnings release.",
      "A second major peer confirms NAND price declines in its next quarterly commentary.",
    ],
    conviction: "LOW",
    conviction_rationale: "Cheap on current numbers, but the market just said it does not trust them to hold.",
    triggers: [
      { action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 1266.06 }, rationale: "A reclaim of the 200-day is the first sign the chart is trying to repair." },
      { action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "report", is: "before", value: 14 }, rationale: "Fourteen days before the January print, decide whether to price an entry." },
    ],
  } as ThesisDecisionInput;
  const pead = { ...mintOpts, currentPrice: 1126.52, setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]) };

  it("the PASS it sent with its reviews is sent back as the watch it described", () => {
    const v = validateThesisDecision(sndk, pead);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/send your direction \(LONG or SHORT\) with no entry, stop or target, and keep these triggers/);
  });

  it("the same view as a LONG with no levels and no setup is accepted: the setup prices a view, it never decides one", () => {
    const v = validateThesisDecision({ ...sndk, direction: "LONG" } as ThesisDecisionInput, pead);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("a priced plan still names its setup", () => {
    const v = validateThesisDecision(
      { ...sndk, direction: "LONG", entry_price: 1270, stop_loss: 1170, stop_basis: "A close under $1,170 would mean the repair failed; 1 ATR under the 200-day." } as ThesisDecisionInput,
      pead,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/setup_id: required on a priced plan/);
  });
});
