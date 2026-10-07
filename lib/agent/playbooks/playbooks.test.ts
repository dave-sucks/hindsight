/**
 * playbooks.test.ts — a playbook reaches a stock only when its situation is
 * on the row, and each one stays under its cap (docs/plans/AGENT_ARCHITECTURE.md, 10.1, 10.4).
 */
import { PLAYBOOKS, playbookForFire, playbooksForFire, playbooksForRow, playbookTexts } from "@/lib/agent/playbooks";
import type { StockRow } from "@/lib/agent/stock-brief";

const row = (over: Partial<StockRow>): StockRow => ({ id: "t", ticker: "MU", status: "HOLDING", direction: "LONG", ...over });

describe("the playbooks", () => {
  it("each is under its cap, in five parts, with no bold or capitals warnings", () => {
    for (const p of PLAYBOOKS) {
      expect(p.text.length).toBeLessThanOrEqual(p.cap);
      for (const part of ["When:", "Answer, in order:", "What you can do", "Answered:", "Mistakes:"]) expect(p.text).toContain(part);
      expect(p.text).not.toMatch(/\*\*|⚠|[A-Z]{4,} [A-Z]{4,}/);
    }
  });

  it("keys are unique", () => {
    expect(new Set(PLAYBOOKS.map((p) => p.key)).size).toBe(PLAYBOOKS.length);
  });
});

describe("protective sale: when it attaches", () => {
  it("a held stock whose lead flag is a fired or matching sale, or a declined sale", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "EXIT" } }))).toEqual(["protective-sale"]);
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_MATCHING_NOW", action: "EXIT" } }))).toEqual(["protective-sale"]);
    expect(playbooksForRow(row({ needsAction: { kind: "SALE_DECLINED", declineCount: 2 } }))).toEqual(["protective-sale"]);
  });

  it("not a watched stock's floor (the plan comes down; nothing is sold), a review, or a quiet holding", () => {
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "TRIGGER_FIRED", action: "EXIT" } }))).toEqual([]);
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "REVIEW" } }))).toEqual([]);
    expect(playbooksForRow(row({ needsAction: null }))).toEqual([]);
  });

  it("a trigger run carries it for a sale fired on a stock we hold, and only then", () => {
    expect(playbookForFire({ action: "EXIT", held: true })?.key).toBe("protective-sale");
    expect(playbookForFire({ action: "EXIT", held: false })).toBeNull();
    expect(playbookForFire({ action: "REVIEW", held: true })).toBeNull();
  });

  it("a read carries each named playbook once, in ranking order", () => {
    expect(Object.keys(playbookTexts(["buy-arrives", "protective-sale"]))).toEqual(["protective-sale", "buy-arrives"]);
    const texts = playbookTexts(["protective-sale", "protective-sale", "no-such"]);
    expect(Object.keys(texts)).toEqual(["protective-sale"]);
  });
});

describe("buy arrives: when it attaches", () => {
  it("a watched stock whose lead flag is a fired or matching buy, or whose buy level the price has reached", () => {
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "TRIGGER_FIRED", action: "ENTER" } }))).toEqual(["buy-arrives"]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "TRIGGER_MATCHING_NOW", action: "ENTER" } }))).toEqual(["buy-arrives"]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: null, resolved: { actionability: "ENTER_NOW" } }))).toEqual(["buy-arrives"]);
  });
  it("not a held stock, a review, or a watch still waiting", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "ENTER" } }))).toEqual([]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "TRIGGER_FIRED", action: "REVIEW" } }))).toEqual([]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: null, resolved: { actionability: "WAIT_FOR_TRIGGER" } }))).toEqual([]);
  });
  it("a trigger run carries it for a buy on a stock we don't hold", () => {
    expect(playbookForFire({ action: "ENTER", held: false })?.key).toBe("buy-arrives");
    expect(playbookForFire({ action: "ENTER", held: true })).toBeNull();
  });
});

describe("add or winner: when it attaches", () => {
  it("a held stock whose lead flag is a fired or matching add, or that has come three quarters of the way to its target", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "ADD" } }))).toEqual(["add-or-winner"]);
    expect(playbooksForRow(row({ needsAction: null, resolved: { progressToTarget: 0.75 } }))).toEqual(["add-or-winner"]);
    expect(playbooksForRow(row({ needsAction: null, resolved: { progressToTarget: 1.4 } }))).toEqual(["add-or-winner"]);
  });
  it("not short of the mark, not a watched stock", () => {
    expect(playbooksForRow(row({ needsAction: null, resolved: { progressToTarget: 0.74 } }))).toEqual([]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "TRIGGER_FIRED", action: "ADD" } }))).toEqual([]);
  });
  it("a fired sale on a winner near its target carries both, the sale first", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "EXIT" }, resolved: { progressToTarget: 0.9 } }))).toEqual(["protective-sale", "add-or-winner"]);
  });
  it("a trigger run carries it for an add on a stock we hold", () => {
    expect(playbookForFire({ action: "ADD", held: true })?.key).toBe("add-or-winner");
  });
});

describe("earnings: when it attaches", () => {
  const beatSold = { id: "e1", action: "REVIEW", predicate: { match: "all", conditions: [{ watch: "surprise", is: "beat" }, { watch: "move", is: "below", value: 3 }] } };
  const reportSoon = { id: "e2", level: "ACCOUNT", action: "REVIEW", predicate: { watch: "report", is: "before", value: 5 } };
  it("the lead flag is a fire of a trigger watching a surprise or a report date, its own or inherited", () => {
    expect(playbooksForRow(row({ triggers: [beatSold], needsAction: { kind: "TRIGGER_FIRED", triggerId: "e1", action: "REVIEW" } }))).toEqual(["earnings"]);
    expect(playbooksForRow(row({ status: "WATCHING", inheritedTriggers: [reportSoon], needsAction: { kind: "TRIGGER_FIRED", triggerId: "e2", action: "REVIEW" } }))).toEqual(["earnings"]);
  });
  it("not another review, and not when the row does not carry the trigger", () => {
    const floor = { id: "f", action: "REVIEW", predicate: { watch: "price", is: "below", value: 10 } };
    expect(playbooksForRow(row({ triggers: [floor], needsAction: { kind: "TRIGGER_FIRED", triggerId: "f", action: "REVIEW" } }))).toEqual([]);
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", triggerId: "e1", action: "REVIEW" } }))).toEqual([]);
  });
  it("a trigger run carries it for an earnings fire; a sale on a miss carries both", () => {
    expect(playbooksForFire({ action: "REVIEW", held: true, predicate: beatSold.predicate }).map((p) => p.key)).toEqual(["earnings"]);
    expect(playbooksForFire({ action: "EXIT", held: true, predicate: { watch: "surprise", is: "miss" } }).map((p) => p.key)).toEqual(["protective-sale", "earnings"]);
  });
});

describe("filings: when it attaches", () => {
  const filed = { id: "s1", level: "ACCOUNT", action: "REVIEW", predicate: { watch: "filing", variable: "tier:MATERIAL" } };
  it("the lead flag is a fire of a trigger watching the stock's filings", () => {
    expect(playbooksForRow(row({ inheritedTriggers: [filed], needsAction: { kind: "TRIGGER_FIRED", triggerId: "s1", action: "REVIEW" } }))).toEqual(["filings"]);
    expect(playbooksForFire({ action: "REVIEW", held: true, predicate: filed.predicate }).map((p) => p.key)).toEqual(["filings"]);
  });
});

describe("protection: when it attaches", () => {
  it("a holding whose lead flag is an unprotected gain or a floor too far, or whose floor's risk rides beside another lead", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "UNPROTECTED_GAIN" } }))).toEqual(["protection"]);
    expect(playbooksForRow(row({ needsAction: { kind: "FLOOR_TOO_FAR" } }))).toEqual(["protection"]);
    expect(playbooksForRow(row({ needsAction: { kind: "TRIGGER_FIRED", action: "EXIT" }, resolved: { floorRisk: { line: "x" } } }))).toEqual(["protective-sale", "protection"]);
  });
  it("never a watched stock, never a trigger run", () => {
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "UNPROTECTED_GAIN" } }))).toEqual([]);
    expect(playbooksForFire({ action: "EXIT", held: true }).map((p) => p.key)).not.toContain("protection");
  });
});

describe("stale research: when it attaches", () => {
  it("the lead flag, or stale or missing research on any listed row with a committed view", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "RESEARCH_STALE" } }))).toEqual(["stale-research"]);
    expect(playbooksForRow(row({ status: "WATCHING", needsAction: { kind: "REVIEW_DUE" }, researchAge: { freshness: "stale", daysOld: 90 } }))).toEqual(["stale-research"]);
  });
  it("not fresh research, not a seed or a watch with no view, never a trigger run", () => {
    expect(playbooksForRow(row({ needsAction: { kind: "REVIEW_DUE" }, researchAge: { freshness: "fresh", daysOld: 3 } }))).toEqual([]);
    expect(playbooksForRow(row({ direction: null, status: "WATCHING", researchAge: { freshness: "missing" } }))).toEqual([]);
    expect(playbooksForFire({ action: "REVIEW", held: true }).map((p) => p.key)).not.toContain("stale-research");
  });
});
