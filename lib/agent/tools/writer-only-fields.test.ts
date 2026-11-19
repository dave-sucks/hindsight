/**
 * writer-only-fields.test.ts — step 5 of docs/plans/AGENT_ARCHITECTURE.md,
 * part 1: the research sections only the writer's save fills are on no
 * agent's thesis tool (record_thesis and, since 2026-11-18, the one-job tools
 * that replaced update_thesis for agents), and the writer keeps them.
 *
 * The writer saves by running its arguments through the tool's own schema
 * (run-thesis-writer.ts, executeThroughSchema), and a schema without a field
 * drops it silently. So the second half of this test is the one that matters:
 * a writer-mode schema keeps a section, and an agent-mode schema would not.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { createResearchTools } from "@/lib/agent/tools";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import { updateThesis } from "@/lib/agent/tools/update-thesis";

const SECTIONS = ["bull_case", "bear_case", "recent_catalysts", "fundamentals", "latest_earnings", "catalysts_and_events", "analyst_consensus", "insider_technical", "research_data"];

/** The thesis tools an agent is given, one job each (2026-11-18). */
const AGENT_THESIS_TOOLS = ["write_note", "edit_triggers", "set_conviction", "set_catalyst_date", "stop_watching", "watch_again"];

function fields(runMode: string, tool: string): string[] {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
  const js = zodSchema(all[tool].inputSchema as never).jsonSchema as { properties?: Record<string, unknown> };
  return Object.keys(js.properties ?? {});
}

describe("writer-only research fields", () => {
  for (const runMode of ["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT", "DISCOVERY"]) {
    it(`${runMode}: the agent thesis tools and record_thesis carry none of them`, () => {
      for (const t of AGENT_THESIS_TOOLS) expect(fields(runMode, t).filter((f) => SECTIONS.includes(f))).toEqual([]);
      expect(fields(runMode, "record_thesis").filter((f) => [...SECTIONS, "snapshot", "thesis_bullets", "risk_flags"].includes(f))).toEqual([]);
    });
  }

  it("an agent keeps the fields it uses: the triggers on edit_triggers; the claim and the view are the writer's alone", () => {
    for (const mode of ["MORNING_PLAN", "PRINCIPAL_CHAT"]) {
      const u = fields(mode, "edit_triggers");
      for (const f of ["add", "edit", "remove", "setup_id"]) expect(u).toContain(f);
      // The claim is the writer's (2026-11-18: the chat's last use was one seed commit, 2026-10-02).
      for (const t of AGENT_THESIS_TOOLS) for (const f of ["core_belief", "direction", "snapshot", "scoring", "variant_view", "price_at_time", "horizon"]) expect(fields(mode, t)).not.toContain(f);
    }
    const r = fields("PRINCIPAL_CHAT", "record_thesis");
    for (const f of ["ticker", "direction", "reasoning_summary", "triggers", "stock_fundamentals", "core_belief"]) expect(r).toContain(f);
  });

  it("the writer's save keeps a research section; an agent's schema would drop it", () => {
    const section = { bullets: [{ text: "Two record quarters; guidance raised." }] };
    const writerUpdate = updateThesis({ runId: "w", userId: "u", analystId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } } };
    const all = createResearchTools({ runId: "m", userId: "u", accountId: "a", analystId: "an", runMode: "MORNING_PLAN", runEnvironment: "PAPER" } as never) as Record<string, unknown>;
    const agentEdit = all.edit_triggers as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } } };
    const args = { thesis_id: "t1", rationale: "Refreshed after the print.", bull_case: section };
    const w = writerUpdate.inputSchema.safeParse(args);
    expect(w.success).toBe(true);
    expect(w.data?.bull_case).toEqual(section);
    expect(agentEdit.inputSchema.safeParse(args).data?.bull_case).toBeUndefined();

    const writerRecord = recordThesis({ runId: "w", userId: "u", analystId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown>; error?: unknown } } };
    const mint = { ticker: "CRWD", direction: "PASS", reasoning_summary: "Extended; no entry.", invalidation_conditions: ["A close back under the 50-day."], horizon: "COMPOUNDER", source_kind: "WEB_SEARCH", source_rationale: "Writer mint.", bull_case: { bullets: [{ text: "ARR re-accelerating." }] } };
    const r = writerRecord.inputSchema.safeParse(mint);
    expect(r.success).toBe(true);
    expect(r.data?.bull_case).toEqual(mint.bull_case);
  });
});
