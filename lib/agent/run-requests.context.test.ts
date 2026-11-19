/**
 * A run's Context panel lists a request as the agent is made: Instructions
 * is its one document, each file it imports marked where it starts; every
 * fact is Context, each with where it was sent.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { WRITER } from "@/lib/agent/engine/agents/writer";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";

const NOW = new Date("2026-11-18T15:00:00Z");

it("the Writer: one instructions row, its imports marked, then every fact under Context with where it was sent", () => {
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
  const rows = viewOfRecord(record).categories.map((c) => [c.group, c.name, c.sentIn ?? ""]);
  expect(rows).toEqual([
    ["Instructions", "Its instructions (writer.md)", ""],
    ["Context", "The analyst", "instructions"],
    ["Context", "The playbooks", "instructions"],
    ["Context", "The date and account", "first message"],
    ["Message", "The message", ""],
    ["Context", "Market numbers", "first message"],
    ["Context", "The stock's data", "first message"],
  ]);
  // Its one document, each import marked where it starts: the rules, the research rules, then its own words.
  const doc = viewOfRecord(record).categories[0];
  expect(doc.sections.map((s) => s.label)).toEqual(["@rules.md", "writer.md", "@research-rules.md", "writer.md"]);
  expect(doc.sections[2].text).toContain("## Date awareness");
});
