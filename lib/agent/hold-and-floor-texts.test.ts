/**
 * hold-and-floor-texts.test.ts — what the trigger run and edit_triggers say
 * about a stock we hold matches what the save does.
 *
 * - The trigger run was told to retire a dead thesis with change_status
 *   INVALIDATED. On a stock we hold the save refuses it ("Call close_position
 *   first"); CEG and MU hit that 6 and 4 times on 2026-10-08.
 * - edit_triggers (update_thesis's trigger edits until 2026-11-18) says only
 *   the principal moves a safety line down, with no exception: the save
 *   refuses every agent's lowering on a stock we hold.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { situationText } from "@/lib/agent/situation-skills";
import { MODES } from "@/lib/agent/modes";
import { editTriggers } from "@/lib/agent/tools/edit-triggers";

const HELD = "A stock we hold is sold first with sell, which retires the thesis itself.";
const tool = (runMode: string) => editTriggers({ runId: "r", userId: "u", accountId: "a", runMode } as never) as unknown as { description: string };

it("the trigger run stops watching a stock we watch (the owner's call, 2026-11-19), and sells a stock we hold", () => {
  const prompt = SAMPLE_PROMPTS.tactical();
  expect(prompt.replace(/\s+/g, " ")).toContain("on a stock we watch, stop watching it (`stop_watching`), and its reason is your note.");
  expect(prompt).not.toMatch(/change_status|INVALIDATED|ARCHIVED/);
  expect(prompt.replace(/\s+/g, " ")).toContain(HELD);
  // It can end a watch and can't reopen one; the morning run has both.
  expect(MODES.tactical.toolAllowlist as readonly string[]).toContain("stop_watching");
  expect(MODES.tactical.toolAllowlist as readonly string[]).not.toContain("watch_again");
  for (const t of ["stop_watching", "watch_again"]) expect(MODES["research-run"].toolAllowlist as readonly string[]).toContain(t);
});

it("edit_triggers says only the principal moves a safety line down, with no exception", () => {
  for (const runMode of ["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT", "PORTFOLIO_MANAGER"]) {
    expect(tool(runMode).description).toContain(
      "On a stock we hold, only the principal moves a safety line down. If you think one is wrong, keep it and give the number you'd suggest in your note.",
    );
  }
  expect(situationText("PROTECTIVE_SALE", true)).not.toMatch(/come down|re-draw/);
});

it("the review, which reaches stocks we hold in both runs, ends only a watch: a holding whose case broke is a proposed sale", () => {
  expect(situationText("REVIEW_DUE", false)).toContain("The case no longer holds: stop watching.");
  expect(situationText("REVIEW_DUE", true)).not.toContain("stop watching");
  expect(situationText("REVIEW_DUE", true)).toContain("A line proved the case wrong: propose the sale.");
});

