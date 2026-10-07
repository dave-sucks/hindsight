/**
 * intraday-tactical.test.ts — what a trigger run reads about the fire.
 *
 * The system prompt is the job alone, the same for every fire. The fire's
 * own paragraphs (tacticalSituation) and the stock as get_theses reads it
 * (stockBrief) ride in the kickoff (tactical-kickoff.ts).
 *
 * The tracked-peak contract for trail fires (DAV-186): a give-back fire must
 * hand the agent the system's remembered peak (Position.peakPrice) and the
 * exact fire line, and tell it the number is authoritative — the HPE
 * 2026-08-18 miss was the validating agent re-deriving a "peak" from a short
 * chart window and declining a genuine protection alarm.
 */

import { buildTacticalSystemPrompt, tacticalSituation, type TacticalSituationArgs } from "./intraday-tactical";
import { fireExtras, tacticalKickoff } from "./tactical-kickoff";
import { stockBrief } from "@/lib/agent/stock-brief";
import { setupChecklist } from "@/lib/agent/knowledge/setup-checklist";
import { protectiveSale } from "@/lib/agent/playbooks/protective-sale";
import { buyArrives } from "@/lib/agent/playbooks/buy-arrives";
import { addOrWinner } from "@/lib/agent/playbooks/add-or-winner";
import type { Trigger } from "@/lib/agent/triggers/types";

const trailTrigger: Trigger = {
  id: "trig_trail",
  predicate: { watch: "move", is: "below", value: 12, variable: "peak" },
  action: "EXIT",
  rationale: "Protect the gain.",
};

function makeArgs(overrides: Partial<TacticalSituationArgs> = {}): TacticalSituationArgs {
  return {
    thesis: { ticker: "HPE", direction: "LONG", researchAge: { freshness: "fresh", daysOld: 1, horizonThreshold: 7 } as never },
    trigger: trailTrigger,
    position: { peakPrice: 62.7 },
    latestDigest: null,
    ...overrides,
  };
}
const situation = (o: Partial<TacticalSituationArgs> = {}) => tacticalSituation(makeArgs(o)).join("\n\n");
const system = buildTacticalSystemPrompt({ analyst: { name: "PEAD Specialist", mandate: null } });

describe("the trigger run's system prompt is the job alone", () => {
  it("names no stock, no trigger and no price, so every fire sends the same text", () => {
    const other = buildTacticalSystemPrompt({ analyst: { name: "PEAD Specialist", mandate: null } });
    expect(other).toBe(system);
    expect(system).not.toMatch(/\$[A-Z]{2,5}\b/);
    expect(system).not.toContain("THESIS (id:");
    expect(system).not.toContain("CURRENT TRIGGER LADDER");
  });
  it("the fire's own paragraphs ride only in the kickoff", () => {
    for (const s of ["give-back from the tracked", "THE ANALYST'S ROOM", "Act on the trigger anyway", "declined this same buy", "YESTERDAY'S PORTFOLIO DIGEST", "It fired at $"]) {
      expect(system).not.toContain(s);
    }
  });
});

describe("tracked peak on trail fires (DAV-186)", () => {
  it("hands the agent the tracked peak and the exact fire line; the sale's playbook says a chart's high is not grounds", () => {
    const text = situation();
    // The HPE numbers: peak 62.70, 12% give-back → fire line 55.176.
    expect(text).toContain("$62.70");
    expect(text).toContain("$55.18");
    expect(protectiveSale.text).toContain("a high read off a chart window is not grounds to call the fire false");
  });

  it("inverts the fire line for SHORT positions (peak is the low-water mark)", () => {
    const text = situation({ thesis: { ...makeArgs().thesis, direction: "SHORT" }, position: { peakPrice: 50 } });
    // 50 * 1.12 = 56.00, and the fire condition reads "at or above".
    expect(text).toContain("$56.00");
    expect(text).toContain("at or above");
  });

  it("still forbids re-deriving when the peak is missing", () => {
    const text = situation({ position: { peakPrice: null } });
    expect(text).toContain("treat the fire as correct rather than reconstructing one yourself");
  });

  it("adds no peak block on non-trailing fires; the brief still shows the tracked high", () => {
    const floorTrigger: Trigger = { id: "trig_floor", predicate: { watch: "price", is: "below", value: 50 }, action: "EXIT", rationale: "Hard stop." };
    expect(situation({ trigger: floorTrigger })).not.toContain("give-back from the tracked");
    const stock = stockBrief(
      { id: "t", ticker: "HPE", status: "HOLDING", direction: "LONG", position: { quantity: 60, avgCost: 53.1, openedAt: "2026-08-01T14:00:00Z", peakPrice: 62.7 } },
      { named: true },
    );
    expect(stock.position).toBe("60 shares at $53.10, bought 2026-08-01; tracked high $62.70");
  });
});

describe("confirm by the setup, one run per fire, the fired price (DAV-254, DAV-265)", () => {
  const stop: Trigger = { id: "stop-969", predicate: { watch: "price", is: "below", value: 969 }, action: "EXIT", rationale: "Stop." };

  it("the brief carries the setup's own confirmation; the buy playbook says to read it, with no horizon volume table", () => {
    const setup = setupChecklist("PEAD", "TARGET")!;
    expect(setup.confirm.join("; ")).toContain("Gap held");
    const stock = stockBrief({ id: "t", ticker: "MU", status: "WATCHING", direction: "LONG", setup: setup as never }, { named: true });
    expect((stock.setup as { confirm: string[] }).confirm).toEqual(setup.confirm);
    expect(buyArrives.text).toContain("The stock's setup says what confirms a buy and its chase limit.");
    expect(system + buyArrives.text).not.toContain("Volume — horizon-conditional");
    expect(system + buyArrives.text).not.toContain("COMPOUNDER horizon:** volume is irrelevant");
  });

  it("with no setup recorded, the price holding is the confirmation", () => {
    expect(buyArrives.text).toContain("With no setup named, the price holding is the confirmation.");
  });

  it("MU 09-14: a stop and a trail that fired together are named in the kickoff and the run decides once", () => {
    const coFired = [{ triggerId: "trail-8", sentence: "Sell if below 8% from the high since we bought" }];
    const kickoff = tacticalKickoff({
      ticker: "MU",
      fireSentence: "Sell if below $969",
      extras: fireExtras({ coFired: coFired.map((c) => c.sentence) }),
      situation: tacticalSituation(makeArgs({ trigger: stop, fired: { price: 964.2, coFired } })),
      playbook: protectiveSale,
    });
    expect(kickoff).toContain("Also fired on the same pass: Sell if below 8% from the high since we bought — one decision covers both.");
    expect(kickoff).toContain("one decision covers both (sell all, some or none); name the rule you followed.");
    expect(kickoff).toContain("The fired trigger's id: stop-969.");
  });

  it("CEG 09-14: the fired price is the price to act on when the tool's quote fails", () => {
    expect(situation({ fired: { price: 264.91, coFired: [] } })).toContain("It fired at $264.91.");
    expect(system).toContain("act on the fired price, never on yesterday's");
  });

  it("the re-ladder duty points at the setup's manage line, not a prose list", () => {
    expect(system).toContain("using the setup's manage line");
    expect(system).not.toContain("Set levels like an analyst");
  });
});

// DAV-292 — the tactical run reads how full the analyst is before it
// researches. Replay: ETN, Secular Compounder, 2026-09-18 09:45 ET — the run
// confirmed the buy by its setup, called place_trade, and only then learned
// the analyst held 4 of 4.
describe("the analyst's room on a buy fire", () => {
  const enter: Trigger = { id: "trig_buy", predicate: { watch: "price", is: "above", value: 418 }, action: "ENTER", rationale: "Buy above $418." };
  const thesis = { ...makeArgs().thesis, ticker: "ETN" };
  it("a full analyst: says so before the stock, and the run is one update — no research, no place_trade", () => {
    const parts = tacticalSituation(makeArgs({ thesis, trigger: enter, position: null, capacity: { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] } }));
    const text = parts.join("\n\n");
    expect(text).toContain("THE ANALYST'S ROOM");
    expect(text).toContain("Positions: 4 of 4 — this analyst is FULL.");
    expect(text).toContain("READ THIS BEFORE YOU RESEARCH.");
    expect(text).toContain('rationale starting "Buy fired into a full analyst (4 of 4)"');
    expect(text).toContain("the weakest of $ABT, $ASML, $CEG, $WST");
    const kickoff = tacticalKickoff({ ticker: "ETN", fireSentence: "Buy if above $418", situation: parts, stock: { ticker: "ETN" } });
    expect(kickoff.indexOf("THE ANALYST'S ROOM")).toBeLessThan(kickoff.indexOf("as get_theses reads it"));
  });
  it("an analyst with room: the line only", () => {
    const text = situation({ thesis, trigger: enter, position: null, capacity: { open: 4, max: 6, held: ["FIVE", "IOT", "MU", "NVDA"] } });
    expect(text).toContain("Positions: 4 of 6 — 2 free.");
    expect(text).not.toContain("READ THIS BEFORE YOU RESEARCH.");
  });
  it("not a buy fire: no room block at all", () => {
    expect(situation({ thesis })).not.toContain("THE ANALYST'S ROOM");
  });
});

// The capacity block is for a fire that would OPEN a position. Adding to a
// stock the analyst already holds takes no slot (caught 2026-09-18).
describe("a full analyst can still add to what it owns", () => {
  it("says OPEN a new position, not any buy", () => {
    const text = situation({ thesis: { ...makeArgs().thesis, ticker: "ETN" }, capacity: { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] } });
    expect(text).toContain("cannot OPEN a new position");
    expect(text).toContain("Adding to a stock it already holds is not capped");
  });
});

// A declined protective sale is a standing order (the 2026-08-16 ruling):
// it is proposed again every day its condition holds. A sentence added
// 2026-09-30 told every trigger run to "say so and pass" after a decline,
// whatever fired. On the NVDA case (scripts/hero-cases/nvda-declined-sale)
// twelve runs each, same hour: with it 1 of 12 proposed the sale and 8 tried
// to delete the trailing stop; without it 11 of 12 proposed the sale.
describe("a declined sale is asked again", () => {
  const PASS = "say so and pass";
  it("a protective sale fire carries no pass-after-decline line, and neither does the system prompt", () => {
    expect(situation()).not.toContain(PASS);
    expect(system).not.toContain(PASS);
  });
  it("a buy or add fire keeps it, through its playbook: a declined buy or add is not re-proposed unchanged", () => {
    const enter: Trigger = { id: "trig_buy", predicate: { watch: "price", is: "above", value: 60 }, action: "ENTER", rationale: "Buy the breakout." };
    const add: Trigger = { ...enter, id: "trig_add", action: "ADD" };
    expect(situation({ trigger: enter, position: null })).not.toContain(PASS);
    expect(situation({ trigger: add })).not.toContain(PASS);
    expect(buyArrives.text).toContain(PASS);
    expect(addOrWinner.text).toContain(PASS);
  });
});
