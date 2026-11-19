/**
 * The run after a buy is graded on its own calls (after-buy.ts). GEV's fill
 * on 2026-10-01: a Compounder whose holding triggers are H2–H4, the floor
 * $868 (id "floor"), the chart's swing low $868.25 and base pivot $1,003.
 */
import { scoreAfterBuy, type AfterBuyExpect } from "./after-buy";

const GEV: AfterBuyExpect = { refs: ["H2", "H3", "H4"], floorId: "floor", floorRef: "H1", keys: { "{swingLow}": 868.25, "{pivot}": 1003 }, priceTriggerIds: ["floor", "r850"], noteWanted: true };
const allOn = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "h3" }, { playbook_trigger: "H4", rationale: "The second half once it works." }] } };
const note = { toolName: "write_note", input: { note: "Bought GEV on the reclaim." } };

describe("the run after a buy, graded", () => {
  it("passes: every holding trigger by reference, and the note the trade lacked", () => {
    expect(scoreAfterBuy(GEV, [allOn, note], "Put on H2–H4.")).toEqual({ pass: true, why: "", floorAttempts: [] });
  });

  it("is graded on what production saves: the floor guard drops floor edits, and each is counted", () => {
    // V 2026-10-05: the floor re-stated at {sellPrice} and turned into an Auto-sell; a removal; the playbook's own floor added again.
    const floor = { toolName: "edit_triggers", input: { edit: [{ id: "floor", fire_mode: "DO_IT", price: "{sellPrice}", rationale: "Keep the floor." }], remove: [{ id: "floor", reason: "A duplicate." }], add: [{ playbook_trigger: "H1" }] } };
    expect(scoreAfterBuy(GEV, [allOn, floor, note], "")).toEqual({ pass: true, why: "", floorAttempts: ["add H1", "edit (On fire DO_IT) to {sellPrice}", "remove"] });
  });

  it("a holding trigger left off passes only when the closing line names it", () => {
    const two = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "H3" }] } };
    expect(scoreAfterBuy(GEV, [two, note], "Put on the reviews.").why).toBe("H4 neither put on by reference nor named as left off");
    expect(scoreAfterBuy(GEV, [two, note], "Left H4 off: the add waits for the report.").pass).toBe(true);
  });

  it("a holding trigger already on the stock (the same slot, the playbook's mark) is present, not owed", () => {
    const two = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "H3" }] } };
    expect(scoreAfterBuy({ ...GEV, present: ["H4"] }, [two, note], "").pass).toBe(true);
  });

  it("a trigger of its own in a holding trigger's slot is that trigger, written by hand (SMMT: sell 7 days before the event)", () => {
    const ex = { ...GEV, refSlots: { H4: "from_date:before:event::EXIT" } };
    const byHand = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "H3" }, { action: "EXIT", predicate: { watch: "from_date", is: "before", value: 7, variable: "event" }, rationale: "Out before the FDA date." }] } };
    expect(scoreAfterBuy(ex, [byHand, note], "").pass).toBe(true);
    // Watching the report instead of the event is another slot: not that trigger.
    const report = { toolName: "edit_triggers", input: { add: [{ playbook_trigger: "H2" }, { playbook_trigger: "H3" }, { action: "EXIT", predicate: { watch: "report", is: "before", value: 7 }, rationale: "Out before the report." }] } };
    expect(scoreAfterBuy(ex, [report, note], "").why).toBe("H4 neither put on by reference nor named as left off");
  });

  it("its own trigger needs a reason, and any typed price fails, a key's number or not", () => {
    const own = { toolName: "edit_triggers", input: { add: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: 1003 } }] } };
    expect(scoreAfterBuy(GEV, [allOn, own, note], "").why).toBe("a trigger of its own with no reason; a typed price: $1003 ({pivot})");
    const near = { toolName: "edit_triggers", input: { add: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: 1100 }, rationale: "A round number." }] } };
    expect(scoreAfterBuy(GEV, [allOn, near, note], "").why).toBe("a typed price: $1100");
    const keyed = { toolName: "edit_triggers", input: { add: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: "{pivot}" }, rationale: "The breakout." }] } };
    expect(scoreAfterBuy(GEV, [allOn, keyed, note], "").pass).toBe(true);
  });

  it("an edit or removal needs a reason, and a number typed on a price trigger is a typed price", () => {
    const edit = { toolName: "edit_triggers", input: { edit: [{ id: "r850", value: 900 }], remove: [{ id: "r1" }] } };
    expect(scoreAfterBuy(GEV, [allOn, edit, note], "").why).toBe("an edit with no reason; a removal with no reason; a typed price: $900");
    const days = { toolName: "edit_triggers", input: { edit: [{ id: "clock", value: 45, rationale: "The report is in 45 days." }] } };
    expect(scoreAfterBuy(GEV, [allOn, days, note], "").pass).toBe(true);
  });

  it("an edit_triggers its schema refused fails the run", () => {
    expect(scoreAfterBuy(GEV, [allOn, note], "", [{ tool: "edit_triggers", error: "a price is a key or a line" }]).why).toBe("edit_triggers refused by its schema (1)");
  });

  it("no trade, and a note only when the trade had none", () => {
    expect(scoreAfterBuy(GEV, [allOn, note, { toolName: "add", input: { ticker: "GEV" } }], "").why).toBe("a trade call (add)");
    expect(scoreAfterBuy(GEV, [allOn], "").why).toBe("no note, and the trade had none");
    expect(scoreAfterBuy({ ...GEV, noteWanted: false }, [allOn, note], "").why).toBe("a note, and the trade had one");
  });
});
