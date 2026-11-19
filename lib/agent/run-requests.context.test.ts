/**
 * A run's Context panel lists a request as the agent is made: Instructions
 * holds its own document and the two rules files; every fact is Context, the
 * ones its record sends with the instructions too, marked so.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { WRITER } from "@/lib/agent/engine/agents/writer";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";

const NOW = new Date("2026-11-18T15:00:00Z");

it("the Writer: three instruction rows, then the analyst and the playbooks under Context, sent with the instructions", () => {
  const built = composeAgentRequest(WRITER, { now: NOW, environment: "PAPER", message: "## Why you were dispatched\nA re-scan." }, {
    pieces: [{ id: "market_numbers", text: "### Market numbers\nn" }],
    context: { the_analyst: "## Analyst: Case\n\nI buy growth.", playbooks: "YOUR PLAYBOOKS\np", the_stock: null, playbook_record: null, stock_data: "## GROUND-TRUTH DATA\nd" },
  });
  const record: RequestRecord = {
    v: 1,
    call: "Main",
    agent: "writer",
    source: "thesis-writer",
    model: "claude-sonnet-4-6",
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    requests: [{ system: [{ type: "text", text: built.instructions }], messages: [{ role: "user", content: built.message }] }],
    parts: built.parts,
  };
  const rows = viewOfRecord(record).categories.map((c) => [c.group, c.name, c.sentWith ?? ""]);
  expect(rows).toEqual([
    ["Instructions", "House rules", ""],
    ["Instructions", "How you write", ""],
    ["Instructions", "Its instructions (writer.md)", ""],
    ["Context", "The analyst", "instructions"],
    ["Context", "The playbooks", "instructions"],
    ["Context", "The date and account", ""],
    ["Message", "The message", ""],
    ["Context", "Market numbers", ""],
    ["Context", "The stock's data", ""],
  ]);
  // Its own document carries the research rules it imports.
  expect(viewOfRecord(record).categories[2].sections[0].text).toContain("## Date awareness");
});
