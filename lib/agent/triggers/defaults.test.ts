/**
 * defaults.test.ts — verifies the P1-3 fix.
 *
 * Pre-fix: watchingEntryTrigger read `thesis.targetPrice` and emitted
 * PRICE_ABOVE(targetPrice) → ENTER. Since `targetPrice` was the
 * take-profit level when the thesis went ACTIVE, the default ENTER
 * fired at the same level as the take-profit EXIT — buying at the sell
 * level. Production bug: MDB 2026-05-25.
 *
 * Post-fix: watchingEntryTrigger reads `thesis.entryPrice` (the writer's
 * actual entry intent). targetPrice is reserved exclusively for the
 * take-profit semantic on ACTIVE rows.
 *
 * These tests pin the behavior so the fix can't quietly regress.
 *
 * See docs/plans/PRICE_LEVEL_SEMANTICS.md.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  applyTriggerCooldownDefaults,
  defaultTriggersForHorizon,
  horizonStandingRules,
  mergeTriggers,
  type ThesisShape,
} from "./defaults";
import { rulesForHorizon } from "./load-levels";
import { accountSeedTriggers } from "./seed-account";
import { levelTriggersArraySchema } from "./schema";
import { triggerBucket } from "./bucket";
import type { Trigger } from "./types";

function base(overrides: Partial<ThesisShape> = {}): ThesisShape {
  return {
    entryPrice: 175,
    targetPrice: 240,
    stopLoss: 168,
    direction: "LONG",
    ...overrides,
  };
}

describe("defaultTriggersForHorizon — WATCHING ENTER trigger (P1-3 fix)", () => {
  it("LONG WATCHING TARGET — ENTER fires at entryPrice, NOT targetPrice", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeDefined();
    expect(enter!.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 }); // entryPrice
    expect(enter!.predicate).not.toEqual({ kind: "PRICE_ABOVE", level: 240 }); // NOT targetPrice
  });

  it("LONG WATCHING TRADE — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("TRADE", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("LONG WATCHING COMPOUNDER — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("COMPOUNDER", base(), "WATCHING");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("LONG WATCHING CATALYST (catalyst far out) — ENTER fires at entryPrice", () => {
    // CATALYST defaults to event-based ENTER (EARNINGS_BEAT) when
    // catalystDate is within 7 days. With catalystDate further out,
    // falls back to the standard breakout-entry default.
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const triggers = defaultTriggersForHorizon(
      "CATALYST",
      base({ catalystDate: farFuture }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("SHORT WATCHING — ENTER fires PRICE_BELOW(entryPrice), direction-aware", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      base({ direction: "SHORT", entryPrice: 175, targetPrice: 110, stopLoss: 195 }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_BELOW", level: 175 });
  });

  it("PROMOTED reuses WATCHING templates — ENTER fires at entryPrice", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "PROMOTED");
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter?.predicate).toEqual({ kind: "PRICE_ABOVE", level: 175 });
  });

  it("no ENTER trigger when entryPrice is null (writer wants 'buy now via no-trigger')", () => {
    const triggers = defaultTriggersForHorizon(
      "TARGET",
      base({ entryPrice: null }),
      "WATCHING",
    );
    const enter = triggers.find((t) => t.action === "ENTER");
    expect(enter).toBeUndefined();
  });

  it("targetPrice still drives EXIT/REVIEW triggers on ACTIVE side (unchanged)", () => {
    // The fix is scoped to WATCHING. On the HELD/ACTIVE side, targetPrice
    // remains the take-profit level driving exit-side triggers — that's
    // its correct meaning.
    const triggers = defaultTriggersForHorizon("TARGET", base(), "HELD");
    const targetTrigger = triggers.find(
      (t) =>
        t.predicate.kind === "PRICE_ABOVE" &&
        "level" in t.predicate &&
        t.predicate.level === 240,
    );
    expect(targetTrigger).toBeDefined();
    // It's a take-profit REVIEW (or EXIT depending on horizon), NOT an ENTER.
    expect(targetTrigger!.action).not.toBe("ENTER");
  });
});

/**
 * 2026-06-02 NVDA runaway — the agent stamped `cooldownDays: 0` on a
 * a 14d REVIEW rung via `update_thesis`. The old `!= null` check
 * walked past the 0 and the trigger evaluator fired 15 times in 70 min
 * before manual hotfix. These tests pin the new rule: on non-EXIT
 * actions, `cooldownDays: 0` is structurally invalid and the default
 * filler must overwrite it.
 */
describe("applyTriggerCooldownDefaults — cooldownDays:0 hardening", () => {
  function mkTrigger(
    overrides: Partial<Trigger> & Pick<Trigger, "action" | "predicate">,
  ): Trigger {
    return {
      id: "test-id",
      rationale: "test",
      ...overrides,
    };
  }

  it("REVIEW + REVIEW_CADENCE + cooldownDays:0 → overwrites with the cadence itself", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "REVIEW_CADENCE", days: 14 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    // A clock's cooldown is its own interval — anything shorter is a
    // faster clock wearing the slow one's number.
    expect(out.cooldownDays).toBe(14);
  });

  it("REVIEW + PRICE_BELOW + cooldownDays:0 → overwrites with per-kind default 1", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "PRICE_BELOW", level: 108 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(1);
  });

  it("ENTER + EARNINGS_BEAT + cooldownDays:0 → overwrites with per-kind default 7", () => {
    const t = mkTrigger({
      action: "ENTER",
      predicate: { kind: "EARNINGS_BEAT" },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(7);
  });

  it("EXIT + cooldownDays:0 is PRESERVED — terminal-action opt-out is legitimate", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { kind: "PRICE_BELOW", level: 213.87 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(0);
  });

  it("EXIT + cooldownDays:0 on PRICE_ABOVE target is preserved", () => {
    const t = mkTrigger({
      action: "EXIT",
      predicate: { kind: "PRICE_ABOVE", level: 268 },
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(0);
  });

  it("non-zero cooldownDays on any action is preserved (no override)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "REVIEW_CADENCE", days: 14 },
      cooldownDays: 3,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(3);
  });

  it("undefined cooldownDays still gets default (original behavior)", () => {
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "REVIEW_CADENCE", days: 14 },
      // cooldownDays unset
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(14);
  });

  it("the exact NVDA shape — fills with the cadence", () => {
    // Verbatim shape from the runaway audit row.
    const t = mkTrigger({
      action: "REVIEW",
      predicate: { kind: "REVIEW_CADENCE", days: 14 },
      rationale:
        "Momentum Breakout trades are days-to-weeks holds; re-check the setup by max hold date and exit if momentum has not followed through.",
      cooldownDays: 0,
    });
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.cooldownDays).toBe(14);
  });
});

const HELD_HORIZONS = ["COMPOUNDER", "TARGET", "TRADE", "CATALYST"] as const;

/**
 * DAV-250: the fill no longer stamps constant sell rules or scale-ins onto
 * the thesis. A thesis-level rung beats any account rule in its bucket, so
 * stamping them froze every holding on one TARGET ladder (an 8% trail sell
 * on compounders whose mandate forbids it). They are account rules now, one
 * set per horizon — see the horizonStandingRules block below.
 */
describe("defaultTriggersForHorizon — HELD carries only the thesis's own levels", () => {
  const CONSTANT_KINDS = new Set(["GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH", "PRICE_MOVE_PCT"]);

  for (const horizon of HELD_HORIZONS) {
    it(`HELD ${horizon} stamps no scale-in and no percentage sell rule`, () => {
      const triggers = defaultTriggersForHorizon(horizon, base(), "HELD");
      expect(triggers.filter((t) => t.action === "ADD")).toEqual([]);
      expect(triggers.filter((t) => CONSTANT_KINDS.has(t.predicate.kind))).toEqual([]);
    });

    it(`HELD ${horizon} keeps its review clock and its floor`, () => {
      const triggers = defaultTriggersForHorizon(horizon, base(), "HELD");
      expect(triggers.filter((t) => t.predicate.kind === "REVIEW_CADENCE")).toHaveLength(1);
      expect(
        triggers.some(
          (t) => t.action === "EXIT" && t.predicate.kind === "PRICE_BELOW" && t.predicate.level === 168,
        ),
      ).toBe(true);
    });

    it(`WATCHING ${horizon} has no ADD and no protection rungs`, () => {
      const triggers = defaultTriggersForHorizon(horizon, base(), "WATCHING");
      expect(triggers.find((t) => t.action === "ADD")).toBeUndefined();
      expect(triggers.filter((t) => CONSTANT_KINDS.has(t.predicate.kind))).toEqual([]);
    });
  }

  it("PROMOTED has no ADD rung (no live position yet)", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "PROMOTED");
    expect(triggers.find((t) => t.action === "ADD")).toBeUndefined();
  });
});

describe("horizonStandingRules — one sell ladder per horizon (DAV-250)", () => {
  const rules = horizonStandingRules();
  const shape = (h: (typeof HELD_HORIZONS)[number]) =>
    rulesForHorizon(rules, h).map((t) => [t.predicate, t.action]);
  const trail = (pct: number, extra: object = {}) => ({ kind: "TRAILING_FROM_HIGH", pct, ...extra });
  const gain = (pct: number, direction: "UP" | "DOWN") => ({ kind: "GAIN_FROM_ENTRY", pct, direction });
  const move = (direction: "UP" | "DOWN") => ({ kind: "PRICE_MOVE_PCT", pct: 7, direction, window: "1D" });

  it("TRADE: +7% add, +8% review, 8% trail sell, −7% sell, beat-and-fade review — no pullback add", () => {
    expect(shape("TRADE")).toEqual([
      [move("UP"), "ADD"],
      [gain(8, "UP"), "REVIEW"],
      [trail(8), "EXIT"],
      [gain(7, "DOWN"), "EXIT"],
      [expect.objectContaining({ kind: "AND" }), "REVIEW"],
    ]);
  });

  it("TARGET: the 12% trail only arms once the position has been up 10%", () => {
    expect(shape("TARGET")).toEqual([
      [move("UP"), "ADD"],
      [move("DOWN"), "ADD"],
      [gain(10, "UP"), "REVIEW"],
      [trail(12, { armAtGainPct: 10 }), "EXIT"],
      [gain(12, "DOWN"), "REVIEW"],
      [expect.objectContaining({ kind: "AND" }), "REVIEW"],
    ]);
  });

  it("CATALYST: no percentage sell — the event is the exit and the thesis carries the stop", () => {
    expect(shape("CATALYST")).toEqual([
      [move("UP"), "ADD"],
      [move("DOWN"), "ADD"],
      [gain(10, "DOWN"), "REVIEW"],
    ]);
  });

  it("COMPOUNDER: a 15% give-back and the 200-day are questions; 25% is the only automatic sale", () => {
    expect(shape("COMPOUNDER")).toEqual([
      [move("UP"), "ADD"],
      [move("DOWN"), "ADD"],
      [gain(15, "UP"), "REVIEW"],
      [trail(15), "REVIEW"],
      [{ kind: "VS_SMA", period: 200, direction: "BELOW" }, "REVIEW"],
      [trail(25), "EXIT"],
      [gain(15, "DOWN"), "REVIEW"],
    ]);
    const exits = rulesForHorizon(rules, "COMPOUNDER").filter((t) => t.action === "EXIT");
    expect(exits).toHaveLength(1);
    expect(exits[0].predicate).toEqual(trail(25));
  });

  it("every sell rule is a terminal EXIT with the cooldown opt-out", () => {
    for (const t of rules.filter((r) => r.action === "EXIT")) expect(t.cooldownDays).toBe(0);
  });

  it("the account seed fits under the level cap, with room to add", () => {
    expect(levelTriggersArraySchema.safeParse(accountSeedTriggers()).success).toBe(true);
    expect(accountSeedTriggers().length).toBeLessThanOrEqual(24);
  });

  it("cooldown defaults fill the gain REVIEW rungs with the 7d latch", () => {
    const filled = applyTriggerCooldownDefaults(rulesForHorizon(rules, "TARGET"));
    const up = filled.find((t) => t.predicate.kind === "GAIN_FROM_ENTRY" && t.predicate.direction === "UP")!;
    expect(up.cooldownDays).toBe(7);
  });

  it("mints fresh ids on every call", () => {
    const a = horizonStandingRules();
    const b = horizonStandingRules();
    for (let i = 0; i < a.length; i++) expect(a[i].id).not.toBe(b[i].id);
  });
});

describe("rulesForHorizon — a horizon rule beats an every-horizon rule in the same bucket", () => {
  const every: Trigger = {
    id: "every",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: 6 },
    action: "EXIT",
    rationale: "every horizon",
  };
  const compounder: Trigger = { ...every, id: "c", predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 }, horizons: ["COMPOUNDER"] };

  it("the compounder gets its own 25%, not the tighter every-horizon 6%", () => {
    expect(rulesForHorizon([every, compounder], "COMPOUNDER").map((t) => t.id)).toEqual(["c"]);
  });
  it("other horizons keep the every-horizon rule", () => {
    expect(rulesForHorizon([every, compounder], "TRADE").map((t) => t.id)).toEqual(["every"]);
  });
  it("a thesis of another horizon never sees a scoped rule", () => {
    expect(rulesForHorizon([compounder], "TARGET")).toEqual([]);
  });
});

describe("mergeTriggers", () => {
  it("an agent-authored same-bucket rung replaces the default", () => {
    const agent: Trigger[] = [
      {
        id: "agent-1",
        predicate: { kind: "PRICE_BELOW", level: 171 },
        action: "EXIT",
        rationale: "Tighter floor under the new base.",
        cooldownDays: 0,
      },
    ];
    const merged = mergeTriggers(defaultTriggersForHorizon("TARGET", base(), "HELD"), agent);
    const floors = merged.filter((t) => t.predicate.kind === "PRICE_BELOW" && t.action === "EXIT");
    expect(floors).toHaveLength(1);
    expect(floors[0].id).toBe("agent-1");
    expect(merged.some((t) => t.predicate.kind === "REVIEW_CADENCE")).toBe(true);
  });
});

// ── A watch carries only what its author wrote (DAV-209) ──
describe("defaultTriggersForHorizon — WATCHING carries only the author's levels", () => {
  for (const horizon of HELD_HORIZONS) {
    it(`WATCHING ${horizon} template carries NO review clock`, () => {
      const triggers = defaultTriggersForHorizon(horizon, base(), "WATCHING");
      expect(triggers.filter((t) => t.predicate.kind === "REVIEW_CADENCE")).toHaveLength(0);
    });

    it(`WATCHING ${horizon} with no prices emits NOTHING`, () => {
      const triggers = defaultTriggersForHorizon(
        horizon,
        { entryPrice: null, targetPrice: null, stopLoss: null, catalystDate: null, direction: "LONG" },
        "WATCHING",
      );
      expect(triggers).toEqual([]);
    });

    it(`WATCHING ${horizon} emits ONLY the author's own levels`, () => {
      const kinds = new Set(defaultTriggersForHorizon(horizon, base(), "WATCHING").map((t) => t.predicate.kind));
      expect(kinds.has("REVIEW_CADENCE")).toBe(false);
      expect(kinds.has("EARNINGS_BEAT")).toBe(false);
      expect(kinds.has("EARNINGS_MISS")).toBe(false);
    });
  }

  it("PROMOTED still gets its re-entry rung off the author's entry level", () => {
    const triggers = defaultTriggersForHorizon("TARGET", base(), "PROMOTED");
    expect(triggers.some((t) => t.action === "ENTER")).toBe(true);
  });
});

// ── ENTER dedup bucket ────────────────────────────────────────────────

describe("triggerBucket — ENTER on a price level is one bucket", () => {
  it("treats breakout and dip entry rungs as the same intent", () => {
    // An ENTER rung on an absolute price is ONE decision — "where I start
    // this position" — however it's phrased. Without collapsing them, a
    // thesis could carry two contradictory ENTERs, one of which can never
    // be right.
    const shape = { entryPrice: 262, targetPrice: 340, stopLoss: 210, direction: "LONG" as const };
    const breakout = defaultTriggersForHorizon("COMPOUNDER", shape, "WATCHING").find(
      (t) => t.action === "ENTER",
    )!;
    const dip = {
      ...breakout,
      predicate: { kind: "PRICE_BELOW" as const, level: 262 },
    };

    expect(triggerBucket(breakout)).toBe(triggerBucket(dip));
    expect(mergeTriggers([dip], [breakout]).filter((t) => t.action === "ENTER")).toHaveLength(1);
  });
});
