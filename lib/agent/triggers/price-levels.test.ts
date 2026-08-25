/**
 * Tests for reading price levels off the trigger list (L1).
 *
 * The cases that matter are the ones that produced production failures:
 * floor-vs-target decided by side rather than magnitude, a duplicate floor
 * silently winning, and a trail that is the real exit while a typed number
 * gets shown instead.
 */

import {
  applyLevelArgs,
  levelLabelState,
  canonicalLevels,
} from "./price-levels";
import { resolveLadder } from "./levels";
import type { ResolvedTrigger } from "./levels";
import type { Trigger, TriggerAction, TriggerPredicate } from "./types";

// ── Builders ───────────────────────────────────────────────────────────

let seq = 0;
const nextId = () => `t${++seq}`;

function trig(
  predicate: TriggerPredicate,
  action: TriggerAction,
  over: Partial<Trigger> = {},
): Trigger {
  return {
    id: over.id ?? nextId(),
    predicate,
    action,
    rationale: "test",
    ...over,
  };
}

function resolved(t: Trigger, over: Partial<ResolvedTrigger> = {}): ResolvedTrigger {
  return { ...t, level: "THESIS", inherited: false, ...over };
}

const below = (level: number) => ({ kind: "PRICE_BELOW" as const, level });
const above = (level: number) => ({ kind: "PRICE_ABOVE" as const, level });

beforeEach(() => {
  seq = 0;
});

// ── Floor vs target is the side, not the magnitude ─────────────────────

describe("floor vs target", () => {
  it("uses the side, not which number is bigger", () => {
    // The principal's question: two EXITs at $100 and $500 on a long.
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(below(100), "EXIT", { id: "lo" })),
        resolved(trig(above(500), "EXIT", { id: "hi" })),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 300,
    });
    expect(levels.floor?.triggerId).toBe("lo");
    expect(levels.target?.triggerId).toBe("hi");
  });

  it("classifies a floor sitting ABOVE the current price as still a floor", () => {
    // Legal and meaningful: it means we're about to be stopped out.
    const levels = canonicalLevels({
      triggers: [resolved(trig(below(500), "EXIT", { id: "f" }))],
      direction: "LONG",
    });
    expect(levels.floor?.triggerId).toBe("f");
    expect(levels.target).toBeNull();
  });

  it("inverts both slots on a SHORT", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(120), "EXIT", { id: "stop" })),
        resolved(trig(below(60), "REVIEW", { id: "goal" })),
      ],
      direction: "SHORT",
    });
    expect(levels.floor?.triggerId).toBe("stop");
    expect(levels.target?.triggerId).toBe("goal");
  });

  it("treats an upside REVIEW as the target, not just an EXIT", () => {
    // The default mint for a target is REVIEW (ruling 2026-08-24).
    const levels = canonicalLevels({
      triggers: [resolved(trig(above(1150), "REVIEW", { id: "t" }))],
      direction: "LONG",
    });
    expect(levels.target?.triggerId).toBe("t");
  });

  it("does not let an ADD or TRIM level claim the target slot", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(900), "TRIM", { id: "trim" })),
        resolved(trig(above(1150), "REVIEW", { id: "goal" })),
      ],
      direction: "LONG",
    });
    expect(levels.target?.triggerId).toBe("goal");
    // …but it is still a chart line.
    expect(levels.all.map((l) => l.triggerId)).toEqual(["trim", "goal"]);
  });
});

// ── Duplicates: the tightest floor is the real one ─────────────────────

describe("duplicate levels on one side", () => {
  it("picks the tightest floor, not the first in the array", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(below(100), "EXIT", { id: "stale" })),
        resolved(trig(below(500), "EXIT", { id: "live" })),
      ],
      direction: "LONG",
    });
    expect(levels.floor?.triggerId).toBe("live");
  });

  it("picks the LOWEST ceiling as the tightest floor on a SHORT", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(200), "EXIT", { id: "loose" })),
        resolved(trig(above(120), "EXIT", { id: "live" })),
      ],
      direction: "SHORT",
    });
    expect(levels.floor?.triggerId).toBe("live");
  });

  it("shows the furthest target as the destination and keeps tiers on the chart", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(900), "EXIT", { id: "first" })),
        resolved(trig(above(1150), "EXIT", { id: "dest" })),
      ],
      direction: "LONG",
    });
    expect(levels.target?.triggerId).toBe("dest");
    expect(levels.all).toHaveLength(2);
  });
});

// ── The trail is a floor. SNOW. ────────────────────────────────────────

describe("projected levels", () => {
  it("places a trailing give-back at the price it currently sits at", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(
          trig({ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT", { id: "trail" }),
        ),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 700,
      peakPrice: 900,
    });
    expect(levels.floor?.price).toBeCloseTo(828);
  });

  it("lets a trail beat a lower typed stop as the effective floor", () => {
    // SNOW: card said $256, the only real exit was a 3% trail off the high.
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(below(680), "EXIT", { id: "typed" })),
        resolved(
          trig({ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT", { id: "trail" }),
        ),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 700,
      peakPrice: 900,
    });
    expect(levels.floor?.triggerId).toBe("trail");
    expect(levels.floor?.price).toBeCloseTo(828);
    expect(levels.floor?.projected).toBe(true);
  });

  it("drops a projected level when there is no position state to place it", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(
          trig({ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT", { id: "trail" }),
        ),
      ],
      direction: "LONG",
      status: "WATCHING",
    });
    expect(levels.all).toHaveLength(0);
    expect(levels.floor).toBeNull();
  });

  it("keeps a moving level OUT of the cached columns", () => {
    // stopLoss feeds prompts and the ratchet, which want the typed floor.
    const input = {
      triggers: [
        resolved(trig(below(680), "EXIT", { id: "typed" })),
        resolved(
          trig({ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT", { id: "trail" }),
        ),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 700,
      peakPrice: 900,
    };
    const out = canonicalLevels(input);
    expect(out.floor?.projected).toBe(true);
    expect(out.columns.stopLoss).toBe(680);
  });
});

// ── Entry is a plan while watching, a fact once held ────────────────────

describe("entry", () => {
  it("reads the ENTER trigger while WATCHING", () => {
    const levels = canonicalLevels({
      triggers: [resolved(trig(above(47.12), "ENTER", { id: "e" }))],
      direction: "LONG",
      status: "WATCHING",
    });
    expect(levels.entry?.price).toBe(47.12);
  });

  it("uses the fill price once HOLDING, ignoring a stale ENTER trigger", () => {
    const levels = canonicalLevels({
      triggers: [resolved(trig(above(47.12), "ENTER", { id: "e" }))],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 51.4,
    });
    expect(levels.entry?.price).toBe(51.4);
  });
});

// ── Writing a level back ───────────────────────────────────────────────

describe("setLevel", () => {
  const mint = (
    slot: "ENTRY" | "FLOOR" | "TARGET",
    price: number,
    direction: string,
    stored: Trigger[] = [],
  ) =>
    applyLevelArgs({
      stored,
      levels: { [slot.toLowerCase()]: price },
      direction,
      status: "WATCHING",
      mintId: () => "new",
    }).triggers;

  it("mints the right predicate per slot and direction", () => {
    expect(mint("FLOOR", 100, "LONG")[0].predicate).toEqual(below(100));
    expect(mint("FLOOR", 100, "SHORT")[0].predicate).toEqual(above(100));
    expect(mint("TARGET", 500, "LONG")[0].predicate).toEqual(above(500));
    expect(mint("ENTRY", 47, "SHORT")[0].predicate).toEqual(below(47));
  });

  it("defaults a target to REVIEW, not EXIT", () => {
    // Ruling 2026-08-24: a target wakes a decision, it does not auto-sell.
    expect(mint("TARGET", 500, "LONG")[0].action).toBe("REVIEW");
    expect(mint("FLOOR", 100, "LONG")[0].action).toBe("EXIT");
  });

  it("edits in place so the trigger keeps its id and cooldown history", () => {
    const stored = [
      trig(below(680), "EXIT", { id: "keep", lastFiredAt: "2026-08-01T00:00:00Z" }),
    ];
    const out = applyLevelArgs({
      stored,
      levels: { floor: 720 },
      direction: "LONG",
      status: "WATCHING",
      mintId: () => "new",
    });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].id).toBe("keep");
    expect(out.triggers[0].lastFiredAt).toBe("2026-08-01T00:00:00Z");
    expect(out.triggers[0].predicate).toEqual(below(720));
  });

  it("adds a trigger when the slot is empty", () => {
    const out = applyLevelArgs({
      stored: [],
      levels: { target: 1150 },
      direction: "LONG",
      status: "WATCHING",
      source: "PRINCIPAL",
      mintId: () => "new",
    });
    expect(out.triggers[0]).toMatchObject({
      id: "new",
      action: "REVIEW",
      predicate: above(1150),
      source: "PRINCIPAL",
    });
  });

  it("collapses a duplicate floor rather than leaving the stale one behind", () => {
    const stored = [
      trig(below(100), "EXIT", { id: "stale" }),
      trig(below(500), "EXIT", { id: "live" }),
    ];
    const out = applyLevelArgs({
      stored,
      levels: { floor: 520 },
      direction: "LONG",
      status: "WATCHING",
      mintId: () => "new",
    });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].id).toBe("live");
    expect(out.triggers[0].predicate).toEqual(below(520));
  });

  it("removes the slot's trigger on a null price — this is demotion", () => {
    const stored = [
      trig(above(47), "ENTER", { id: "e" }),
      trig(below(40), "EXIT", { id: "f" }),
    ];
    const out = applyLevelArgs({
      stored,
      levels: { entry: null },
      direction: "LONG",
      status: "WATCHING",
      mintId: () => "new",
    });
    expect(out.triggers.map((t) => t.id)).toEqual(["f"]);
  });

  it("leaves an inherited trigger alone and writes a thesis-level override", () => {
    const out = applyLevelArgs({
      stored: [],
      inherited: [
        resolved(trig(below(600), "EXIT", { id: "acct" }), {
          level: "ACCOUNT",
          inherited: true,
        }),
      ],
      levels: { floor: 700 },
      direction: "LONG",
      status: "WATCHING",
      mintId: () => "new",
    });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].id).toBe("new");
  });
});

// ── The resolver must agree with the card ──────────────────────────────

describe("resolveLadder tie-break", () => {
  it("keeps the tightest floor when two share a bucket, not the first", () => {
    // Before this fix the evaluator fired whichever came first in the array,
    // so the card could show one floor while a weaker one was live.
    const out = resolveLadder({
      thesis: [
        trig(below(100), "EXIT", { id: "stale" }),
        trig(below(500), "EXIT", { id: "live" }),
      ],
      direction: "LONG",
    });
    const floors = out.filter((t) => t.action === "EXIT");
    expect(floors).toHaveLength(1);
    expect(floors[0].id).toBe("live");
  });

  it("agrees with what the card shows", () => {
    const stored = [
      trig(below(100), "EXIT", { id: "stale" }),
      trig(below(500), "EXIT", { id: "live" }),
    ];
    const ladder = resolveLadder({ thesis: stored, direction: "LONG" });
    const card = canonicalLevels({ triggers: ladder, direction: "LONG" });
    expect(card.floor?.triggerId).toBe("live");
  });

  it("still lets a thesis trigger override an inherited one in the same bucket", () => {
    const out = resolveLadder({
      thesis: [trig(below(500), "EXIT", { id: "mine" })],
      account: [trig(below(600), "EXIT", { id: "acct" })],
      direction: "LONG",
    });
    const floors = out.filter((t) => t.action === "EXIT");
    expect(floors).toHaveLength(1);
    // Precedence is by LEVEL and is untouched — the thesis wins even though
    // the account's $600 floor is the tighter number.
    expect(floors[0].id).toBe("mine");
    expect(floors[0].overrides?.level).toBe("ACCOUNT");
  });

  it("does not reorder non-protective triggers", () => {
    const out = resolveLadder({
      thesis: [
        trig(above(1150), "REVIEW", { id: "a" }),
        trig({ kind: "SIGNAL_TYPE", signalType: "NEWS" }, "REVIEW", { id: "b" }),
      ],
      direction: "LONG",
    });
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

// ── What the card says ─────────────────────────────────────────────────

describe("levelLabelState", () => {
  it("shows a live level, and says what reaching it does", () => {
    expect(
      levelLabelState({ price: 680, projected: false, action: "EXIT" }, 680),
    ).toEqual({ kind: "live", price: 680, moving: false, does: "sells" });
  });

  it("distinguishes a target that sells from one that asks first", () => {
    // Both are real levels at the same price. Rendering them identically
    // tells you the level exists without telling you what it promises.
    const sells = levelLabelState(
      { price: 1150, projected: false, action: "EXIT" },
      1150,
    );
    const asks = levelLabelState(
      { price: 1150, projected: false, action: "REVIEW" },
      1150,
    );
    expect(sells).toMatchObject({ kind: "live", does: "sells" });
    expect(asks).toMatchObject({ kind: "live", does: "asks" });
  });

  it("marks a trail as moving so the number doesn't read as typed", () => {
    expect(
      levelLabelState({ price: 828, projected: true, action: "EXIT" }, null),
    ).toEqual({ kind: "live", price: 828, moving: true, does: "sells" });
  });

  it("calls out a stored number no trigger enforces", () => {
    // SNOW: the card said "Stop $256" on a live position for months and
    // nothing anywhere would have sold at $256.
    expect(levelLabelState(null, 256)).toEqual({ kind: "decorative", price: 256 });
  });

  it("says nothing when there is nothing", () => {
    expect(levelLabelState(null, null)).toEqual({ kind: "none" });
  });
});

describe("the SNOW row, end to end", () => {
  // The motivating failure from LEVELS_AS_TRIGGERS.md: stopLoss=256 in the
  // column, no matching EXIT trigger, and the only real exit a 3% give-back.
  const SNOW = {
    triggers: [
      resolved(trig(below(320), "REVIEW", { id: "warn" })),
      resolved(trig(above(340), "REVIEW", { id: "chk" })),
      resolved(
        trig({ kind: "TRAILING_FROM_HIGH", pct: 3 }, "EXIT", { id: "trail" }),
      ),
    ],
    direction: "LONG",
    status: "HOLDING",
    avgCost: 245.67,
    peakPrice: 360,
  };

  it("reports the trail as the floor, because it is", () => {
    const levels = canonicalLevels(SNOW);
    expect(levels.floor?.triggerId).toBe("trail");
    expect(levels.floor?.price).toBeCloseTo(349.2);
  });

  it("flags the $256 column as unenforced instead of rendering it as a stop", () => {
    const levels = canonicalLevels({ ...SNOW, peakPrice: null });
    // With no peak the trail can't be placed, so there is no floor at all —
    // and the column's $256 must not quietly stand in for one.
    expect(levels.floor).toBeNull();
    expect(levelLabelState(levels.floor, 256)).toEqual({
      kind: "decorative",
      price: 256,
    });
  });

  it("does not invent a target from the $360 column", () => {
    const levels = canonicalLevels(SNOW);
    // $340 is a REVIEW checkpoint and IS a real upside level; $360 is not
    // backed by anything, so the destination is $340, not $360.
    expect(levels.target?.price).toBe(340);
    expect(levelLabelState(levels.target, 360)).toMatchObject({
      kind: "live",
      price: 340,
    });
  });
});

// ── Derive-on-write (L3) ───────────────────────────────────────────────

describe("applyLevelArgs", () => {
  const base = {
    direction: "LONG" as const,
    status: "WATCHING" as const,
    mintId: () => "new",
  };

  it("writes a trigger for the level, not just the column", () => {
    // The SNOW mechanism: raising the stop used to move a column and leave
    // the ladder untouched, so nothing would ever have sold at that price.
    const out = applyLevelArgs({ ...base, stored: [], levels: { floor: 256 } });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0]).toMatchObject({
      action: "EXIT",
      predicate: below(256),
    });
    expect(out.columns.stopLoss).toBe(256);
  });

  it("recomputes the columns from a resent ladder that dropped the floor", () => {
    // Wholesale replace without the floor: the column must go with it rather
    // than lingering as a number nothing enforces. (Whether the agent is
    // ALLOWED to drop it is the ratchet's job, not this function's.)
    const out = applyLevelArgs({
      ...base,
      stored: [trig(above(1150), "REVIEW", { id: "t" })],
      levels: {},
    });
    expect(out.columns.stopLoss).toBeNull();
    expect(out.columns.targetPrice).toBe(1150);
  });

  it("lets an explicit level win over a resent ladder", () => {
    const out = applyLevelArgs({
      ...base,
      stored: [trig(below(600), "EXIT", { id: "f" })],
      levels: { floor: 720 },
    });
    expect(out.columns.stopLoss).toBe(720);
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].id).toBe("f"); // edited, keeps its history
  });

  it("counts an inherited floor as real protection", () => {
    const out = applyLevelArgs({
      ...base,
      stored: [],
      inherited: [
        resolved(trig(below(600), "EXIT", { id: "acct" }), {
          level: "ACCOUNT",
          inherited: true,
        }),
      ],
      levels: {},
    });
    expect(out.triggers).toHaveLength(0);
    expect(out.columns.stopLoss).toBe(600);
  });

  it("refuses to re-arm a buy trigger on a stock we already own", () => {
    // 2026-05-19: 35 of 36 ENTER tacticals fired on already-held tickers.
    const out = applyLevelArgs({
      ...base,
      status: "HOLDING",
      stored: [],
      levels: { entry: 817 },
      avgCost: 832.84,
    });
    expect(out.triggers).toHaveLength(0);
    expect(out.columns.entryPrice).toBe(832.84); // the fill, not the plan
  });
});


// ── An inherited trail outranks a hand-set floor ───────────────────────

describe("the EME case: a reject-UI floor under an inherited trail", () => {
  // EME carries no trail of its own. The 8% give-back lives on
  // Account.triggers and reaches it through the cascade, which is why every
  // sell proposal since 8/20 cites $794.76 = 863.87 x 0.92.
  //
  // The hazard: setting an EXIT at $753 in the reject dialog looks like it
  // lowers the floor, but the trail still fires higher. If the card showed
  // "$753" it would be a NEW way for it to lie, inside the work that exists
  // to stop it lying.
  const accountTrail = resolved(
    trig({ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT", { id: "acct-trail" }),
    { level: "ACCOUNT", inherited: true },
  );
  const eme = {
    direction: "LONG",
    status: "HOLDING",
    avgCost: 832.84,
    peakPrice: 863.87,
  };

  it("shows the inherited trail, not the lower hand-set floor", () => {
    const levels = canonicalLevels({
      ...eme,
      triggers: [resolved(trig(below(753), "EXIT", { id: "principal" })), accountTrail],
    });
    expect(levels.floor?.triggerId).toBe("acct-trail");
    expect(levels.floor?.price).toBeCloseTo(794.76, 1);
    expect(levels.floor?.inherited).toBe(true);
  });

  it("still draws the hand-set floor as its own chart line", () => {
    // Both are real and both can fire; the card names the one that fires
    // FIRST, the chart shows the whole picture.
    const levels = canonicalLevels({
      ...eme,
      triggers: [resolved(trig(below(753), "EXIT", { id: "principal" })), accountTrail],
    });
    expect(levels.all.map((l) => l.triggerId)).toEqual(["principal", "acct-trail"]);
  });

  it("hands the hand-set number to the cached column, and only that", () => {
    // The column is the TYPED floor: stable, ratchet-comparable, and what a
    // person actually wrote. The moving one belongs on the card.
    const levels = canonicalLevels({
      ...eme,
      triggers: [resolved(trig(below(753), "EXIT", { id: "principal" })), accountTrail],
    });
    expect(levels.columns.stopLoss).toBe(753);
  });

  it("lets a hand-set floor ABOVE the trail win, as it should", () => {
    const levels = canonicalLevels({
      ...eme,
      triggers: [resolved(trig(below(820), "EXIT", { id: "principal" })), accountTrail],
    });
    expect(levels.floor?.triggerId).toBe("principal");
    expect(levels.floor?.price).toBe(820);
  });
});

describe("a floor raised past an upside level", () => {
  it("flags MU's straddle", () => {
    // EXIT below $935 and REVIEW above $934: a $1 gap covering the whole
    // number line, so something fires on every tick. Created 8/19 by raising
    // the floor 814 -> 935 past a review the agent had set at 934 on 8/18,
    // when it was a sensible "it recovered" checkpoint.
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(below(935), "EXIT", { id: "floor" })),
        resolved(trig(above(934), "REVIEW", { id: "spent-checkpoint" })),
        resolved(trig(above(1150), "TRIM", { id: "trim" })),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 885.46,
    });
    expect(levels.contradiction).toEqual({ floor: 935, upside: 934 });
  });

  it("says nothing about a well-ordered plan", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(below(680), "EXIT", { id: "floor" })),
        resolved(trig(above(1150), "REVIEW", { id: "target" })),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 817,
    });
    expect(levels.contradiction).toBeNull();
  });

  it("inverts on a short", () => {
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(100), "EXIT", { id: "floor" })),
        resolved(trig(below(105), "REVIEW", { id: "target" })),
      ],
      direction: "SHORT",
      status: "HOLDING",
      avgCost: 120,
    });
    expect(levels.contradiction).toEqual({ floor: 100, upside: 105 });
  });
});
