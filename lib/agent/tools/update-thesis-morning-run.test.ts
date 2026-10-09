/**
 * update-thesis-morning-run.test.ts — the morning run's save: update_thesis
 * with the morning door's twenty-two fields, as #811 did for the trigger run.
 *
 * In the 30 days to 2026-10-08 the morning run made 285 saves; 224 carried
 * price_at_time, a copy of the price the row showed, and 25 rewrote the
 * writer's snapshot. Neither is a field here now, nor the scores or the
 * variant view.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { statSync } from "fs";
import { zodSchema } from "ai";
import type { z } from "zod";
import { SITUATIONS } from "@/lib/agent/situations";
import { updateThesis } from "./update-thesis";

const DOOR = [
  "add_triggers", "catalyst_date", "change_status", "conviction", "conviction_rationale", "core_belief", "direction", "edit_triggers",
  "entry_on_close", "entry_price", "horizon", "invalidation_conditions", "key_assumptions", "rationale", "remove_trigger_ids",
  "setup_id", "stop_basis", "stop_loss", "target_basis", "target_price", "thesis_id", "trigger_id",
];
const ctx = (runMode: string) => ({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode }) as never;
const schemaOf = (runMode: string) => (updateThesis(ctx(runMode)) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
const enumOf = (runMode: string) => (zodSchema(schemaOf(runMode) as never).jsonSchema as { properties: Record<string, { enum?: string[] }> }).properties.change_status.enum;

describe("the morning run's save", () => {
  it("offers exactly twenty-two fields, change_status with its three values", () => {
    expect(Object.keys(schemaOf("MORNING_PLAN").shape).sort()).toEqual(DOOR);
    expect(enumOf("MORNING_PLAN")).toEqual(["INVALIDATED", "ARCHIVED", "WATCHING"]);
    for (const dropped of ["price_at_time", "snapshot", "scoring", "variant_view"]) expect(DOOR).not.toContain(dropped);
  });

  it("leaves the other doors' saves as they were", () => {
    expect(Object.keys(schemaOf("INTRADAY_TACTICAL").shape)).toHaveLength(12);
    expect(enumOf("INTRADAY_TACTICAL")).toEqual(["INVALIDATED", "ARCHIVED"]);
    const chat = Object.keys(schemaOf("PRINCIPAL_CHAT").shape);
    expect(chat).toHaveLength(25);
    expect(chat).toEqual(expect.arrayContaining(["price_at_time", "snapshot", "scoring", "variant_view"]));
    expect(Object.keys(schemaOf("THESIS_WRITER").shape)).toHaveLength(35);
    expect(Object.keys(schemaOf("DISCOVERY").shape)).toHaveLength(26);
  });

  it("FIRST_RESEARCH's commitment names every field the seed gate requires", () => {
    const line = SITUATIONS.FIRST_RESEARCH.guidance.split("\n").find((l) => l.startsWith("- Commit a view"))!;
    for (const f of ["direction", "horizon", "entry_price", "target_price", "stop_loss", "core_belief", "key_assumptions", "invalidation_conditions", "conviction", "conviction_rationale"]) expect([f, line.includes(f)]).toEqual([f, true]);
    expect(SITUATIONS.FIRST_RESEARCH.guidance.length).toBeLessThanOrEqual(2200);
  });

  it("the saved calls stay under the cap", () => {
    expect(statSync("lib/agent/__fixtures__/morning-save-2026-10.json").size).toBeLessThan(40 * 1024);
  });
});
