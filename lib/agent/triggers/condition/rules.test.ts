/**
 * The catalog's rules, stated. The frozen comparison that used to pin them
 * went with the translator; these say each answer outright, the way
 * read.test.ts does for the readers:
 *   - the cooldown a trigger gets when it names none, per measure, variable
 *     and action;
 *   - which conditions are states (a review on one asks at most weekly);
 *   - which settings and variables make two rules different (the slot), and
 *     the filing tier's slot, which is what lets a stock's own "anything
 *     material" rule override the account's.
 */
import { defaultCooldownDays, isState } from "./rules";
import { triggerSlot } from "./slot";
import { resolveLadder } from "../levels";
import type { Trigger } from "../types";
import type { When } from "./types";

describe("the cooldown a trigger gets when it names none", () => {
  const cases: Array<[string, When, string, number]> = [
    ["a typed price", { watch: "price", is: "below", value: 150 }, "EXIT", 1],
    ["a price under an average, sold", { watch: "price", is: "below", variable: "sma200" }, "EXIT", 1],
    ["a price under an average, reviewed", { watch: "price", is: "below", variable: "sma200" }, "REVIEW", 7],
    ["a new 52-week high, reviewed", { watch: "price", is: "above", variable: "high52" }, "REVIEW", 1],
    // A gain from our entry latches: up 10% stays up 10%, so a week, whatever it does.
    ["a gain from our entry, added to", { watch: "move", is: "above", value: 10, variable: "entry" }, "ADD", 7],
    ["a gain from our entry, reviewed", { watch: "move", is: "above", value: 10, variable: "entry" }, "REVIEW", 7],
    ["a fall from our entry, sold", { watch: "move", is: "below", value: 8, variable: "entry" }, "EXIT", 7],
    ["a day's move", { watch: "move", is: "below", value: 7, variable: "prev_close" }, "REVIEW", 1],
    ["a trail", { watch: "move", is: "below", value: 12, variable: "peak" }, "EXIT", 1],
    ["near the 52-week high, reviewed", { watch: "move", is: "near", value: 5, variable: "high52" }, "REVIEW", 7],
    ["near the 52-week high, bought", { watch: "move", is: "near", value: 5, variable: "high52" }, "ENTER", 1],
    ["near an average", { watch: "move", is: "near", value: 2, variable: "sma50" }, "ENTER", 1],
    ["volume", { watch: "volume", value: 2 }, "REVIEW", 1],
    ["RSI", { watch: "rsi", is: "below", value: 30 }, "ENTER", 1],
    ["strength vs the S&P", { watch: "strength", value: 5 }, "REVIEW", 7],
    ["a gap over 3 sessions", { watch: "gap", value: 4, settings: { withinDays: 3 } }, "REVIEW", 3],
    ["a gap, no window", { watch: "gap", value: 4 }, "REVIEW", 1],
    ["the report window", { watch: "report", is: "before", value: 3 }, "REVIEW", 30],
    ["an earnings result", { watch: "surprise", is: "beat", value: 0 }, "REVIEW", 7],
    ["a filing", { watch: "filing", variable: "tier:MATERIAL" }, "REVIEW", 0],
    ["insider buying", { watch: "insiders", value: 3 }, "REVIEW", 30],
    ["every 30 days", { watch: "repeat", value: 30 }, "REVIEW", 30],
    ["45 days after the buy", { watch: "from_date", is: "after", value: 45, variable: "buy" }, "EXIT", 45],
  ];
  it.each(cases)("%s (%s): %s days", (_name, w, action, days) => {
    expect(defaultCooldownDays(w, action)).toBe(days);
  });

  it("a rule naming several filings is one rule and keeps the filing's; a mix takes its slowest, at least a day", () => {
    expect(defaultCooldownDays({ match: "any", conditions: [{ watch: "filing", variable: "item:8.01" }, { watch: "filing", variable: "item:7.01" }] }, "REVIEW")).toBe(0);
    expect(defaultCooldownDays({ match: "all", conditions: [{ watch: "price", is: "above", value: 50 }, { watch: "volume", value: 2 }] }, "ENTER")).toBe(1);
    expect(defaultCooldownDays({ match: "all", conditions: [{ watch: "move", is: "above", value: 10, variable: "entry" }, { watch: "volume", value: 2 }] }, "ADD")).toBe(7);
  });
});

describe("which conditions are states", () => {
  it.each([
    [{ watch: "price", is: "below", variable: "sma200" }, true],
    [{ watch: "price", is: "above", variable: "sma50" }, true],
    [{ watch: "move", is: "near", value: 5, variable: "high52" }, true],
    [{ watch: "strength", value: 5 }, true],
    [{ watch: "price", is: "below", value: 150 }, false],
    [{ watch: "price", is: "above", variable: "high52" }, false],
    [{ watch: "move", is: "near", value: 2, variable: "sma50" }, false],
    [{ watch: "move", is: "below", value: 12, variable: "peak" }, false],
    [{ watch: "rsi", is: "below", value: 30 }, false],
    [{ watch: "volume", value: 2 }, false],
  ] as Array<[When, boolean]>)("%j is a state: %s", (w, state) => {
    expect(isState(w)).toBe(state);
  });

  it("a group is a state only when every condition is", () => {
    expect(isState({ match: "all", conditions: [{ watch: "price", is: "below", variable: "sma200" }, { watch: "strength", value: -5 }] })).toBe(true);
    expect(isState({ match: "all", conditions: [{ watch: "price", is: "below", variable: "sma200" }, { watch: "rsi", is: "below", value: 30 }] })).toBe(false);
  });
});

describe("which rules are the same rule (the slot)", () => {
  const slot = (predicate: When, action = "REVIEW") => triggerSlot({ predicate, action: action as Trigger["action"] });

  it("a typed value is never identity: $248 and $256 are one floor", () => {
    expect(slot({ watch: "price", is: "below", value: 248 }, "EXIT")).toBe(slot({ watch: "price", is: "below", value: 256 }, "EXIT"));
    expect(slot({ watch: "move", is: "below", value: 12, variable: "peak" }, "EXIT")).toBe(slot({ watch: "move", is: "below", value: 25, variable: "peak" }, "EXIT"));
  });

  it("the RSI length is identity: a 2-day and a 14-day RSI rule are two rules", () => {
    const two = slot({ watch: "rsi", is: "below", value: 10, settings: { period: 2 } }, "ENTER");
    const fourteen = slot({ watch: "rsi", is: "below", value: 30, settings: { period: 14 } }, "ENTER");
    expect(two).not.toBe(fourteen);
    // Unset is the default length, the same rule as 14 written out.
    expect(slot({ watch: "rsi", is: "below", value: 25 }, "ENTER")).toBe(fourteen);
  });

  it("the window of strength vs the S&P is identity", () => {
    expect(slot({ watch: "strength", value: 5, settings: { window: "1M" } })).not.toBe(slot({ watch: "strength", value: 5, settings: { window: "3M" } }));
  });

  it("what a move is measured from is identity: a trail and a fall from our entry are two rules", () => {
    expect(slot({ watch: "move", is: "below", value: 12, variable: "peak" }, "EXIT")).not.toBe(slot({ watch: "move", is: "below", value: 12, variable: "entry" }, "EXIT"));
  });

  it("the filing tiers share one slot, and a rule naming a tier takes it", () => {
    const material = slot({ watch: "filing", variable: "tier:MATERIAL" });
    expect(slot({ watch: "filing", variable: "tier:RED" })).toBe(material);
    expect(slot({ match: "any", conditions: [{ watch: "filing", variable: "tier:MATERIAL" }, { watch: "filing", variable: "item:5.02" }] })).toBe(material);
    // A rule naming only 8-K items is its own rule, added beside the tier rule.
    expect(slot({ match: "any", conditions: [{ watch: "filing", variable: "item:8.01" }, { watch: "filing", variable: "item:7.01" }] })).not.toBe(material);
  });

  it("so a stock's own tier rule overrides the account's", () => {
    const rule = (id: string, variable: string): Trigger => ({ id, predicate: { watch: "filing", variable } as When, action: "REVIEW", rationale: id });
    const ladder = resolveLadder({ thesis: [rule("stock", "tier:RED")], account: [rule("account", "tier:MATERIAL")] });
    expect(ladder.map((t) => t.id)).toEqual(["stock"]);
  });

  it("a buy on a typed price is one slot whichever way it's set", () => {
    expect(slot({ watch: "price", is: "above", value: 60 }, "ENTER")).toBe(slot({ watch: "price", is: "below", value: 55 }, "ENTER"));
    expect(slot({ watch: "price", is: "above", value: 60 }, "EXIT")).not.toBe(slot({ watch: "price", is: "below", value: 55 }, "EXIT"));
  });
});
