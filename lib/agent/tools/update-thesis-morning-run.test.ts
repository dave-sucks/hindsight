/**
 * update-thesis-morning-run.test.ts — the morning run's save: since
 * 2026-11-18 six tools, one job each (the note and the review's three, the
 * trigger edits, the conviction, the catalyst date, and the two status tools).
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
import { SITUATIONS } from "@/lib/agent/situations";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";

/** The morning run's thesis tools, one job each since 2026-11-18, and the fields each shows the model. */
const DOORS: Record<string, string[]> = {
  write_note: ["answers_update_id", "note", "thesis_id", "trigger_id", "verdict", "verdict_line"],
  edit_triggers: ["add", "edit", "remove", "setup_id", "thesis_id"],
  set_conviction: ["conviction", "conviction_rationale", "thesis_id"],
  set_catalyst_date: ["catalyst_date", "thesis_id"],
  stop_watching: ["reason", "thesis_id"],
  watch_again: ["thesis_id"],
};
const fieldsOf = (t: string) => {
  const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode: "MORNING_PLAN", runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
  return Object.keys((zodSchema(all[t].inputSchema as never).jsonSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort();
};

describe("the morning run's save", () => {
  it("is six tools, one job each, with exactly their fields; none takes the price, the write-up, the claim, a direction or the horizon", () => {
    const allow = MODES["research-run"].toolAllowlist as readonly string[];
    for (const [t, fields] of Object.entries(DOORS)) {
      expect([t, allow.includes(t)]).toEqual([t, true]);
      expect([t, fieldsOf(t)]).toEqual([t, fields]);
    }
    expect(allow).not.toContain("update_thesis");
    const all = Object.values(DOORS).flat();
    for (const dropped of ["price_at_time", "snapshot", "variant_view", "core_belief", "key_assumptions", "invalidation_conditions", "direction", "horizon", "change_status"]) expect(all).not.toContain(dropped);
  });

  it("a review on a watch with no view sends the claim through the writer, and names no field this save lacks", () => {
    const text = SITUATIONS.REVIEW_DUE.guidance;
    for (const tool of ["dispatch_thesis_research", "wait_for_thesis_refresh"]) expect([tool, text.includes(tool)]).toEqual([tool, true]);
    // The send takes the stock: code finds the thesis by it.
    for (const field of ['mode "refresh"', "existing_thesis_id"]) expect([field, text.includes(field)]).toEqual([field, false]);
    for (const f of ["core_belief", "key_assumptions", "invalidation_conditions", "direction LONG"]) expect([f, text.includes(f)]).toEqual([f, false]);
  });

  it("the saved calls stay under the cap", () => {
    expect(statSync("lib/agent/__fixtures__/morning-save-2026-10.json").size).toBeLessThan(40 * 1024);
  });
});
