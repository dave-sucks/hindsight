/**
 * descriptions-agree.test.ts — what a tool's field descriptions say matches
 * what the save does (step 5 of docs/plans/AGENT_ARCHITECTURE.md).
 *
 * Each sentence below was wrong on 2026-10-05:
 *   - change_status said WATCHING was "PROMOTED → WATCHING only"; it is how a
 *     sold stock goes back on watch (thesis-transitions.ts), and the morning
 *     text tells the run to use it that way. No stock has ever been promoted.
 *   - conviction and variant_view said STRONG/HIGH "require" a variant view;
 *     since DAV-316 a top tier without one is stored as MEDIUM, not refused.
 *   - scoring said a composite of 7 makes a buy eligible; the bar is the
 *     analyst's own minimum confidence (place_trade).
 *   - invalidation_conditions said the daily run judged signals with them;
 *     the signal pipeline was deleted 2026-09-15.
 * The behaviour each one describes is tested where it lives
 * (thesis-transitions.sold-review, record-thesis.conviction-replay); this
 * keeps the words from drifting back.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { createResearchTools } from "@/lib/agent/tools";

function describe_(tool: string, field: string): string {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
  const js = zodSchema(all[tool].inputSchema as never).jsonSchema as { properties: Record<string, { description?: string }> };
  return js.properties[field]?.description ?? "";
}

describe("field descriptions agree with the save", () => {
  it("change_status: WATCHING puts a sold stock back on watch", () => {
    const d = describe_("update_thesis", "change_status");
    expect(d).toMatch(/put a stock you sold back on watch/);
    expect(d).not.toMatch(/PROMOTED → WATCHING only/);
  });

  it("a top tier without a variant view is stored as MEDIUM, not refused", () => {
    expect(describe_("update_thesis", "conviction")).toMatch(/stored as MEDIUM/);
    expect(describe_("update_thesis", "conviction")).not.toMatch(/require variant_view/);
    expect(describe_("record_thesis", "variant_view")).toMatch(/stored as MEDIUM/);
    expect(describe_("record_thesis", "variant_view")).not.toMatch(/REQUIRED when conviction/);
  });

  it("the buy bar is the analyst's minimum confidence, not a fixed 7", () => {
    for (const tool of ["update_thesis", "record_thesis"]) {
      const d = describe_(tool, "scoring");
      expect(d).toMatch(/minimum confidence/);
      expect(d).not.toMatch(/ADD\/ROTATE/);
    }
  });

  it("invalidation conditions name no signal pipeline", () => {
    expect(describe_("update_thesis", "invalidation_conditions")).not.toMatch(/signal/);
  });
});
