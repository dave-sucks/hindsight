/**
 * The cases name the old tools; a run on today's tools is graded in their
 * shape (old-shape.ts). NVDA's declined-sale case: the run sells with sell
 * and tightens its trail with edit_triggers; the case's rules read
 * close_position and an update_thesis with edit_triggers, and pass on both.
 */
import { explainOldShape, inOldShape } from "./old-shape";
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

  // Every tool main (b6476097) offers the morning run, the trigger run and the chat: main's calls grade exactly as before.
  const MAIN_TOOLS: Record<string, string[]> = {
    morning: ["get_portfolio_context", "get_theses", "get_stock_data", "web_search", "get_market_context", "get_earnings_data", "get_sec_filings", "update_thesis", "place_trade", "manage_position", "close_position", "dispatch_thesis_research", "wait_for_thesis_refresh", "record_run_summary", "complete_run"],
    trigger: ["get_stock_data", "get_earnings_data", "get_sec_filings", "get_catalyst_calendar", "web_search", "get_theses", "place_trade", "close_position", "manage_position", "dispatch_thesis_research", "wait_for_thesis_refresh", "update_thesis", "complete_run"],
    chat: ["list_analysts", "read_analyst_config", "list_runs", "read_run", "read_accuracy_reports", "list_proposals", "read_database", "get_theses", "get_portfolio_context", "read_knowledge_library", "get_market_context", "get_stock_data", "get_earnings_data", "get_earnings_calendar", "get_market_movers", "run_screen", "read_trade_results", "get_sec_filings", "get_catalyst_calendar", "web_search", "record_thesis", "update_thesis", "place_trade", "manage_position", "close_position", "write_note", "ask_question", "dispatch_thesis_research", "wait_for_thesis_refresh"],
  };
  it.each(Object.entries(MAIN_TOOLS))("main's %s calls pass through unchanged, in order, with nothing listed as unmapped", (mode, tools) => {
    const calls = tools.map((toolName, i) => ({ toolName, input: { thesis_id: `t${i % 2}`, ticker: "NVDA", rationale: "x", edit_triggers: [{ id: "a", value: 1 }], i } }));
    const out = explainOldShape(calls, mode === "chat");
    expect(out.graded).toEqual(calls);
    expect(out.unmapped).toEqual([]);
  });

  it("a call of today's tools missing the stock or thesis its old call keyed on is graded and listed", () => {
    const out = explainOldShape([{ toolName: "sell", input: { belief_survived: true } }, { toolName: "write_note", input: { note: "x" } }]);
    expect(out.unmapped.map((u) => [u.toolName, u.why])).toEqual([["sell", "no ticker"], ["write_note", "no thesis_id"]]);
    expect(out.graded.map((c) => c.toolName)).toEqual(["close_position", "update_thesis"]);
  });

  it("NVDA's declined sale: a sale with sell passes the case's close_position rule", () => {
    const calls = [{ toolName: "sell", input: { ticker: "NVDA", belief_survived: true } }, { toolName: "write_note", input: { thesis_id: "x", note: "Selling." } }];
    expect(score(nvda.expect as never, inOldShape(calls), "").pass).toBe(true);
    const removed = [{ toolName: "edit_triggers", input: { thesis_id: "x", remove: [{ id: "e9a27456-c604-4ae2-8dd6-5ccb6e96382e", reason: "Off." }] } }];
    expect(score(nvda.expect as never, inOldShape(removed), "").pass).toBe(false);
  });

  it("thesis edits with no note on a stock can't pass a case that asks for its update_thesis, and still trip a never rule", () => {
    const ex = { call: [{ tool: "update_thesis", where: { thesis_id: "t" } }], never: [{ tool: "update_thesis", where: { "remove_trigger_ids.*": "floor" } }] };
    const edits = [{ toolName: "edit_triggers", input: { thesis_id: "t", add: [{ action: "REVIEW" }] } }, { toolName: "set_conviction", input: { thesis_id: "t", conviction: "LOW" } }];
    expect(score(ex as never, inOldShape(edits), "").pass).toBe(false);
    expect(score(ex as never, inOldShape([...edits, { toolName: "write_note", input: { thesis_id: "t", note: "Orders slowed." } }]), "").pass).toBe(true);
    expect(score(ex as never, inOldShape([{ toolName: "edit_triggers", input: { thesis_id: "t", remove: [{ id: "floor" }] } }, { toolName: "write_note", input: { thesis_id: "t", note: "x" } }]), "").pass).toBe(false);
  });

  it("the chat's trigger edit passes a case's update_thesis rule with no note: the owner's note answers nothing", () => {
    const ex = { call: [{ tool: "update_thesis" }, { tool: "ask_question" }] };
    const arm = [{ toolName: "edit_triggers", input: { thesis_id: "t", add: [{ action: "ENTER" }] } }];
    expect(score(ex as never, inOldShape(arm, true), "").pass).toBe(true);
    expect(score(ex as never, inOldShape(arm), "").pass).toBe(false);
  });

  it("main's update_thesis passes a call rule as before: it always carried a note", () => {
    const ex = { call: [{ tool: "update_thesis", where: { thesis_id: "t" } }] };
    expect(score(ex as never, inOldShape([{ toolName: "update_thesis", input: { thesis_id: "t", rationale: "x" } }]), "").pass).toBe(true);
  });

  it("a sale with no percent on a run a trim woke is that trim, as production sells it", () => {
    const run = { firedTrim: { ticker: "NVDA", pct: 30 } };
    expect(inOldShape([{ toolName: "sell", input: { ticker: "NVDA" } }], run)).toEqual([{ toolName: "manage_position", input: { symbol: "NVDA", action: "partial_close", close_pct: 30 } }]);
    expect(inOldShape([{ toolName: "sell", input: { ticker: "NVDA", percent: 100 } }], run)).toEqual([{ toolName: "close_position", input: { ticker: "NVDA" } }]);
    expect(inOldShape([{ toolName: "sell", input: { ticker: "MU" } }], run)).toEqual([{ toolName: "close_position", input: { ticker: "MU" } }]);
  });
});
