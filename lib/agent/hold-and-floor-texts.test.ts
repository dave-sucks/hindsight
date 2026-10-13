/**
 * hold-and-floor-texts.test.ts — what the trigger run and update_thesis say
 * about a stock we hold matches what the save does.
 *
 * - The trigger run was told to retire a dead thesis with change_status
 *   INVALIDATED. On a stock we hold the save refuses it ("Call close_position
 *   first"); CEG and MU hit that 6 and 4 times on 2026-10-08.
 * - update_thesis says only the principal moves a safety line down, with no
 *   exception: the save refuses every agent's lowering on a stock we hold.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import type { z } from "zod";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
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

it("update_thesis says only the principal moves a safety line down, with no exception", () => {
  for (const runMode of ["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT", "THESIS_WRITER"]) {
    expect(tool(runMode).description).toContain(
      "On a stock we hold, only the principal moves a safety line down. If you think one is wrong, keep it and give the number you'd suggest in the rationale.",
    );
  }
  expect(SITUATIONS.PROTECTIVE_SALE.guidance).not.toMatch(/come down|re-draw/);
});

it("REVIEW_DUE, which reaches stocks we hold in both runs, retires only a stock we watch", () => {
  expect(SITUATIONS.REVIEW_DUE.guidance).toContain(
    "- No longer applicable: change_status INVALIDATED on a stock we watch; a stock we hold is sold with close_position, which retires the thesis.",
  );
  expect(SITUATIONS.REVIEW_DUE.guidance.length).toBeLessThanOrEqual(2_200);
});

