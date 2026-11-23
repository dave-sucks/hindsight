/**
 * intraday-tactical.test.ts — the tracked-peak contract for trail fires
 * (DAV-186).
 *
 * A trail fire must hand the agent the system's remembered
 * peak (Position.peakPrice) and the exact fire line, and tell it the number
 * is authoritative — the HPE 2026-08-18 miss was the validating agent
 * re-deriving a "peak" from a short chart window and declining a genuine
 * protection alarm.
 */

import { stockFromRead, type triggerRunRequest } from "./intraday-tactical";
import { triggerRunSent } from "@/lib/agent/__fixtures__/trigger-run-sent";
import { rowForModel } from "@/lib/agent/row-for-model";
import { playbookChecks } from "@/lib/agent/analyst-brief";
import { getSetup, setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { setupChecklist } from "@/lib/agent/knowledge/setup-checklist";
import { PLAYBOOK_TEMPLATES } from "@/lib/agent/knowledge/playbook-templates";
import { playbookTemplates, playbookTriggerText, playbooksBlock } from "@/lib/agent/knowledge/playbooks";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { SITUATIONS } from "@/lib/agent/situations";
import { guidanceFor, situationText } from "@/lib/agent/situation-skills";
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
const row = (overrides: Record<string, unknown> = {}) => rowForModel(savedRow(overrides)) as Record<string, unknown>;

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

describe("a trigger fire's request — tracked peak on trail fires (DAV-186)", () => {
  it("hands the agent the tracked peak, the exact fire line, and the do-not-re-derive rule", () => {
    const prompt = triggerRunSent(makeArgs());
    // The HPE numbers: peak 62.70, 12% give-back → fire line 55.176.
    expect(prompt).toContain("$62.70");
    expect(prompt).toContain("$55.18");
    expect(prompt).toContain("DO NOT RE-DERIVE");
    expect(prompt).toContain("high since we bought $62.70");
  });

  it("inverts the fire line for SHORT positions (peak is the low-water mark)", () => {
    const prompt = triggerRunSent(
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
    const prompt = triggerRunSent(
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
    const prompt = triggerRunSent(
      makeArgs({ trigger: floorTrigger }),
    );
    expect(prompt).not.toContain("DO NOT RE-DERIVE");
    // The row's position line still shows the watermark for context.
    expect(prompt).toContain("high since we bought $62.70");
  });
});

describe("a trigger fire's request — confirm by the setup, one run per fire, the fired price (DAV-254, DAV-265)", () => {
  const stop: Trigger = { id: "stop-969", predicate: { watch: "price", is: "below", value: 969 }, action: "EXIT", rationale: "Stop." };
  const trail: Trigger = { id: "trail-8", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, action: "EXIT", rationale: "Trail." };

  it("the row carries the lines a fire checks for the plan's setup and horizon; the old block is gone", () => {
    const prompt = triggerRunSent(makeArgs({ stock: { ticker: "HPE", direction: "LONG", row: row({ setupId: "PEAD", setup: setupChecklist("PEAD", { templates: PLAYBOOK_TEMPLATES.PEAD }) }) } }));
    for (const line of playbookChecks(getSetup("PEAD")!, "decision")) expect(prompt).toContain(JSON.stringify(line));
    // A watch's row carries the one trigger that comes with its buy the run names, its "Sell if below"; the fill writes the rest.
    const sale = PLAYBOOK_TEMPLATES.PEAD.filter((t) => t.writtenOn === "PROPOSAL" && t.action === "EXIT");
    for (const text of playbookTriggerText(sale, "PROPOSAL")) expect(prompt).toContain(JSON.stringify(text));
    expect(prompt).not.toContain("- Trim 50% if above {priorHigh}: ");
    // The summary and the preconditions are the brief's and the writer's, not the row's.
    expect(prompt).not.toContain(JSON.stringify(playbookChecks(getSetup("PEAD")!)[0]));
    expect(prompt).toContain("Confirm a buy by: Gap held; Surprise and guidance confirmed");
    expect(prompt).not.toContain("THE SETUP THIS PLAN WAS WRITTEN ON");
    expect(prompt).not.toContain("Volume — horizon-conditional");
  });

  it("with no setup recorded, no setup lines and none of the old block's text", () => {
    const prompt = triggerRunSent(makeArgs());
    expect(prompt).not.toContain('"playbook_checks"');
    expect(prompt).not.toContain("(none recorded — a plan from before setups were named");
  });

  it("MU 09-14: a stop and a trail that fired together both read as fired on the row, with their ids", () => {
    const fired = "2026-09-14T15:05:00Z";
    const prompt = triggerRunSent(
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
    const prompt = triggerRunSent(
      makeArgs({
        trigger: stop,
        stock: { ticker: "MU", direction: "LONG", row: row({ ticker: "MU" }) },
        situations: { codes: ["PROTECTIVE_SALE", "NEWS"], guidance: guidanceFor([{ code: "PROTECTIVE_SALE", held: true }, { code: "NEWS", held: true }]) },
      }),
    );
    expect(prompt).toContain("The situations $MU is in (PROTECTIVE_SALE, NEWS), and what each asks:");
    expect(prompt).toContain("PROTECTIVE_SALE — sale signal\n" + situationText("PROTECTIVE_SALE", true));
    expect(prompt).toContain("Two sales that fired together get one decision.");
    expect(prompt.indexOf("PROTECTIVE_SALE — ")).toBeLessThan(prompt.indexOf("NEWS — news\nNews on a stock."));
    // The end of the instructions, before the stock's facts in the first message.
    expect(prompt.indexOf("## Its situations")).toBeLessThan(prompt.indexOf("its row (get_theses)"));
  });

  it("ASML 10-07: a declined sale's facts are on the row under the morning row's name, so the run can read the owner's words the sale skill asks for", () => {
    const declined = { floorPrice: 1835, declined: 1, lapsed: 0, rejectMessage: null, recentLow: 1785.74 };
    const prompt = triggerRunSent(makeArgs({ stock: { ticker: "HPE", direction: "LONG", row: row({ heldThroughFloor: declined }) } }));
    expect(prompt).toContain(`"heldThroughFloor": ${JSON.stringify(declined, null, 2).replace(/\n/g, "\n  ")}`);
    expect(situationText("PROTECTIVE_SALE", true)).toContain("4. Did the owner decline this sale, or let it lapse? Read their words.");
  });

  it("no declined sale: nothing prints", () => {
    expect(triggerRunSent(makeArgs())).not.toContain("heldThroughFloor");
  });

  it("no situations: no block, and none of the old per-situation text", () => {
    const prompt = triggerRunSent(makeArgs());
    expect(prompt).not.toContain("and what each asks:");
    expect(prompt).not.toContain("An EARNINGS trigger.");
    expect(prompt).not.toContain("Confirmation gate before place_trade");
  });

  it("CEG 09-14: the fired price is the price to act on when the tool's quote fails", () => {
    const prompt = triggerRunSent(makeArgs({ fired: { price: 264.91 } }));
    expect(prompt).toContain('fired at $264.91 (trigger');
    expect(prompt).toContain("act on the price the trigger fired at, never on yesterday's close");
  });

  it("the re-ladder duty re-sets off the chart, not a prose list or a deleted Manage line", () => {
    const prompt = triggerRunSent(makeArgs());
    expect(prompt).toContain("re-set it off the NEW structure the chart gives (the swing low, the breakout price, the average), not a round number.");
    expect(prompt).not.toContain("Manage line");
    expect(prompt).not.toContain("Set levels like an analyst");
  });
});

// DAV-292 — the tactical run reads how full the analyst is before it
// researches. Replay: ETN, Secular Compounder, 2026-09-18 09:45 ET — the run
// confirmed the buy by its setup, called place_trade, and only then learned
// the analyst held 4 of 4. Since step 10 the room is a line of the analyst's
// brief, and what a buy into a full analyst should do is the buy's paragraph on it.
describe("a trigger fire's request — the analyst's room on a buy fire", () => {
  const stock = { ticker: "ETN", direction: "LONG", row: row({ ticker: "ETN", status: "WATCHING", setupId: "COMPOUNDER_ACCUMULATION", position: null }) };
  it("a full analyst: the brief says so before the stock; what to do is the buy tool's refusal, in no skill", () => {
    const prompt = triggerRunSent(makeArgs({
      stock,
      capacity: { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] },
      situations: { codes: ["BUY_ARRIVES"], guidance: guidanceFor([{ code: "BUY_ARRIVES", held: false }]) },
    }));
    expect(prompt).toContain("- Positions: 4 of 4 — this analyst is FULL. place_trade will refuse any new buy until one closes. It holds $ABT, $ASML, $CEG, $WST.");
    expect(prompt.indexOf("this analyst is FULL")).toBeLessThan(prompt.indexOf("$ETN, its row (get_theses)"));
    expect(prompt).toContain(situationText("BUY_ARRIVES", false));
    expect(prompt).not.toContain("If the analyst is full");
    expect(prompt).not.toContain("THE ANALYST'S ROOM");
    expect(prompt).not.toContain("READ THIS BEFORE YOU RESEARCH");
  });
  it("an analyst with room: the line only", () => {
    const prompt = triggerRunSent(makeArgs({ stock, capacity: { open: 4, max: 6, held: ["FIVE", "IOT", "MU", "NVDA"] } }));
    expect(prompt).toContain("- Positions: 4 of 6 — 2 free.");
  });
  it("not a buy fire: no room line at all", () => {
    expect(triggerRunSent(makeArgs({ stock }))).not.toContain("Positions:");
  });
});

// A declined protective sale is a standing order (the 2026-08-16 ruling):
// it asks the run again every day its condition holds. A sentence added
// 2026-09-30 told every trigger run to "say so and pass" after a decline,
// whatever fired. On the NVDA case (scripts/hero-cases/nvda-declined-sale)
// twelve runs each, same hour: with it 1 of 12 proposed the sale and 8 tried
// to delete the trailing stop; without it 11 of 12 proposed the sale.
describe("a trigger fire's request — a declined sale is asked again", () => {
  const PASS = "If nothing they named has changed since, pass.";
  it("a protective sale fire carries no pass-after-decline line", () => {
    expect(triggerRunSent(makeArgs())).not.toContain(PASS);
  });
  it("a buy or add fire reads it in its situation: a declined buy is not re-proposed unchanged", () => {
    const enter: Trigger = { id: "trig_buy", predicate: { watch: "price", is: "above", value: 60 }, action: "ENTER", rationale: "Buy the breakout." };
    const add: Trigger = { ...enter, id: "trig_add", action: "ADD" };
    // A buy's line also covers the run's own earlier pass (2026-11-20).
    expect(triggerRunSent(makeArgs({ trigger: enter, position: null, situations: { codes: ["BUY_ARRIVES"], guidance: guidanceFor([{ code: "BUY_ARRIVES", held: false }]) } }))).toContain("If what that note named hasn't changed, pass again");
    expect(triggerRunSent(makeArgs({ trigger: add, situations: { codes: ["ADD_OR_WINNER"], guidance: guidanceFor([{ code: "ADD_OR_WINNER", held: true }]) } }))).toContain(PASS);
  });
});

describe("a trigger fire's request — the stock's row, and of the account only the market numbers", () => {
  // ASML's real sale proposal (Order cmux0e18w000m04jhodrm7pn3): a CLOSE of 5 shares, placed 2026-10-06 18:25 UTC, expiring a
  // day later. The 10-07 digest that the trigger run printed said "no pending proposals"; the row said this.
  const asml = () =>
    savedRow({
      id: "cmqooyvy8000004l5a9njg6n5", ticker: "ASML",
      proposals: [{ side: "SELL", intent: "CLOSE", quantity: 5, createdAt: "2026-10-06T18:25:18.399Z", expiresAt: "2026-10-07T18:25:18.399Z" }],
    });

  it("prints the row's waiting sale with its times, and no digest without the reads", () => {
    const prompt = triggerRunSent(makeArgs({ stock: { ticker: "ASML", direction: "LONG", row: row({ id: "cmqooyvy8000004l5a9njg6n5", ticker: "ASML", proposals: asml().proposals }) } }));
    expect(prompt).not.toContain("### Portfolio digest");
    // The rule on weighing the Market and portfolio context is a house rule again, given to every agent (2026-11-18).
    expect(prompt).toContain("Where it and a stock's own row differ, the row is right");
    expect(prompt).toContain('"proposal_waiting": "sell 5 sh, placed 10-06 14:25 ET, expires 10-07 14:25 ET"');
  });

  it("prints the market numbers once, before the stock's row, and none of the snapshot or the digests", () => {
    const portfolioPieces = [
      { id: "market_numbers", text: "### Market numbers (as of Wed, Nov 11, 10:00 AM ET)\nS&P 500 stand-in" },
      { id: "market_digest", text: "### Market digest (written Wed, Nov 11, 7:30 AM ET)\nStocks slipped." },
      { id: "portfolio_snapshot", text: "### Portfolio snapshot\nYour portfolio, stand-in" },
      { id: "portfolio_digest", text: "### Portfolio digest (written Wed, Nov 11, 8:00 PM ET)\nNo pending proposals." },
    ];
    const prompt = triggerRunSent({ ...makeArgs({ stock: { ticker: "ASML", direction: "LONG", row: row({ id: "cmqooyvy8000004l5a9njg6n5", ticker: "ASML", proposals: asml().proposals }) } }), portfolioPieces });
    expect(prompt.split("## Market and portfolio")).toHaveLength(2);
    expect(prompt.indexOf("### Market numbers")).toBeLessThan(prompt.indexOf("$ASML, its row (get_theses)"));
    for (const other of ["### Market digest", "### Portfolio snapshot", "### Portfolio digest", "No pending proposals."]) expect([other, prompt.includes(other)]).toEqual([other, false]);
    expect(prompt).toContain('"proposal_waiting": "sell 5 sh');
  });

  it("takes no digest argument of its own: the digest comes only inside the Market and portfolio block", () => {
    // Compile time: latestDigest is not an argument of the trigger run's prompt.
    const noDigestArgument: "latestDigest" extends keyof Parameters<typeof triggerRunRequest>[0] ? false : true = true;
    expect(noDigestArgument).toBe(true);
    const prompt = triggerRunSent({ ...makeArgs(), latestDigest: { narrative: "No pending proposals.", date: "2026-10-07" } });
    expect(prompt).not.toContain("No pending proposals.");
  });
});

describe("the trigger run's situations: the skills as written, the part for its stock", () => {
  const ALL = Object.keys(SITUATIONS) as Array<keyof typeof SITUATIONS>;
  it("a holding gets each skill's part for a holding, a watch the part for a watch, and neither the look back at a sold stock", () => {
    for (const status of ["HOLDING", "WATCHING"]) {
      const read = stockFromRead({ ok: true, data: { theses: [savedRow({ status, situations: ALL })] } }, "thesis_1")!;
      expect(Object.keys(read.situations.guidance)).toEqual(ALL.filter((c) => c !== "SOLD_ONE_REVIEW"));
      for (const [code, text] of Object.entries(read.situations.guidance)) expect([status, code, text]).toEqual([status, code, situationText(code as keyof typeof SITUATIONS, status === "HOLDING")]);
    }
  });
  it("no skill names a status tool; how this run stops watching a stock is its own instructions'", () => {
    const text = ALL.filter((c) => SITUATIONS[c].skill).map((c) => situationText(c, null)).join("\n");
    for (const word of ["change_status", "INVALIDATED", "ARCHIVED", "stop_watching", "watch_again"]) expect([word, text.includes(word)]).toEqual([word, false]);
    expect(triggerRunSent(makeArgs())).toContain("stop watching it (`stop_watching`), or leave it.");
    expect(triggerRunSent(makeArgs())).not.toMatch(/can't end a watch|the morning run decides/);
  });
});

describe("a trigger fire's request — a watch's review gets the Writer's playbooks block (2026-11-17)", () => {
  const review: Trigger = { id: "ep-gap", action: "REVIEW", fireMode: "ASK_NOW", predicate: { match: "all", conditions: [{ watch: "gap", value: 8 }, { watch: "volume", value: 3 }] }, rationale: "The run reads the news and writes the triggers below." };
  const block = playbooksBlock(setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]), (id) => playbookTemplates(null, id));

  it("prints the same block the Writer reads; putting one of its triggers on by reference is the run's own instructions", () => {
    const prompt = triggerRunSent(makeArgs({ trigger: review, position: null, stock: { ticker: "HPE", direction: "LONG", row: row() }, playbooks: block }));
    expect(prompt).toContain(block);
    expect(prompt).not.toContain("a playbook's way in");
    expect(prompt).toContain("put on one of its playbook's triggers by its reference");
  });

  it("a playbook that couldn't be read says so, and the run writes none from it", () => {
    const unread = playbooksBlock(setupsForAnalyst(["EPISODIC_PIVOT"]), null);
    expect(triggerRunSent(makeArgs({ trigger: review, position: null, playbooks: unread }))).toContain("The playbook couldn't be read: write no trigger from it.");
  });

  it("any other run gets none", () => {
    expect(triggerRunSent(makeArgs())).not.toContain("YOUR PLAYBOOKS");
  });
});
