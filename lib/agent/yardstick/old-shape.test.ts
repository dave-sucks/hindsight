/**
 * The cases name the old tools; a run on today's tools is graded in their
 * shape (old-shape.ts). NVDA's declined-sale case: the run sells with sell
 * and tightens its trail with edit_triggers; the case's rules read
 * close_position and an update_thesis with edit_triggers, and pass on both.
 */
import { inOldShape } from "./old-shape";
import { score } from "./action";
import nvda from "../../../scripts/hero-cases/nvda-declined-sale.json";

describe("today's calls, graded in the cases' shape", () => {
  it("a sale is close_position, a part sale manage_position, an add manage_position", () => {
    expect(inOldShape([{ toolName: "sell", input: { ticker: "NVDA", belief_survived: true } }])).toEqual([{ toolName: "close_position", input: { ticker: "NVDA", belief_survived: true } }]);
    expect(inOldShape([{ toolName: "sell", input: { ticker: "NVDA", percent: 30 } }])).toEqual([{ toolName: "manage_position", input: { symbol: "NVDA", action: "partial_close", close_pct: 30 } }]);
    expect(inOldShape([{ toolName: "add", input: { ticker: "NVDA" } }])).toEqual([{ toolName: "manage_position", input: { symbol: "NVDA", action: "add_to_position" } }]);
  });

  it("a run's thesis calls on one stock are one update_thesis; the chat's note stays the owner's", () => {
    const out = inOldShape([
      { toolName: "edit_triggers", input: { thesis_id: "t", edit: [{ id: "a", value: 1 }] } },
      { toolName: "write_note", input: { thesis_id: "t", note: "The note.", trigger_id: "fired" } },
      { toolName: "stop_watching", input: { thesis_id: "u", reason: "Gone." } },
    ]);
    expect(out).toEqual([
      { toolName: "update_thesis", input: { thesis_id: "t", edit_triggers: [{ id: "a", value: 1 }], rationale: "The note.", trigger_id: "fired" } },
      { toolName: "update_thesis", input: { thesis_id: "u", change_status: "ARCHIVED", rationale: "Gone." } },
    ]);
    expect(inOldShape([{ toolName: "write_note", input: { thesis_id: "t", note: "Theirs." } }], true)).toEqual([{ toolName: "write_note", input: { thesis_id: "t", note: "Theirs." } }]);
  });

  it("an old run's calls pass as they were", () => {
    const old = [{ toolName: "update_thesis", input: { thesis_id: "t", rationale: "x" } }, { toolName: "close_position", input: { ticker: "X" } }];
    expect(inOldShape(old)).toEqual(old);
  });

  it("NVDA's declined sale: a sale with sell passes the case's close_position rule", () => {
    const calls = [{ toolName: "sell", input: { ticker: "NVDA", belief_survived: true } }, { toolName: "write_note", input: { thesis_id: "x", note: "Selling." } }];
    expect(score(nvda.expect as never, inOldShape(calls), "").pass).toBe(true);
    const removed = [{ toolName: "edit_triggers", input: { thesis_id: "x", remove: [{ id: "e9a27456-c604-4ae2-8dd6-5ccb6e96382e", reason: "Off." }] } }];
    expect(score(nvda.expect as never, inOldShape(removed), "").pass).toBe(false);
  });
});
