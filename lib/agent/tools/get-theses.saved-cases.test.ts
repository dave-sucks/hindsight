/**
 * get-theses.saved-cases.test.ts — the saved cases carry the facts (step 8,
 * the first pull request), and the builder reads a recorded row the way it
 * reads the live one: the short row from the facts, the full row by rule,
 * the guidance from the rows' situations. Two recorded morning reads, through the real
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

const SHORT_KEYS = ["stock", "id", "situations", "said", "position", "proposal_waiting", "price", "plan", "plan_checks", "protection", "floor_risk", "triggers", "belief", "assumptions", "would_prove_it_wrong", "setup", "nameTheSetup", "buyBlockedByFull", "heldThroughFloor", "supersededBy", "snapshot", "score", "chart", "research", "catalyst", "repeat", "note", "paper_record"];
const FULL_ONLY = ["score_notes", "bull_case", "bear_case", "conviction_rationale", "variant_view", "history"];

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

  it("replays each row at the size its situations call for, with the guidance read off them", () => {
    for (const read of reads) {
      const model = forModel(read);
      const rows = model.theses as Row[];
      for (const [i, row] of rows.entries()) {
        const recorded = read.output.data.theses[i];
        const keys = Object.keys(row);
        expect(keys[0]).toBe("stock");
        const full = (recorded.situations as string[]).some((c) => c === "QUIET_WATCH_WOKE" || c === "NO_SETUP_NAMED");
        for (const k of keys) expect([...SHORT_KEYS, ...(full ? FULL_ONLY : [])]).toContain(k);
        if (!full) for (const k of FULL_ONLY) expect(row).not.toHaveProperty(k);
        // The raw facts never reach the model; three of their names are now lines of words.
        for (const k of ["proposals", "inheritedTriggers"]) expect(row).not.toHaveProperty(k);
        for (const k of ["position", "price", "chart"]) if (k in row) expect(typeof row[k]).toBe("string");
        expect(JSON.stringify(row)).not.toMatch(/\[(STRUCTURED|WEB)/);
        // The short row is smaller than the row the model used to read.
        if (!full) expect(JSON.stringify(row).length).toBeLessThan(JSON.stringify(recorded).length);
      }
      for (const line of (model.quiet_theses as string[]) ?? []) expect(line).toMatch(/^[A-Z.]+ · (held|watch|promoted) · /);
      const codes = new Set(read.output.data.theses.flatMap((r) => r.situations as string[]));
      expect(Object.keys(model.guidance as Record<string, string>).every((c) => codes.has(c))).toBe(true);
      if (codes.size > 0) expect(Object.keys(model.guidance as Record<string, string>).length).toBeGreaterThan(0);
    }
  });
});

describe("PBH on 09-23, read through the builder", () => {
  it("its only rules are the account's four, and none carries an id, so nothing on its row names a rule that is not the stock's", () => {
    const read = recordedReads("pbh-two-flags")[0];
    const recorded = read.output.data.theses.find((r) => r.ticker === "PBH")!;
    expect(recorded.triggers).toEqual([]);
    const inherited = recorded.inheritedTriggers as Array<{ id: string; level: string; lastFiredAt?: string }>;
    expect(inherited.map((t) => t.level)).toEqual(["ACCOUNT", "ACCOUNT", "ACCOUNT", "ACCOUNT"]);
    expect(inherited.every((t) => !t.lastFiredAt)).toBe(true);
    const row = (forModel(read).theses as Row[]).find((r) => String(r.stock).startsWith("PBH ·"))!;
    const lines = row.triggers as string[];
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toMatch(/· inherited$/);
      expect(line).not.toContain("[id");
    }
    for (const t of inherited) expect(JSON.stringify(row)).not.toContain(t.id);
  });
});
