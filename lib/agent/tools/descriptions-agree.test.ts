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

type Prop = { description?: string; anyOf?: Prop[] } | undefined;

/** A field's words; a nullable field carries them on its non-null branch. */
function wordsOf(p: Prop): string {
  return p?.description ?? p?.anyOf?.find((m) => m?.description)?.description ?? "";
}

function describe_(tool: string, field: string): string {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
  const js = zodSchema(all[tool].inputSchema as never).jsonSchema as { properties: Record<string, Prop> };
  return wordsOf(js.properties[field]);
}

describe("field descriptions agree with the save", () => {
  it("change_status: WATCHING puts a sold stock back on watch", () => {
    const d = describe_("update_thesis", "change_status");
    expect(d).toMatch(/put a stock you sold back on watch/);
    expect(d).not.toMatch(/PROMOTED → WATCHING only/);
  });

  it("a top tier without a variant view is stored as MEDIUM, not refused (said once, on variant_view)", () => {
    for (const tool of ["update_thesis", "record_thesis"]) {
      expect(describe_(tool, "variant_view")).toMatch(/stored as MEDIUM/);
      expect(describe_(tool, "conviction")).not.toMatch(/require/i);
    }
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

/**
 * The thesis fields are defined once (thesis-fields.ts): every tool that takes
 * one shows the agent the same words, so a fix lands in all three.
 */
describe("the thesis fields, defined once", () => {
  it("record_thesis, update_thesis and the writer's submit_thesis say the same thing", async () => {
    const { makeSubmitThesisTool } = await import("@/lib/agent/run-thesis-writer");
    const submit = zodSchema(makeSubmitThesisTool({ ticker: "X" } as never).inputSchema as never).jsonSchema as { properties: Record<string, { description?: string }> };
    for (const field of ["core_belief", "key_assumptions", "invalidation_conditions", "conviction", "conviction_rationale", "variant_view", "stop_basis", "target_basis", "entry_on_close", "entry_price", "target_price", "stop_loss", "direction", "horizon"]) {
      const words = describe_("record_thesis", field);
      expect(words).not.toBe("");
      expect(describe_("update_thesis", field)).toBe(words);
      expect(wordsOf(submit.properties[field])).toBe(words);
    }
  });

  it("the same field under two names says the same thing", async () => {
    const { makeSubmitThesisTool } = await import("@/lib/agent/run-thesis-writer");
    const submit = zodSchema(makeSubmitThesisTool({ ticker: "X" } as never).inputSchema as never).jsonSchema as { properties: Record<string, Prop> };
    expect(describe_("update_thesis", "price_at_time")).toBe(describe_("record_thesis", "current_price"));
    expect(wordsOf(submit.properties.prior_exit_acknowledgment)).toBe(describe_("record_thesis", "acknowledge_prior_exit"));
  });

  it("update_thesis and the writer word the trigger edits the same", async () => {
    const { makeSubmitThesisTool } = await import("@/lib/agent/run-thesis-writer");
    const submit = zodSchema(makeSubmitThesisTool({ ticker: "X" } as never).inputSchema as never).jsonSchema as { properties: Record<string, Prop> };
    for (const field of ["add_triggers", "edit_triggers", "remove_trigger_ids"]) {
      expect(describe_("update_thesis", field)).not.toBe("");
      expect(wordsOf(submit.properties[field])).toBe(describe_("update_thesis", field));
    }
  });
});

/**
 * No tool an agent is sent names a tool that agent doesn't have (section 7 of
 * the plan). On 2026-10-06 fourteen did: update_thesis sent the morning and
 * trigger runs to record_thesis, place_trade named record_thesis as where a
 * thesis comes from, get_sec_filings pointed every agent at an insider tool
 * none of them has.
 */
describe("no tool names a tool its agent doesn't have", () => {
  const MODES_TO_RUN: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", discovery: "DISCOVERY", principal: "PRINCIPAL_CHAT" };
  for (const [mode, runMode] of Object.entries(MODES_TO_RUN)) {
    it(`${mode}`, async () => {
      const { MODES } = await import("@/lib/agent/modes");
      const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as Record<string, { description?: string; inputSchema: unknown }>;
      const allow = (MODES[mode as keyof typeof MODES] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? Object.keys(all);
      const missing: string[] = [];
      for (const name of allow.filter((n) => all[n])) {
        const text = (all[name].description ?? "") + JSON.stringify(zodSchema(all[name].inputSchema as never).jsonSchema);
        for (const other of Object.keys(all)) if (!allow.includes(other) && new RegExp(`\\b${other}\\b`).test(text)) missing.push(`${name} names ${other}`);
      }
      expect(missing).toEqual([]);
    });
  }
});

/**
 * A union goes out as anyOf, never oneOf. Rendered as oneOf, DOCU's trigger
 * run silently stopped writing triggers (0 of 8, no error, no refusal); the
 * same branches as anyOf wrote all eight. Read off the rendered definitions,
 * not the zod.
 */
describe("no oneOf in any tool an agent is sent", () => {
  const MODES_TO_RUN: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", discovery: "DISCOVERY", principal: "PRINCIPAL_CHAT" };
  for (const [mode, runMode] of Object.entries(MODES_TO_RUN)) {
    it(`${mode}`, async () => {
      const { MODES } = await import("@/lib/agent/modes");
      const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
      const allow = (MODES[mode as keyof typeof MODES] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? Object.keys(all);
      const withOneOf = allow.filter((n) => all[n] && JSON.stringify(zodSchema(all[n].inputSchema as never).jsonSchema).includes('"oneOf"'));
      expect(withOneOf).toEqual([]);
    });
  }
  it("thesis-writer (submit_thesis)", async () => {
    const { makeSubmitThesisTool } = await import("@/lib/agent/run-thesis-writer");
    expect(JSON.stringify(zodSchema(makeSubmitThesisTool({ ticker: "X" } as never).inputSchema as never).jsonSchema)).not.toContain('"oneOf"');
  });
});

