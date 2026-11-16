/**
 * Tests for reading price levels off the trigger list (L1).
 *
 * The cases that matter are the ones that produced production failures:
 * floor-vs-target decided by side rather than magnitude, a duplicate floor
 * silently winning, and a trail that is the real exit while a typed number
 * gets shown instead.
 */

import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import {
  levelLabelState,
  canonicalLevels,
  moveNumberInText,
} from "./price-levels";
import { resolveLadder } from "./levels";
import type { ResolvedTrigger } from "./levels";
import type { Trigger, TriggerAction } from "./types";
import type { Condition, When } from "@/lib/agent/triggers/condition";

// ── Builders ───────────────────────────────────────────────────────────

let seq = 0;
const nextId = () => `t${++seq}`;

function trig(
  predicate: When,
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

const below = (level: number): Condition => ({ watch: "price", is: "below", value: level });
const above = (level: number): Condition => ({ watch: "price", is: "above", value: level });

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
        resolved(trig(below(90), "ENTER", { id: "short" })),
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
      triggers: [resolved(trig(above(900), "ENTER", { id: "buy" })), resolved(trig(above(1150), "REVIEW", { id: "t" }))],
      direction: "LONG",
    });
    expect(levels.target?.triggerId).toBe("t");
  });

  it("on a stock we only watch with no buy, an upside REVIEW is a wake, not the target (QB ruling 2026-09-29)", () => {
    // VST: "keep a review at $146 instead of the buy".
    const levels = canonicalLevels({
      triggers: [resolved(trig(above(146), "REVIEW", { id: "wake" }))],
      direction: "LONG",
      status: "WATCHING",
    });
    expect(levels.target).toBeNull();
    expect(levels.columns.targetPrice).toBeNull();
    // …but it is still a line on the chart.
    expect(levels.all.map((l) => l.triggerId)).toEqual(["wake"]);
  });

  it("a compound buy with no single price still keeps the upside REVIEW as the target (COGT, 2026-09-29)", () => {
    // COGT's live list: buy on a close above $36.95 with volume 1.5x, target
    // a close above $43.35. The buy has no one entry price, but it is a buy.
    const levels = canonicalLevels({
      triggers: [
        resolved(trig({ watch: "price", is: "below", value: 27 }, "REVIEW", { id: "dip" })),
        resolved(
          trig(
            { match: "all", conditions: [{ watch: "price", is: "above", value: 36.95, settings: { close: true } }, { watch: "volume", value: 1.5 }] },
            "ENTER",
            { id: "buy" },
          ),
        ),
        resolved(trig({ watch: "price", is: "above", value: 43.35, settings: { close: true } }, "REVIEW", { id: "t" })),
      ],
      direction: null,
      status: "WATCHING",
    });
    expect(levels.target?.triggerId).toBe("t");
    expect(levels.columns.targetPrice).toBe(43.35);
  });

  it("a stock we hold keeps its upside REVIEW as the target — the buy is the fill", () => {
    const levels = canonicalLevels({
      triggers: [resolved(trig(above(1150), "REVIEW", { id: "t" }))],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 900,
    });
    expect(levels.target?.triggerId).toBe("t");
  });

  it("does not let an ADD or TRIM level claim the target slot", () => {
    // A trim is a held stock's action; held, the buy is the fill.
    const levels = canonicalLevels({
      triggers: [
        resolved(trig(above(900), "TRIM", { id: "trim" })),
        resolved(trig(above(1150), "REVIEW", { id: "goal" })),
      ],
      direction: "LONG",
      status: "HOLDING",
      avgCost: 800,
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
          trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT", { id: "trail" }),
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
          trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT", { id: "trail" }),
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
          trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT", { id: "trail" }),
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
          trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT", { id: "trail" }),
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
        trig({ watch: "move", is: "near", value: 2, variable: "sma50" }, "REVIEW", { id: "b" }),
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
        trig({ watch: "move", is: "below", value: 3, variable: "peak" }, "EXIT", { id: "trail" }),
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
    trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT", { id: "acct-trail" }),
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

describe("two protective floors of different kinds", () => {
  // 5 of 8 held positions carry both a hard stop and a trail today; after the
  // backfill all 8 will. They are different predicate shapes, so the cascade
  // keeps BOTH — the slot has to choose, and the choice is the one that binds.
  const trail = (pct: number, id: string) =>
    resolved(trig({ watch: "move", is: "below", value: pct, variable: "peak" }, "EXIT", { id }), {
      level: "ACCOUNT",
      inherited: true,
    });

  it("gives the slot to whichever binds first, hard stop or trail", () => {
    const held = { direction: "LONG", status: "HOLDING", avgCost: 800, peakPrice: 900 };
    // Trail at 828 is above the hard stop at 700 — the trail binds.
    expect(
      canonicalLevels({
        ...held,
        triggers: [resolved(trig(below(700), "EXIT", { id: "hard" })), trail(8, "trail")],
      }).floor?.triggerId,
    ).toBe("trail");
    // Raise the hard stop above the trail and it takes over.
    expect(
      canonicalLevels({
        ...held,
        triggers: [resolved(trig(below(850), "EXIT", { id: "hard" })), trail(8, "trail")],
      }).floor?.triggerId,
    ).toBe("hard");
  });

  it("keeps the loser as its own chart line rather than hiding it", () => {
    const levels = canonicalLevels({
      direction: "LONG",
      status: "HOLDING",
      avgCost: 800,
      peakPrice: 900,
      triggers: [resolved(trig(below(700), "EXIT", { id: "hard" })), trail(8, "trail")],
    });
    expect(levels.all.map((l) => l.triggerId)).toEqual(["hard", "trail"]);
    expect(levels.all.filter((l) => l.side === "DOWNSIDE")).toHaveLength(2);
  });
});

// ── A thesis inherits the review cadence from the account ──────────────

describe("review cadence reaches a thesis that has none of its own", () => {
  // This is the mechanism that would have silently stopped every review:
  // the clock lives on a trigger, most theses carry no trigger of their own,
  // and they only get one by inheriting it. If the account has no cadence,
  // nothing anywhere does, and the daily run goes quiet with no error.
  const cadence = (days: number, id: string) =>
    trig({ watch: "repeat", value: days }, "REVIEW", { id });

  it("resolves the account's cadence onto a bare thesis", () => {
    const ladder = resolveLadder({
      thesis: [],
      account: [cadence(7, "acct")],
      direction: "LONG",
    });
    const found = ladder.find((t) => shapeName(t.predicate) === "repeat");
    expect(found?.id).toBe("acct");
    expect(found?.inherited).toBe(true);
  });

  it("lets one thesis review more often than the account rule", () => {
    const ladder = resolveLadder({
      thesis: [cadence(3, "mine")],
      account: [cadence(7, "acct")],
      direction: "LONG",
    });
    const found = ladder.filter((t) => shapeName(t.predicate) === "repeat");
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("mine");
    expect(found[0].overrides?.level).toBe("ACCOUNT");
  });

  it("leaves a thesis with NO cadence at any level — the failure to catch", () => {
    // Exactly the production state before the migration: 0 accounts,
    // 0 analysts and 0 theses carrying one. Nothing errors; reviews just stop.
    const ladder = resolveLadder({ thesis: [], account: [], direction: "LONG" });
    expect(ladder.find((t) => shapeName(t.predicate) === "repeat")).toBeUndefined();
  });
});

// ── A buy level is a price we have NOT reached ─────────────────────────

// ── A moved level rewrites its sentence; one buy rung per thesis ────────

// ── moveNumberInText — the unit form first, a bare number never glued to a word

describe("moveNumberInText", () => {
  it("moves the $ level and leaves a moving average with the same digits alone", () => {
    expect(moveNumberInText("Buy above $50, a reclaim of the 50d.", "level", 50, 52)).toBe(
      "Buy above $52, a reclaim of the 50d.",
    );
    expect(moveNumberInText("Floor $200 — the 200-day held twice.", "level", 200, 210)).toBe(
      "Floor $210 — the 200-day held twice.",
    );
    expect(moveNumberInText("Exit below $20; the 20DMA is the tell.", "level", 20, 19)).toBe(
      "Exit below $19; the 20DMA is the tell.",
    );
  });

  it("falls back to a bare number only when no $ form is present, and never one glued to a letter or hyphen", () => {
    expect(moveNumberInText("Start the position when the price breaks above 150.", "level", 150, 160)).toBe(
      "Start the position when the price breaks above 160.",
    );
    expect(moveNumberInText("A reclaim of the 50d, nothing else.", "level", 50, 52)).toBeNull();
    expect(moveNumberInText("Above the 50-day.", "level", 50, 52)).toBeNull();
    expect(moveNumberInText("Trades at 150.5 today.", "level", 150, 160)).toBeNull();
  });

  it("percent and day fields move their own unit", () => {
    expect(moveNumberInText("Gave back 8% from the high — a question, not a sale.", "pct", 8, 15)).toBe(
      "Gave back 15% from the high — a question, not a sale.",
    );
    expect(moveNumberInText("Review every 30 days; the 30d average is context.", "days", 30, 45)).toBe(
      "Review every 45 days; the 30d average is context.",
    );
    expect(moveNumberInText("A 30-day hygiene check.", "days", 30, 20)).toBe("A 20-day hygiene check.");
  });

  it("keeps the two-decimal and thousands forms", () => {
    expect(moveNumberInText("Exit below $935.00.", "level", 935, 969)).toBe("Exit below $969.00.");
    expect(moveNumberInText("Buy level $1,580 — the base.", "level", 1580, 1620)).toBe("Buy level $1,620 — the base.");
  });
});
