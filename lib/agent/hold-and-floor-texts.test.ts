/**
 * hold-and-floor-texts.test.ts — what the trigger run and update_thesis say
 * about a stock we hold matches what the save does.
 *
 * - The trigger run was told to retire a dead thesis with change_status
 *   INVALIDATED. On a stock we hold the save refuses it ("Call close_position
 *   first"); CEG and MU hit that 6 and 4 times on 2026-10-08.
 * - update_thesis said only the principal moves a safety line down. After the
 *   principal declines a sale, while the price is still past the line, the
 *   save lets the floor come down at most REPLAN_FLOOR_MAX_DROP_PCT, and the
 *   PROTECTIVE_SALE text says so.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import type { z } from "zod";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { REPLAN_FLOOR_MAX_DROP_PCT } from "@/lib/agent/declined-sale";
import { SITUATIONS } from "@/lib/agent/situations";
import { updateThesis } from "@/lib/agent/tools/update-thesis";

const HELD = "A stock we hold is sold first with close_position, which retires the thesis itself.";
const tool = (runMode: string) =>
  updateThesis({ runId: "r", userId: "u", accountId: "a", runMode } as never) as unknown as { description: string; inputSchema: z.ZodTypeAny };
const statusText = (runMode: string) =>
  (zodSchema(tool(runMode).inputSchema as never).jsonSchema as { properties: { change_status: { description: string } } }).properties.change_status.description;

it("the trigger run retires nothing: it takes a watched stock's plan down by id, and sells a stock we hold", () => {
  const prompt = SAMPLE_PROMPTS.tactical();
  expect(prompt.replace(/\s+/g, " ")).toContain("on a stock we watch take its buy, floor and target down by id (remove_trigger_ids)");
  expect(prompt).not.toMatch(/change_status|INVALIDATED|ARCHIVED/);
  expect(prompt.replace(/\s+/g, " ")).toContain(HELD);
  // Its save has no change_status; the other runs' still take all three values.
  expect((zodSchema(tool("INTRADAY_TACTICAL").inputSchema as never).jsonSchema as { properties: object }).properties).not.toHaveProperty("change_status");
  expect(statusText("MORNING_PLAN")).toContain("WATCHING = put a stock you sold back on watch");
});

it("update_thesis names the declined-sale exception, at the save's own number", () => {
  for (const runMode of ["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT", "THESIS_WRITER"]) {
    expect(tool(runMode).description).toContain(
      `only the principal moves a safety line down, except that after the principal declines its sale, while the price is still past it, it may come down at most ${REPLAN_FLOOR_MAX_DROP_PCT}%.`,
    );
  }
  expect(REPLAN_FLOOR_MAX_DROP_PCT).toBe(15);
});

it("REVIEW_DUE, which reaches stocks we hold in both runs, retires only a stock we watch", () => {
  expect(SITUATIONS.REVIEW_DUE.guidance).toContain(
    "- No longer applicable: change_status INVALIDATED on a stock we watch; a stock we hold is sold with close_position, which retires the thesis.",
  );
  expect(SITUATIONS.REVIEW_DUE.guidance.length).toBeLessThanOrEqual(2_200);
});

