/**
 * The catalog's rules, stated. The frozen comparison that used to pin them
 * went with the translator; these say each answer outright, the way
 * read.test.ts does for the readers:
 *   - which settings and variables make two rules different (the slot), and
 *     the filing tier's slot, which is what lets a stock's own "anything
 *     material" rule override the account's.
 */
import { triggerSlot } from "./slot";
import { resolveLadder } from "../levels";
import type { Trigger } from "../types";
import type { When } from "./types";

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

  it("the filing tiers share one slot; an 8-K item is its own rule, beside the tier rule", () => {
    const material = slot({ watch: "filing", variable: "tier:MATERIAL" });
    expect(slot({ watch: "filing", variable: "tier:RED" })).toBe(material);
    expect(slot({ watch: "filing", variable: "item:8.01" })).not.toBe(material);
    expect(slot({ watch: "filing", variable: "item:8.01" })).not.toBe(slot({ watch: "filing", variable: "item:7.01" }));
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
