/**
 * thesis-doors.test.ts — what each caller may change on a thesis, by tool
 * (Roadmap step 12, part 1; one job a tool since 2026-11-18).
 *
 * The rule, as a table the test prints: the write-up and the claim are the
 * Writer's (its save, update_thesis, runs in code); a run's note carries the
 * review's verdict; the triggers are edit_triggers, the playbook named by the
 * morning run and the chat; conviction and the catalyst date are the morning
 * run's and the chat's; whether we watch a stock is the morning run's and the
 * chat's. The trigger run notes and edits triggers only. The Portfolio
 * Manager notes and edits triggers. A field present gets filled, so a caller
 * is offered only what it may change.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { MODES } from "@/lib/agent/modes";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";
import { createResearchTools } from "@/lib/agent/tools";

const THESIS_TOOLS = ["update_thesis", "write_note", "edit_triggers", "set_conviction", "set_catalyst_date", "stop_watching", "watch_again"];

/** The callers, the tools each is given, and the context a run builds. */
const CALLERS = [
  { name: "writer", runMode: "THESIS_WRITER", tools: ["update_thesis"] },
  { name: "chat", runMode: "PRINCIPAL_CHAT", tools: MODES.principal.toolAllowlist as readonly string[] },
  { name: "morning run", runMode: "MORNING_PLAN", tools: MODES["research-run"].toolAllowlist as readonly string[] },
  { name: "trigger run", runMode: "INTRADAY_TACTICAL", tools: MODES.tactical.toolAllowlist as readonly string[], runStock: { ticker: "NVDA", thesisId: "t", triggerId: "tr" } },
  { name: "portfolio manager", runMode: "PORTFOLIO_MANAGER", tools: PORTFOLIO_MANAGER.tools },
] as const;

/** Each caller's thesis tools and the fields each shows the model. */
function doorsOf(c: (typeof CALLERS)[number]): Record<string, string[]> {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode: c.runMode, runEnvironment: "PAPER", ...("runStock" in c ? { runStock: c.runStock } : {}) } as never) as Record<string, { inputSchema: unknown }>;
  return Object.fromEntries(
    c.tools
      .filter((t) => THESIS_TOOLS.includes(t))
      .map((t) => [t, Object.keys((zodSchema(all[t].inputSchema as never).jsonSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort()]),
  );
}

const EXPECTED: Record<string, Record<string, string[]>> = {
  chat: {
    write_note: ["about_date", "analyst_id", "note", "pinned_until", "thesis_id", "tickers", "whole_account"],
    edit_triggers: ["add", "edit", "remove", "setup_id", "thesis_id"],
    set_conviction: ["conviction", "conviction_rationale", "opinion", "outlook", "thesis_id"],
    set_catalyst_date: ["catalyst_date", "thesis_id"],
    stop_watching: ["reason", "thesis_id"],
    watch_again: ["thesis_id"],
  },
  "morning run": {
    write_note: ["answers_update_id", "conviction", "conviction_rationale", "note", "opinion", "outlook", "thesis_id", "trigger_id", "verdict", "verdict_line"],
    edit_triggers: ["add", "edit", "remove", "setup_id", "thesis_id"],
    set_catalyst_date: ["catalyst_date", "thesis_id"],
    stop_watching: ["reason", "thesis_id"],
    watch_again: ["thesis_id"],
  },
  "trigger run": {
    write_note: ["answers_update_id", "conviction", "conviction_rationale", "note", "opinion", "outlook", "verdict", "verdict_line"],
    edit_triggers: ["add", "edit", "remove"],
    // Its own stock: code fills the thesis.
    stop_watching: ["reason"],
  },
  "portfolio manager": {
    write_note: ["note", "thesis_id"],
    edit_triggers: ["add", "edit", "remove", "thesis_id"],
  },
};

describe("what each caller may change on a thesis, by tool", () => {
  const byCaller = Object.fromEntries(CALLERS.map((c) => [c.name, doorsOf(c)]));

  it("prints the table: each caller's thesis tools and their fields", () => {
    const lines = ["| caller | tool | fields |", "|---|---|---|"];
    for (const [caller, doors] of Object.entries(byCaller)) for (const [t, f] of Object.entries(doors)) lines.push(`| ${caller} | ${t} | ${f.join(", ")} |`);
    console.log(lines.join("\n"));
    expect(Object.keys(byCaller.writer)).toEqual(["update_thesis"]);
  });

  it.each(Object.keys(EXPECTED))("%s: exactly its tools and fields", (caller) => {
    expect(byCaller[caller]).toEqual(EXPECTED[caller]);
  });

  it("no agent is given update_thesis: it is the Writer's save, run in code", () => {
    for (const c of CALLERS.filter((x) => x.name !== "writer")) expect(c.tools).not.toContain("update_thesis");
  });

  it("the claim, the view and the write-up are the Writer's alone", () => {
    const writerOnly = ["core_belief", "kpis", "direction", "horizon", "company", "bull_case", "bear_case", "research_data", "price_at_time", "change_status"];
    for (const [caller, doors] of Object.entries(byCaller)) {
      if (caller === "writer") continue;
      for (const fields of Object.values(doors)) expect(fields.filter((f) => writerOnly.includes(f))).toEqual([]);
    }
    for (const f of writerOnly.filter((x) => x !== "change_status")) expect(byCaller.writer.update_thesis).toContain(f);
  });

  it("the trigger run can stop watching its stock, can't reopen a watch, and has no playbook field", () => {
    expect(Object.keys(byCaller["trigger run"]).sort()).toEqual(["edit_triggers", "stop_watching", "write_note"]);
  });
});

