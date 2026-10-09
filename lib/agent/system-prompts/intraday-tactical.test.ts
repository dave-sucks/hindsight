/**
 * intraday-tactical.test.ts — the tracked-peak contract for trail fires
 * (DAV-186).
 *
 * A TRAILING_FROM_HIGH fire must hand the agent the system's remembered
 * peak (Position.peakPrice) and the exact fire line, and tell it the number
 * is authoritative — the HPE 2026-08-18 miss was the validating agent
 * re-deriving a "peak" from a short chart window and declining a genuine
 * protection alarm.
 */

import { buildTacticalSystemPrompt, stockFromRead } from "./intraday-tactical";
import { rowForModel } from "@/lib/agent/row-for-model";
import { setupLines } from "@/lib/agent/analyst-brief";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { setupChecklist } from "@/lib/agent/knowledge/setup-checklist";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { guidanceFor, SITUATIONS } from "@/lib/agent/situations";
import type { Trigger } from "@/lib/agent/triggers/types";

const trailTrigger: Trigger = {
  id: "trig_trail",
  predicate: { watch: "move", is: "below", value: 12, variable: "peak" },
  action: "EXIT",
  rationale: "Protect the gain.",
};

/** A saved get_theses row for HPE, the way the tool saves it; `row` renders it as the trigger run does (step 10): the short row with the setup's lines. */
function savedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "thesis_1", ticker: "HPE", status: "HOLDING", direction: "LONG", horizon: "TARGET", setupId: null,
    coreBelief: "Belief.", keyAssumptions: ["a"], invalidationConds: ["b"], entryPrice: 53, targetPrice: 70, stopLoss: 50,
    position: { quantity: 60, avgCost: 53.1, peakPrice: 62.7 },
    triggers: [{ id: trailTrigger.id, says: sentenceOf(trailTrigger), rationale: trailTrigger.rationale }],
    ...overrides,
  };
}
const row = (overrides: Record<string, unknown> = {}) => rowForModel(savedRow(overrides), { named: true, size: "short", setupLines: true }) as Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeArgs(overrides: Record<string, any> = {}): any {
  return {
    analyst: { name: "PEAD Specialist", analystPrompt: null },
    stock: { ticker: "HPE", direction: "LONG", row: row() },
    trigger: trailTrigger,
    position: { peakPrice: 62.7 },
    ...overrides,
  };
}

describe("buildTacticalSystemPrompt — tracked peak on trail fires (DAV-186)", () => {
  it("hands the agent the tracked peak, the exact fire line, and the do-not-re-derive rule", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs());
    // The HPE numbers: peak 62.70, 12% give-back → fire line 55.176.
    expect(prompt).toContain("$62.70");
    expect(prompt).toContain("$55.18");
    expect(prompt).toContain("DO NOT RE-DERIVE");
    expect(prompt).toContain("high since we bought $62.70");
  });

  it("inverts the fire line for SHORT positions (peak is the low-water mark)", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        stock: { ticker: "HPE", direction: "SHORT", row: row({ direction: "SHORT" }) },
        position: { peakPrice: 50 },
      }),
    );
    // 50 * 1.12 = 56.00, and the fire condition reads "at or above".
    expect(prompt).toContain("$56.00");
    expect(prompt).toContain("at or above");
  });

  it("still forbids re-deriving when the peak is missing from context", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        position: { peakPrice: null },
      }),
    );
    expect(prompt).toContain("DO NOT RE-DERIVE");
    expect(prompt).toContain("treat the evaluator's fire as correct");
  });

  it("adds no peak block on non-trailing fires", () => {
    const floorTrigger: Trigger = {
      id: "trig_floor",
      predicate: { watch: "price", is: "below", value: 50 },
      action: "EXIT",
      rationale: "Hard stop.",
    };
    const prompt = buildTacticalSystemPrompt(
      makeArgs({ trigger: floorTrigger }),
    );
    expect(prompt).not.toContain("DO NOT RE-DERIVE");
    // The row's position line still shows the watermark for context.
    expect(prompt).toContain("high since we bought $62.70");
  });
});

describe("buildTacticalSystemPrompt — confirm by the setup, one run per fire, the fired price (DAV-254, DAV-265)", () => {
  const stop: Trigger = { id: "stop-969", predicate: { watch: "price", is: "below", value: 969 }, action: "EXIT", rationale: "Stop." };
  const trail: Trigger = { id: "trail-8", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, action: "EXIT", rationale: "Trail." };

  it("the row carries the lines a fire checks for the plan's setup and horizon; the old block is gone", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ stock: { ticker: "HPE", direction: "LONG", row: row({ setupId: "PEAD", setup: setupChecklist("PEAD", "TARGET") }) } }));
    for (const line of setupLines(getSetup("PEAD")!, "TARGET", "decision")) expect(prompt).toContain(JSON.stringify(line));
    // The summary and the preconditions are the brief's and the writer's, not the row's.
    expect(prompt).not.toContain(JSON.stringify(setupLines(getSetup("PEAD")!, "TARGET")[0]));
    expect(prompt).toContain("Confirm a buy by: Gap held; Surprise and guidance confirmed");
    expect(prompt).not.toContain("THE SETUP THIS PLAN WAS WRITTEN ON");
    expect(prompt).not.toContain("Volume — horizon-conditional");
  });

  it("with no setup recorded, no setup lines and none of the old block's text", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs());
    expect(prompt).not.toContain('"setup_lines"');
    expect(prompt).not.toContain("(none recorded — a plan from before setups were named");
  });

  it("MU 09-14: a stop and a trail that fired together both read as fired on the row, with their ids", () => {
    const fired = "2026-09-14T15:05:00Z";
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        trigger: stop,
        stock: { ticker: "MU", direction: "LONG", row: row({ ticker: "MU", triggers: [stop, trail].map((t) => ({ id: t.id, says: sentenceOf(t), rationale: t.rationale, lastFiredAt: fired })) }) },
        fired: { price: 964.2 },
      }),
    );
    expect(prompt).toContain('"Sell if below $969 · fired 09-14 11:05 ET · \\"Stop.\\" [id stop-969]"');
    expect(prompt).toContain("[id trail-8]");
    expect(prompt).not.toContain("→ ALSO FIRED");
    expect(prompt).not.toContain("CURRENT TRIGGER LADDER");
  });

  it("the stock's situations print with what each asks, where the per-situation text sat", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        trigger: stop,
        stock: { ticker: "MU", direction: "LONG", row: row({ ticker: "MU" }) },
        situations: { codes: ["PROTECTIVE_SALE", "YOUR_WORD_UNANSWERED"], guidance: guidanceFor(["PROTECTIVE_SALE", "YOUR_WORD_UNANSWERED"]) },
      }),
    );
    expect(prompt).toContain("The situations $MU is in (PROTECTIVE_SALE, YOUR_WORD_UNANSWERED), and what each asks:");
    expect(prompt).toContain("PROTECTIVE_SALE — sale signal\n" + SITUATIONS.PROTECTIVE_SALE.guidance);
    expect(prompt).toContain("Two sales fired together: one decision covers both");
    expect(prompt.indexOf("PROTECTIVE_SALE — ")).toBeLessThan(prompt.indexOf("YOUR_WORD_UNANSWERED — "));
    expect(prompt.indexOf("YOUR_WORD_UNANSWERED — ")).toBeLessThan(prompt.indexOf("3. If validation FAILS"));
  });

  it("ASML 10-07: a declined sale's facts are on the row under the morning row's name, so PROTECTIVE_SALE's pointer is true here too", () => {
    const declined = { floorPrice: 1835, heldThroughCount: 1, rejectMessage: null, recentLow: 1785.74 };
    const prompt = buildTacticalSystemPrompt(makeArgs({ stock: { ticker: "HPE", direction: "LONG", row: row({ heldThroughFloor: declined }) } }));
    expect(prompt).toContain(`"heldThroughFloor": ${JSON.stringify(declined, null, 2).replace(/\n/g, "\n  ")}`);
    expect(SITUATIONS.PROTECTIVE_SALE.guidance).toContain("`heldThroughFloor` has the count, the floor, the recent low and their note");
  });

  it("no declined sale: nothing prints", () => {
    expect(buildTacticalSystemPrompt(makeArgs())).not.toContain("heldThroughFloor");
  });

  it("no situations: no block, and none of the old per-situation text", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs());
    expect(prompt).not.toContain("and what each asks:");
    expect(prompt).not.toContain("An EARNINGS trigger.");
    expect(prompt).not.toContain("Confirmation gate before place_trade");
  });

  it("CEG 09-14: the fired price is the price to act on when the tool's quote fails", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ fired: { price: 264.91 } }));
    expect(prompt).toContain("It fired at $264.91.");
    expect(prompt).toContain("act on the fired price above, never on yesterday's");
  });

  it("the re-ladder duty points at the setup's Manage line, not a prose list", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs());
    expect(prompt).toContain("using the Manage line in the row's\n   setup_lines");
    expect(prompt).not.toContain("Set levels like an analyst");
  });
});

// DAV-292 — the tactical run reads how full the analyst is before it
// researches. Replay: ETN, Secular Compounder, 2026-09-18 09:45 ET — the run
// confirmed the buy by its setup, called place_trade, and only then learned
// the analyst held 4 of 4. Since step 10 the room is a line of the analyst's
// brief, and what a buy into a full analyst should do is BUY_BLOCKED_FULL's.
describe("buildTacticalSystemPrompt — the analyst's room on a buy fire", () => {
  const stock = { ticker: "ETN", direction: "LONG", row: row({ ticker: "ETN", status: "WATCHING", setupId: "COMPOUNDER_ACCUMULATION", position: null }) };
  it("a full analyst: the brief says so before the stock; the answer is the situation's", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({
      stock,
      capacity: { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] },
      situations: { codes: ["BUY_BLOCKED_FULL"], guidance: guidanceFor(["BUY_BLOCKED_FULL"]) },
    }));
    expect(prompt).toContain("- Positions: 4 of 4 — this analyst is FULL. place_trade will refuse any new buy until one closes. It holds $ABT, $ASML, $CEG, $WST.");
    expect(prompt.indexOf("this analyst is FULL")).toBeLessThan(prompt.indexOf("$ETN, its row (get_theses)"));
    expect(prompt).toContain(SITUATIONS.BUY_BLOCKED_FULL.guidance);
    expect(prompt).not.toContain("THE ANALYST'S ROOM");
    expect(prompt).not.toContain("READ THIS BEFORE YOU RESEARCH");
  });
  it("an analyst with room: the line only", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ stock, capacity: { open: 4, max: 6, held: ["FIVE", "IOT", "MU", "NVDA"] } }));
    expect(prompt).toContain("- Positions: 4 of 6 — 2 free.");
  });
  it("not a buy fire: no room line at all", () => {
    expect(buildTacticalSystemPrompt(makeArgs({ stock }))).not.toContain("Positions:");
  });
});

// A declined protective sale is a standing order (the 2026-08-16 ruling):
// it is proposed again every day its condition holds. A sentence added
// 2026-09-30 told every trigger run to "say so and pass" after a decline,
// whatever fired. On the NVDA case (scripts/hero-cases/nvda-declined-sale)
// twelve runs each, same hour: with it 1 of 12 proposed the sale and 8 tried
// to delete the trailing stop; without it 11 of 12 proposed the sale.
describe("buildTacticalSystemPrompt — a declined sale is asked again", () => {
  const PASS = "say so and pass";
  it("a protective sale fire carries no pass-after-decline line", () => {
    expect(buildTacticalSystemPrompt(makeArgs())).not.toContain(PASS);
  });
  it("a buy or add fire keeps it: a declined buy is not re-proposed unchanged", () => {
    const enter: Trigger = { id: "trig_buy", predicate: { watch: "price", is: "above", value: 60 }, action: "ENTER", rationale: "Buy the breakout." };
    const add: Trigger = { ...enter, id: "trig_add", action: "ADD" };
    expect(buildTacticalSystemPrompt(makeArgs({ trigger: enter, position: null }))).toContain(PASS);
    expect(buildTacticalSystemPrompt(makeArgs({ trigger: add }))).toContain(PASS);
  });
});

describe("buildTacticalSystemPrompt — the stock's own row, not yesterday's digest (step 12, part 2)", () => {
  // ASML's real sale proposal (Order cmux0e18w000m04jhodrm7pn3): a CLOSE of 5 shares, placed 2026-10-06 18:25 UTC, expiring a
  // day later. The 10-07 digest that the trigger run printed said "no pending proposals"; the row said this.
  const asml = () =>
    savedRow({
      id: "cmqooyvy8000004l5a9njg6n5", ticker: "ASML",
      proposals: [{ side: "SELL", intent: "CLOSE", quantity: 5, createdAt: "2026-10-06T18:25:18.399Z", expiresAt: "2026-10-07T18:25:18.399Z" }],
    });

  it("prints no digest, and the row's waiting sale with its times", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ stock: { ticker: "ASML", direction: "LONG", row: row({ id: "cmqooyvy8000004l5a9njg6n5", ticker: "ASML", proposals: asml().proposals }) } }));
    expect(prompt).not.toMatch(/DIGEST/i);
    expect(prompt).toContain('"proposal_waiting": "sell 5 sh, placed 10-06 14:25 ET, expires 10-07 14:25 ET"');
  });

  it("the run takes no digest input at all", () => {
    // Compile time: latestDigest is not an argument of the trigger run's prompt.
    const noDigestArgument: "latestDigest" extends keyof Parameters<typeof buildTacticalSystemPrompt>[0] ? false : true = true;
    expect(noDigestArgument).toBe(true);
    const prompt = buildTacticalSystemPrompt({ ...makeArgs(), latestDigest: { narrative: "No pending proposals.", date: "2026-10-07" } });
    expect(prompt).not.toContain("No pending proposals.");
  });
});

describe("the trigger run's situation words (step 12, part 2)", () => {
  const ALL = Object.keys(SITUATIONS) as Array<keyof typeof SITUATIONS>;
  it("never name a status change: its save has none", () => {
    for (const status of ["HOLDING", "WATCHING", "PROMOTED"]) {
      const read = stockFromRead({ ok: true, data: { theses: [savedRow({ status, situations: ALL })] } }, "thesis_1")!;
      const text = Object.values(read.situations.guidance).join("\n");
      expect(text.length).toBeGreaterThan(0);
      for (const word of ["change_status", "INVALIDATED", "ARCHIVED"]) expect([status, word, text.includes(word)]).toEqual([status, word, false]);
    }
  });
  it("the morning run's and the chat's keep the verbs", () => {
    const text = Object.values(guidanceFor(ALL)).join("\n");
    for (const word of ["change_status", "INVALIDATED", "ARCHIVED"]) expect([word, text.includes(word)]).toEqual([word, true]);
  });
});
