/**
 * writer-only-fields.test.ts — step 5 of docs/plans/AGENT_ARCHITECTURE.md,
 * part 1: the research sections only the writer's save fills leave every
 * agent's copy of update_thesis and record_thesis, and the writer keeps them.
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

function fields(runMode: string, tool: "update_thesis" | "record_thesis"): string[] {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
  const js = zodSchema(all[tool].inputSchema as never).jsonSchema as { properties?: Record<string, unknown> };
  return Object.keys(js.properties ?? {});
}

describe("writer-only research fields", () => {
  for (const runMode of ["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT", "DISCOVERY"]) {
    it(`${runMode}: update_thesis and record_thesis carry none of them`, () => {
      expect(fields(runMode, "update_thesis").filter((f) => SECTIONS.includes(f))).toEqual([]);
      expect(fields(runMode, "record_thesis").filter((f) => [...SECTIONS, "snapshot", "thesis_bullets", "risk_flags"].includes(f))).toEqual([]);
    });
  }

  it("an agent keeps the fields it uses: the snapshot on the chat's update_thesis, the plan and the belief on both", () => {
    const u = fields("MORNING_PLAN", "update_thesis");
    for (const f of ["entry_price", "stop_loss", "core_belief", "add_triggers"]) expect(u).toContain(f);
    const c = fields("PRINCIPAL_CHAT", "update_thesis");
    for (const f of ["snapshot", "scoring"]) expect(c).toContain(f);
    const r = fields("PRINCIPAL_CHAT", "record_thesis");
    for (const f of ["ticker", "direction", "reasoning_summary", "triggers", "stock_fundamentals", "core_belief"]) expect(r).toContain(f);
  });

  it("the writer's save keeps a research section; an agent's schema would drop it", () => {
    const section = { bullets: [{ text: "Two record quarters; guidance raised." }] };
    const writerUpdate = updateThesis({ runId: "w", userId: "u", analystId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } } };
    const agentUpdate = updateThesis({ runId: "m", userId: "u", analystId: "a", runMode: "MORNING_PLAN" } as never) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } } };
    const args = { thesis_id: "t1", rationale: "Refreshed after the print.", bull_case: section };
    const w = writerUpdate.inputSchema.safeParse(args);
    expect(w.success).toBe(true);
    expect(w.data?.bull_case).toEqual(section);
    expect(agentUpdate.inputSchema.safeParse(args).data?.bull_case).toBeUndefined();

    const writerRecord = recordThesis({ runId: "w", userId: "u", analystId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown>; error?: unknown } } };
    const mint = { ticker: "CRWD", direction: "PASS", reasoning_summary: "Extended; no entry.", invalidation_conditions: ["A close back under the 50-day."], horizon: "COMPOUNDER", source_kind: "WEB_SEARCH", source_rationale: "Writer mint.", bull_case: { bullets: [{ text: "ARR re-accelerating." }] } };
    const r = writerRecord.inputSchema.safeParse(mint);
    expect(r.success).toBe(true);
    expect(r.data?.bull_case).toEqual(mint.bull_case);
  });
});
