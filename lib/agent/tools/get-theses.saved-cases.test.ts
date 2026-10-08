/**
 * get-theses.saved-cases.test.ts — the saved cases carry the facts (step 8,
 * the first pull request), and the builder reads a recorded row the way it
 * reads the live one: the facts stay off the model's read until the next
 * pull request sizes the row. Two recorded morning reads, through the real
 * model-output hook, with no database.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { readFileSync } from "fs";
import { getTheses, ROW_FACTS } from "@/lib/agent/tools/get-theses";

const CASES = ["pbh-two-flags", "mu-earnings-review"];

type Row = Record<string, unknown>;
interface Read { input: unknown; output: { data: { theses: Row[]; quiet_theses?: Row[]; guidance?: unknown } } }

/** Every recorded get_theses result in a case, with the call that made it. */
function recordedReads(name: string): Read[] {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${name}.json`, "utf8")) as { messages: Array<{ role: string; content: unknown }> };
  const inputs = new Map<string, unknown>();
  const out: Read[] = [];
  for (const m of c.messages) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; toolCallId: string; toolName?: string; input?: unknown; output?: { value?: Read["output"] } }>) {
      if (p.type === "tool-call") inputs.set(p.toolCallId, p.input);
      if (p.type === "tool-result" && p.toolName === "get_theses" && p.output?.value) out.push({ input: inputs.get(p.toolCallId), output: p.output.value });
    }
  }
  return out;
}

const tool = getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as unknown as {
  toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
};
const forModel = (read: Read) => tool.toModelOutput({ toolCallId: "c", input: read.input, output: read.output }).value.data;

describe.each(CASES)("the saved case %s", (name) => {
  const reads = recordedReads(name);

  it("has a recorded read whose every full row carries the facts and its situations, and no guidance text", () => {
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.output.data.theses.length).toBeGreaterThan(0);
      for (const row of read.output.data.theses) {
        for (const k of ROW_FACTS) expect(row).toHaveProperty(k);
        expect(Array.isArray(row.situations)).toBe(true);
        expect(row).not.toHaveProperty("guidance");
      }
      expect(read.output.data).not.toHaveProperty("guidance");
    }
  });

  it("replays the model's row without the facts, byte for byte as if they were never there", () => {
    for (const read of reads) {
      const model = forModel(read);
      for (const row of model.theses as Row[]) for (const k of ROW_FACTS) expect(row).not.toHaveProperty(k);
      const without = JSON.parse(JSON.stringify(read.output)) as Read["output"];
      for (const row of without.data.theses) for (const k of ROW_FACTS) delete row[k];
      expect(JSON.stringify(model)).toBe(JSON.stringify(forModel({ input: read.input, output: without })));
    }
  });
});
