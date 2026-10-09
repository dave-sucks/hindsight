/**
 * update-thesis-morning-run.test.ts — the morning run's save: update_thesis
 * with the morning door's eighteen fields, as #811 did for the trigger run.
 *
 * In the 30 days to 2026-10-08 the morning run made 285 saves; 224 carried
 * price_at_time, a copy of the price the row showed, and 25 rewrote the
 * writer's snapshot. Neither is a field here now, nor the scores or the
 * variant view. Since step 12, part 1, neither is the claim (core_belief,
 * key_assumptions, invalidation_conditions: the writer's and the owner's
 * chat's) nor direction, which had nowhere to land without the claim: a seed
 * goes to the writer (dispatch_thesis_research, wait_for_thesis_refresh),
 * which commits the view.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { statSync } from "fs";
import { zodSchema } from "ai";
import type { z } from "zod";
import { SITUATIONS } from "@/lib/agent/situations";
import { updateThesis } from "./update-thesis";

const DOOR = [
  "add_triggers", "catalyst_date", "change_status", "conviction", "conviction_rationale", "edit_triggers",
  "entry_on_close", "entry_price", "horizon", "rationale", "remove_trigger_ids",
  "setup_id", "stop_basis", "stop_loss", "target_basis", "target_price", "thesis_id", "trigger_id",
];
const ctx = (runMode: string) => ({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode }) as never;
const schemaOf = (runMode: string) => (updateThesis(ctx(runMode)) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
const enumOf = (runMode: string) => (zodSchema(schemaOf(runMode) as never).jsonSchema as { properties: Record<string, { enum?: string[] }> }).properties.change_status.enum;

describe("the morning run's save", () => {
  it("offers exactly eighteen fields, change_status with its three values", () => {
    expect(Object.keys(schemaOf("MORNING_PLAN").shape).sort()).toEqual(DOOR);
    expect(DOOR).toHaveLength(18);
    expect(enumOf("MORNING_PLAN")).toEqual(["INVALIDATED", "ARCHIVED", "WATCHING"]);
    for (const dropped of ["price_at_time", "snapshot", "scoring", "variant_view", "core_belief", "key_assumptions", "invalidation_conditions", "direction"]) expect(DOOR).not.toContain(dropped);
  });

  it("leaves the other doors' saves as they were", () => {
    expect(Object.keys(schemaOf("INTRADAY_TACTICAL").shape)).toHaveLength(11);
    expect(Object.keys(schemaOf("INTRADAY_TACTICAL").shape)).not.toContain("change_status");
    const chat = Object.keys(schemaOf("PRINCIPAL_CHAT").shape);
    expect(chat).toHaveLength(25);
    expect(chat).toEqual(expect.arrayContaining(["price_at_time", "snapshot", "scoring", "variant_view"]));
    expect(Object.keys(schemaOf("THESIS_WRITER").shape)).toHaveLength(35);
    expect(Object.keys(schemaOf("DISCOVERY").shape)).toHaveLength(26);
  });

  it("FIRST_RESEARCH and a woken watch send the claim through the writer, and name no field this save lacks", () => {
    for (const code of ["FIRST_RESEARCH", "QUIET_WATCH_WOKE"] as const) {
      const text = SITUATIONS[code].guidance;
      for (const tool of ["dispatch_thesis_research", "wait_for_thesis_refresh", 'mode "refresh"', "existing_thesis_id"]) expect([code, tool, text.includes(tool)]).toEqual([code, tool, true]);
      for (const f of ["core_belief", "key_assumptions", "invalidation_conditions", "direction LONG"]) expect([code, f, text.includes(f)]).toEqual([code, f, false]);
      expect(text.length).toBeLessThanOrEqual(2200);
    }
  });

  it("the saved calls stay under the cap", () => {
    expect(statSync("lib/agent/__fixtures__/morning-save-2026-10.json").size).toBeLessThan(40 * 1024);
  });
});
