/**
 * The run after a buy is graded on its own calls (after-buy.ts). GEV's fill
 * on 2026-10-01: a Compounder whose holding triggers are H2–H4, the floor
 * $868 (id "floor"), the chart's swing low $868.25 and base pivot $1,003.
 */
import { scoreAfterBuy, type AfterBuyExpect } from "./after-buy";

const GEV: AfterBuyExpect = { refs: ["H2", "H3", "H4"], floorId: "floor", keys: { "{swingLow}": 868.25, "{pivot}": 1003 }, noteWanted: true };
const allOn = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "h3" }, { playbook_trigger: "H4", rationale: "The second half once it works." }] } };
const note = { toolName: "write_note", input: { note: "Bought GEV on the reclaim." } };

describe("the run after a buy, graded", () => {
  it("passes: every holding trigger by reference, and the note the trade lacked", () => {
    expect(scoreAfterBuy(GEV, [allOn, note], "Put on H2–H4.")).toEqual({ pass: true, why: "" });
  });

  it("a holding trigger left off passes only when the closing line names it", () => {
    const two = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "H3" }] } };
    expect(scoreAfterBuy(GEV, [two, note], "Put on the reviews.").why).toBe("H4 neither put on by reference nor named as left off");
    expect(scoreAfterBuy(GEV, [two, note], "Left H4 off: the add waits for the report.").pass).toBe(true);
  });

  it("its own trigger needs a reason, and a price typed where a key gives it fails", () => {
    const own = { toolName: "edit_triggers", input: { add: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: 1003 } }] } };
    expect(scoreAfterBuy(GEV, [allOn, own, note], "").why).toBe("a trigger of its own with no reason; a price typed where a key gives it: $1003 ({pivot})");
    const keyed = { toolName: "edit_triggers", input: { add: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: "{pivot}" }, rationale: "The breakout." }] } };
    expect(scoreAfterBuy(GEV, [allOn, keyed, note], "").pass).toBe(true);
  });

  it("an edit or removal needs a reason, and the floor is left alone", () => {
    const edit = { toolName: "edit_triggers", input: { edit: [{ id: "floor", value: 900 }], remove: [{ id: "r1" }] } };
    expect(scoreAfterBuy(GEV, [allOn, edit, note], "").why).toBe("an edit with no reason; a removal with no reason; changed the floor");
  });

  it("no trade, and a note only when the trade had none", () => {
    expect(scoreAfterBuy(GEV, [allOn, note, { toolName: "add", input: { ticker: "GEV" } }], "").why).toBe("a trade call (add)");
    expect(scoreAfterBuy(GEV, [allOn], "").why).toBe("no note, and the trade had none");
    expect(scoreAfterBuy({ ...GEV, noteWanted: false }, [allOn, note], "").why).toBe("a note, and the trade had one");
  });
});
