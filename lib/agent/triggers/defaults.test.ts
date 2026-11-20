/**
 * defaults.test.ts — the trigger defaults. A stock has triggers and nothing
 * else (2026-11-16): code writes nothing on a stock by its horizon, not even
 * a review clock; a playbook's lines are its templates.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import type { Condition, When } from "@/lib/agent/triggers/condition";
import {
  applyTriggerDefaults,
  accountStandingRules,
  scaleInOnPullbackTrigger,
  mergeTriggers,
  resolvedCadenceDays,
} from "./defaults";
import { accountSeedTriggers } from "./seed-account";
import { triggersArraySchema } from "./schema";
import { triggerSlot } from "./condition/slot";
import type { Trigger } from "./types";

describe("accountStandingRules — the trail on every holding and a look on a big day (expert review 1.1)", () => {
  it("is the 6% trail off the high, sent to the agent, and the big day up and down on twice the normal volume", () => {
    const rules = accountStandingRules();
    expect(rules.map((t) => [t.action, t.fireMode, t.predicate])).toEqual([
      ["EXIT", "ASK_NOW", { watch: "move", is: "below", value: 6, variable: "peak" }],
      ["REVIEW", "ASK_NOW", { match: "all", conditions: [{ watch: "move", is: "above", value: 7, variable: "prev_close" }, { watch: "volume", value: 2 }] }],
      ["REVIEW", "ASK_NOW", { match: "all", conditions: [{ watch: "move", is: "below", value: 7, variable: "prev_close" }, { watch: "volume", value: 2 }] }],
    ]);
    // No add on a one-day spike: an add is a playbook's line on the stock.
    expect(rules.some((t) => t.action === "ADD")).toBe(false);
    expect(scaleInOnPullbackTrigger().predicate).toEqual({ watch: "move", is: "below", value: 7, variable: "prev_close" });
  });

  it("the account seed fits the trigger cap", () => {
    expect(triggersArraySchema.safeParse(accountSeedTriggers()).success).toBe(true);
  });
});

describe("mergeTriggers", () => {
  it("an agent-authored same-bucket rung replaces the default", () => {
    const template: Trigger = { id: "tpl-clock", predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "Weekly.", source: "DEFAULT" };
    const agent: Trigger[] = [
      {
        id: "agent-1",
        predicate: { watch: "price", is: "below", value: 171 },
        action: "EXIT",
        rationale: "Tighter floor under the new base.",
      },
    ];
    const clock: Trigger = { id: "agent-clock", predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Every two weeks." };
    const merged = mergeTriggers([template], [...agent, clock]);
    // The analyst's clock wins its bucket; the template adds nothing else.
    expect(merged.map((t) => t.id)).toEqual(["agent-1", "agent-clock"]);
  });
});

// ── ENTER dedup bucket ────────────────────────────────────────────────

describe("triggerSlot — ENTER on a price level is one bucket", () => {
  it("treats breakout and dip entry rungs as the same intent", () => {
    // An ENTER rung on an absolute price is ONE decision — "where I start
    // this position" — however it's phrased. Without collapsing them, a
    // thesis could carry two contradictory ENTERs, one of which can never
    // be right.
    const breakout: Trigger = { id: "buy", predicate: { watch: "price", is: "above", value: 262 }, action: "ENTER", rationale: "I buy the breakout." };
    const dip = {
      ...breakout,
      predicate: { watch: "price", is: "below", value: 262 } as When,
    };

    expect(triggerSlot(breakout)).toBe(triggerSlot(dip));
    expect(mergeTriggers([dip], [breakout]).filter((t) => t.action === "ENTER")).toHaveLength(1);
  });
});

describe("resolvedCadenceDays — only the review clock counts", () => {
  it("a count from the buy or the event date does not set the review cadence", () => {
    expect(
      resolvedCadenceDays([
        { predicate: { watch: "from_date", is: "after", value: 60, variable: "buy" } },
        { predicate: { watch: "from_date", is: "before", value: 3, variable: "event" } },
      ]),
    ).toBeNull();
    expect(
      resolvedCadenceDays([
        { predicate: { watch: "from_date", is: "after", value: 60, variable: "buy" } },
        { predicate: { watch: "repeat", value: 7 } },
      ]),
    ).toBe(7);
  });
});
