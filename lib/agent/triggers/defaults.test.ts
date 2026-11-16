/**
 * defaults.test.ts — what code writes on a thesis by itself, and the
 * trigger defaults. A stock has triggers and nothing else (2026-11-16): the
 * horizon template writes a held stock's review clock and never a buy, a
 * floor, a target or an "8% below entry" review.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import type { Condition, When } from "@/lib/agent/triggers/condition";
import {
  applyTriggerDefaults,
  defaultTriggersForHorizon,
  accountStandingRules,
  scaleInOnPullbackTrigger,
  mergeTriggers,
  resolvedCadenceDays,
  CADENCE_DAYS_BY_HORIZON,
} from "./defaults";
import { accountSeedTriggers } from "./seed-account";
import { triggersArraySchema } from "./schema";
import { triggerSlot } from "./condition/slot";
import type { Trigger } from "./types";

const HORIZONS = ["COMPOUNDER", "TARGET", "TRADE", "CATALYST"] as const;

describe("defaultTriggersForHorizon — the review clock and nothing else", () => {
  for (const horizon of HORIZONS) {
    it(`HELD ${horizon}: one review clock at the horizon's cadence, stamped DEFAULT, and no price level`, () => {
      const triggers = defaultTriggersForHorizon(horizon, "HELD");
      expect(triggers.map((t) => [t.action, t.predicate, t.source])).toEqual([["REVIEW", { watch: "repeat", value: CADENCE_DAYS_BY_HORIZON[horizon] }, "DEFAULT"]]);
    });

    it(`WATCHING ${horizon}: nothing — a watch carries what its author wrote (DAV-209)`, () => {
      expect(defaultTriggersForHorizon(horizon, "WATCHING")).toEqual([]);
    });
  }

  it("PROMOTED: nothing — the promotion keeps the stock's own triggers", () => {
    expect(defaultTriggersForHorizon("TARGET", "PROMOTED")).toEqual([]);
  });
});

describe("applyTriggerDefaults — cooldownDays:0 hardening", () => {
  function mkTrigger(
    overrides: Partial<Trigger> & Pick<Trigger, "action" | "predicate">,
  ): Trigger {
    return {
      id: "test-id",
      rationale: "test",
      ...overrides,
    };
  }

  it("REVIEW + review clock + cooldownDays:0 → overwrites with the cadence itself", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { watch: "repeat", value: 14 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    // A clock's cooldown is its own interval — anything shorter is a
    // faster clock wearing the slow one's number.
    expect(out.cooldownDays).toBe(14);
  });

  it("REVIEW + price below + cooldownDays:0 → overwrites with per-kind default 1", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { watch: "price", is: "below", value: 108 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(1);
  });

  it("ENTER + earnings beat + cooldownDays:0 → overwrites with per-kind default 7", () => {
    const t = mkTrigger({
      action: "ENTER",
      predicate: { watch: "surprise", is: "beat", value: 0 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(7);
  });

  it("EXIT + price below + cooldownDays:0 → overwrites with per-kind default 1 (a sale asks once a day)", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { watch: "price", is: "below", value: 213.87 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(1);
  });

  it("EXIT + cooldownDays:0 on price above target → overwrites with per-kind default 1", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { watch: "price", is: "above", value: 268 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(1);
  });

  it("non-zero cooldownDays on any action is preserved (no override)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { watch: "repeat", value: 14 },
      cooldownDays: 3,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(3);
  });

  it("undefined cooldownDays still gets default (original behavior)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { watch: "repeat", value: 14 },
      // cooldownDays unset
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(14);
  });

  it("the exact NVDA shape — fills with the cadence", () => {
    // Verbatim shape from the runaway audit row.
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { watch: "repeat", value: 14 },
      rationale:
        "Momentum Breakout trades are days-to-weeks holds; re-check the setup by max hold date and exit if momentum has not followed through.",
      cooldownDays: 0,
    });
    const [out] = applyTriggerDefaults([t]);
    expect(out.cooldownDays).toBe(14);
  });
});

describe("accountStandingRules — the account carries adds, never sell rules", () => {
  it("is the +7% add prompt and nothing else — the −7% add is the Compounder's own (DAV-279)", () => {
    const rules = accountStandingRules();
    expect(rules.map((t) => [t.action, t.predicate])).toEqual([
      ["ADD", { watch: "move", is: "above", value: 7, variable: "prev_close" }],
    ]);
    expect(rules.some((t) => t.action === "EXIT")).toBe(false);
    expect(scaleInOnPullbackTrigger().predicate).toEqual({ watch: "move", is: "below", value: 7, variable: "prev_close" });
  });

  it("the account seed fits the trigger cap", () => {
    expect(triggersArraySchema.safeParse(accountSeedTriggers()).success).toBe(true);
  });
});

describe("mergeTriggers", () => {
  it("an agent-authored same-bucket rung replaces the default", () => {
    const agent: Trigger[] = [
      {
        id: "agent-1",
        predicate: { watch: "price", is: "below", value: 171 },
        action: "EXIT",
        rationale: "Tighter floor under the new base.",
        cooldownDays: 0,
      },
    ];
    const clock: Trigger = { id: "agent-clock", predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Every two weeks." };
    const merged = mergeTriggers(defaultTriggersForHorizon("TARGET", "HELD"), [...agent, clock]);
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
