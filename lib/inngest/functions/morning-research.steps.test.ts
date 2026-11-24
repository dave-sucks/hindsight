/**
 * The morning run's step cap is the mode's number (lib/agent/modes.ts), not one of its own.
 * Production, 2026-10-30: the Secular Compounder's run was cut off at 30 steps, with its second
 * complete_run refused and FTNT still owed; the mode said 65. Of 48 morning runs in the 30 days
 * to 2026-11-15 that was the only one at the cap, the others ending at 6 to 22.
 */
import { readFileSync } from "fs";

const source = readFileSync("lib/inngest/functions/morning-research.ts", "utf8");

describe("morning-research's step caps", () => {
  it("the main loop and the zero-tool-call recovery both stop at the mode's maxSteps", () => {
    expect(source.match(/stepCountIs\(MODES\["research-run"\]\.maxSteps\)/g)).toHaveLength(2);
  });

  it("no other loop in the file carries a literal 30 or 65 of its own", () => {
    expect(source).not.toMatch(/stepCountIs\((30|65)\)/);
  });
});
