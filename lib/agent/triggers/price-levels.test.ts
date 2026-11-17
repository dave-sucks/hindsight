/**
 * Tests for reading price levels off the trigger list (L1).
 *
 * The cases that matter are the ones that produced production failures:
 * floor-vs-target decided by side rather than magnitude, a duplicate floor
 * silently winning, and a trail that is the real exit while a typed number
 * gets shown instead.
 */

import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { levelSlotOf, moveNumberInText, priceLines, typedPriceOf } from "./price-levels";
import { resolveLadder } from "./levels";
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


const below = (level: number): Condition => ({ watch: "price", is: "below", value: level });
const above = (level: number): Condition => ({ watch: "price", is: "above", value: level });

beforeEach(() => {
  seq = 0;
});

// ── The slot is the side, not the magnitude ────────────────────────────

describe("levelSlotOf: which slot a price trigger sits in, for the one-per-slot rule", () => {
  it("uses the side, not which number is bigger", () => {
    expect(levelSlotOf(trig(below(500), "EXIT"), "LONG")).toBe("FLOOR");
    expect(levelSlotOf(trig(above(100), "EXIT"), "LONG")).toBe("TARGET");
  });
  it("inverts both slots on a SHORT", () => {
    expect(levelSlotOf(trig(above(120), "EXIT"), "SHORT")).toBe("FLOOR");
    expect(levelSlotOf(trig(below(80), "EXIT"), "SHORT")).toBe("TARGET");
  });
  it("a Stop watching line sits under the price; an upside review over it; a buy is the buy", () => {
    expect(levelSlotOf(trig(below(46.5), "STOP_WATCHING"), "LONG")).toBe("FLOOR");
    expect(levelSlotOf(trig(above(150), "REVIEW"), "LONG")).toBe("TARGET");
    expect(levelSlotOf(trig(above(100), "ENTER"), "LONG")).toBe("ENTRY");
  });
  it("an ADD or TRIM level, a downside review, a move or a clock take no slot", () => {
    expect(levelSlotOf(trig(above(150), "TRIM"), "LONG")).toBeNull();
    expect(levelSlotOf(trig(above(150), "ADD"), "LONG")).toBeNull();
    expect(levelSlotOf(trig(below(90), "REVIEW"), "LONG")).toBeNull();
    expect(levelSlotOf(trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT"), "LONG")).toBeNull();
    expect(levelSlotOf(trig({ watch: "repeat", value: 30 }, "REVIEW"), "LONG")).toBeNull();
  });
});

describe("typedPriceOf and priceLines: a trigger's own price, and one chart line per price trigger", () => {
  it("reads a typed price; a chart condition, a move and a clock have none", () => {
    expect(typedPriceOf(trig(below(384), "EXIT"))).toBe(384);
    expect(typedPriceOf(trig({ watch: "price", is: "above", variable: "sma50" }, "ENTER"))).toBeNull();
    expect(typedPriceOf(trig({ watch: "move", is: "below", value: 8, variable: "peak" }, "EXIT"))).toBeNull();
    expect(typedPriceOf(trig({ watch: "repeat", value: 30 }, "REVIEW"))).toBeNull();
  });
  it("SNOW: the trail is a percentage, so it is no line; each typed level is its own line, said as its sentence, ascending", () => {
    const lines = priceLines([
      trig(above(340), "REVIEW", { id: "chk" }),
      trig({ watch: "move", is: "below", value: 3, variable: "peak" }, "EXIT", { id: "trail" }),
      trig(below(320), "REVIEW", { id: "warn" }),
    ]);
    expect(lines).toEqual([
      { triggerId: "warn", action: "REVIEW", price: 320, says: "Review if below $320" },
      { triggerId: "chk", action: "REVIEW", price: 340, says: "Review if above $340" },
    ]);
  });
  it("a watch's buy and its Stop watching line keep their own words, settings included", () => {
    const lines = priceLines([
      trig({ watch: "price", is: "below", value: 46.5, settings: { close: true } }, "STOP_WATCHING", { id: "out" }),
      trig({ watch: "price", is: "above", value: 51.94, settings: { close: true } }, "ENTER", { id: "buy" }),
    ]);
    expect(lines.map((l) => l.says)).toEqual(["Stop watching if below $46.50 · only on the close", "Buy if above $51.94 · only on the close"]);
  });
});

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
