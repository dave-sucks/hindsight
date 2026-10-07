/**
 * playbooks.test.ts — a playbook reaches a stock only when its situation is
 * on the row, and each one stays under its cap (docs/plans/AGENT_ARCHITECTURE.md, 10.1, 10.4).
 */
import { PLAYBOOKS, playbookForFire, playbooksForRow, playbookTexts } from "@/lib/agent/playbooks";
import type { StockRow } from "@/lib/agent/stock-brief";

const row = (over: Partial<StockRow>): StockRow => ({ id: "t", ticker: "MU", status: "HOLDING", direction: "LONG", ...over });

describe("the playbooks", () => {
  it("each is under its cap, in five parts, with no bold or capitals warnings", () => {
    for (const p of PLAYBOOKS) {
      expect(p.text.length).toBeLessThanOrEqual(p.cap);
      for (const part of ["When:", "Answer, in order:", "What you can do:", "Answered:", "Mistakes:"]) expect(p.text).toContain(part);
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
    expect(playbookForFire({ action: "ENTER", held: false })).toBeNull();
  });

  it("a read carries each named playbook once", () => {
    const texts = playbookTexts(["protective-sale", "protective-sale", "no-such"]);
    expect(Object.keys(texts)).toEqual(["protective-sale"]);
  });
});
