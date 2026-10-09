/**
 * update-thesis-doors.test.ts — what a save may change, by who is saving
 * (Roadmap step 12, part 1), and a refusal that names only tools the door has.
 *
 * The rule, as a table the test prints: the write-up (the eight research
 * sections and the raw data block) is the writer's; the claim (core_belief,
 * key_assumptions, invalidation_conditions) is the writer's and the owner's
 * chat's; everything else (the plan, the verdict, the note) is everyone's,
 * except the trigger run, whose save takes the plan and the note only. The
 * score, the variant view, the cited snapshot and the price the caller read
 * are the writer's and the chat's today. A field present gets filled: 224 of
 * 285 morning saves in 30 days sent price_at_time back, 25 rewrote the
 * writer's snapshot, and CORT's research sections were overwritten by a
 * morning run — so a door offers only what its caller may change.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import type { z } from "zod";
import { MODES } from "@/lib/agent/modes";
import { DOORS_WITH_RECORD_THESIS, updateThesis } from "./update-thesis";

const RUN_MODE: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", principal: "PRINCIPAL_CHAT" };

/** The four doors, in the order the table prints them. */
const DOORS = [
  ["writer", "THESIS_WRITER"],
  ["chat", "PRINCIPAL_CHAT"],
  ["morning run", "MORNING_PLAN"],
  ["trigger run", "INTRADAY_TACTICAL"],
] as const;

const fieldsOf = (runMode: string): string[] => {
  const tool = updateThesis({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode } as never) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> };
  return Object.keys(tool.inputSchema.shape).sort();
};

/** Every field update_thesis has, in its row of the rule. */
const ROWS: Record<string, string[]> = {
  "write-up": ["snapshot", "recent_catalysts", "fundamentals", "latest_earnings", "catalysts_and_events", "bull_case", "bear_case", "analyst_consensus", "insider_technical", "research_data", "scoring", "variant_view"],
  claim: ["core_belief", "key_assumptions", "invalidation_conditions"],
  plan: ["entry_price", "entry_on_close", "target_price", "target_basis", "stop_loss", "stop_basis", "setup_id", "horizon", "catalyst_date", "add_triggers", "edit_triggers", "remove_trigger_ids"],
  verdict: ["direction", "conviction", "conviction_rationale", "change_status"],
  note: ["thesis_id", "rationale", "trigger_id", "price_at_time"],
};
const EVERY_FIELD = Object.values(ROWS).flat().sort();

/** The eight sections and the data block: the writer only. */
const WRITER_ONLY = ["recent_catalysts", "fundamentals", "latest_earnings", "catalysts_and_events", "bull_case", "bear_case", "analyst_consensus", "insider_technical", "research_data"];
/** The writer's and the chat's: the claim, the view, the score, the variant view, the snapshot, the price the caller read. */
const WRITER_AND_CHAT = [...ROWS.claim, "direction", "scoring", "variant_view", "snapshot", "price_at_time"];

const EXPECTED: Record<(typeof DOORS)[number][1], string[]> = {
  THESIS_WRITER: EVERY_FIELD,
  PRINCIPAL_CHAT: EVERY_FIELD.filter((f) => !WRITER_ONLY.includes(f) && f !== "trigger_id"),
  MORNING_PLAN: [...ROWS.plan, "conviction", "conviction_rationale", "change_status", "thesis_id", "rationale", "trigger_id"].sort(),
  INTRADAY_TACTICAL: ["thesis_id", "trigger_id", "rationale", "add_triggers", "edit_triggers", "remove_trigger_ids", "stop_loss", "stop_basis", "target_price", "target_basis", "entry_price"].sort(),
};

describe("what a save may change, by who is saving", () => {
  const byDoor = Object.fromEntries(DOORS.map(([, runMode]) => [runMode, fieldsOf(runMode)])) as Record<string, string[]>;

  it("prints the table: every field, which door has it", () => {
    const head = `| field | row | ${DOORS.map(([name]) => name).join(" | ")} |`;
    const lines = [head, `|${"---|".repeat(DOORS.length + 2)}`];
    for (const [row, fields] of Object.entries(ROWS)) {
      for (const f of fields) lines.push(`| ${f} | ${row} | ${DOORS.map(([, m]) => (byDoor[m].includes(f) ? "yes" : "")).join(" | ")} |`);
    }
    lines.push(`| **fields** | | ${DOORS.map(([, m]) => byDoor[m].length).join(" | ")} |`);
    console.log(lines.join("\n"));
    expect(DOORS.map(([, m]) => byDoor[m].length)).toEqual([35, 25, 18, 11]);
  });

  it("every field of the tool is in one row of the rule", () => {
    expect(byDoor.THESIS_WRITER).toEqual(EVERY_FIELD);
  });

  it.each(DOORS)("%s: exactly its fields", (_name, runMode) => {
    expect(byDoor[runMode]).toEqual(EXPECTED[runMode]);
  });

  it("the write-up's eight sections and data block are the writer's only", () => {
    for (const f of WRITER_ONLY) expect([f, DOORS.filter(([, m]) => byDoor[m].includes(f)).map(([n]) => n)]).toEqual([f, ["writer"]]);
  });

  it("the claim, the view, the score, the variant view, the snapshot and the read price are the writer's and the chat's", () => {
    for (const f of WRITER_AND_CHAT) expect([f, DOORS.filter(([, m]) => byDoor[m].includes(f)).map(([n]) => n)]).toEqual([f, ["writer", "chat"]]);
  });

  it("the morning run's save carries no claim and no direction: a view is set or flipped by research or by the owner", () => {
    for (const f of [...ROWS.claim, "direction", ...WRITER_ONLY, "scoring", "variant_view", "snapshot", "price_at_time"]) expect([f, byDoor.MORNING_PLAN.includes(f)]).toEqual([f, false]);
  });

  it("the trigger run's save is the plan and the note: no verdict, no claim, no write-up, no price", () => {
    for (const f of [...ROWS.verdict, ...ROWS.claim, ...ROWS["write-up"], "price_at_time", "setup_id", "horizon", "catalyst_date", "entry_on_close"]) expect([f, byDoor.INTRADAY_TACTICAL.includes(f)]).toEqual([f, false]);
  });
});

it("the doors that name record_thesis are the ones whose allowlist has it", () => {
  const withUpdate = Object.entries(MODES).filter(([, m]) => (m.toolAllowlist as readonly string[]).includes("update_thesis")).map(([k]) => k);
  expect(withUpdate.sort()).toEqual(Object.keys(RUN_MODE).sort());
  for (const [mode, runMode] of Object.entries(RUN_MODE)) {
    const tools = MODES[mode as keyof typeof MODES].toolAllowlist as readonly string[];
    expect(DOORS_WITH_RECORD_THESIS.has(runMode)).toBe(tools.includes("record_thesis"));
  }
});
