/**
 * update-thesis-doors.test.ts — a refusal names only tools the door has.
 *
 * update_thesis sends a flip to record_thesis only in the doors whose agent
 * has it. The list it reads is DOORS_WITH_RECORD_THESIS; this checks it
 * against every allowlist in lib/agent/modes.ts that carries update_thesis.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { MODES } from "@/lib/agent/modes";
import { DOORS_WITH_RECORD_THESIS } from "./update-thesis";

const RUN_MODE: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", principal: "PRINCIPAL_CHAT" };

it("the doors that name record_thesis are the ones whose allowlist has it", () => {
  const withUpdate = Object.entries(MODES).filter(([, m]) => (m.toolAllowlist as readonly string[]).includes("update_thesis")).map(([k]) => k);
  expect(withUpdate.sort()).toEqual(Object.keys(RUN_MODE).sort());
  for (const [mode, runMode] of Object.entries(RUN_MODE)) {
    const tools = MODES[mode as keyof typeof MODES].toolAllowlist as readonly string[];
    expect(DOORS_WITH_RECORD_THESIS.has(runMode)).toBe(tools.includes("record_thesis"));
  }
});
