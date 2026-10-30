/**
 * trigger-notes.replay.test.ts — a rule's note reaches an agent only when a
 * person or an analyst wrote it (lib/agent/triggers/note.ts, `writtenNote`).
 *
 * CEG, Secular Compounder, from its stored rows, read through get_theses:
 *  - 09-30 (ceg-floor-too-far-2026-09-30.json): every note on the row was
 *    code's. Its own rules carried template notes ("Hard stop at $248. If we
 *    hit it the thesis is broken…", "Look at this every 30 days, counting from
 *    the last real review."), and two of the analyst's rules had fired, so the
 *    row quoted "Gave back 15% from the high. This is a question, not a
 *    sale: …" and "Below the 200-day — the long trend is in question…" as if
 *    someone had written them.
 *  - 10-08 (close-out-restated-2026-10-08.json): the analyst had written the
 *    floor's and the target's notes; those still travel, word for word.
 */
import floorRaw from "@/lib/agent/__fixtures__/ceg-floor-too-far-2026-09-30.json";
import closeOutRaw from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, REPLAY_USER_ID } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Row = Record<string, unknown>;
const fl = floorRaw as unknown as {
  thesisBefore: Row & { triggers: Trigger[]; createdAt: string; lastReviewedAt: string; researchUpdatedAt: string | null };
  position: Row & { openedAt: string; peakAt: string };
  analyst: { name: string; setupIds: string[]; triggers: Trigger[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  snapshot: { asOf: string; snapshot: Row };
  equity: Record<string, number>;
  price0930: { at: string; price: number };
};
const co = (closeOutRaw as unknown as { CEG: { thesis: Row & { triggers: Trigger[] }; position: { avgCost: number; quantity: number }; price: number } }).CEG;

const onAnalyst = { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: fl.analyst.name, setupIds: fl.analyst.setupIds, enabled: true } };

/** What code wrote on CEG's rules, by phrase: none of it may reach an agent. */
const TEMPLATE_PHRASES = [
  "This is a question, not a sale",
  "the long trend is in question",
  "Hard stop at",
  "something material happened",
  "counting from the last real review",
  "decide here: take it",
  "business checkpoint",
  "DAV-279",
  "standing rule set by the principal",
];

const ARGS = { tickers: ["CEG"] };

/** CEG's rule lines as the model reads them, from a get_theses read of CEG at `at`. */
async function triggerLines(thesis: Row, position: Row, at: string, price: number): Promise<string[]> {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        agentConfig: [agentConfigRow({ name: fl.analyst.name, setupIds: fl.analyst.setupIds, triggers: fl.analyst.triggers, enabled: true })],
        account: [accountRow({ triggers: fl.account.triggers, triggersSeededAt: new Date(fl.account.triggersSeededAt) })],
        tickerIndicators: [{ id: "ceg_snap", ticker: "CEG", asOf: fl.snapshot.asOf, snapshot: fl.snapshot.snapshot, computedAt: new Date("2026-09-29T10:30:00Z") }],
        thesis: [thesisRow({ ...thesis, ticker: "CEG", researchRun: onAnalyst })],
        position: [positionRow({ ...position, symbol: "CEG", analystId: REPLAY_ANALYST_ID, environment: "LIVE" })],
        thesisUpdate: [],
      } as never,
      args: ARGS,
      ctx: { runEnvironment: "LIVE", runMode: "MORNING_PLAN" },
      quotes: { CEG: price },
      equity: fl.equity["2026-09-29"],
    });
    // What the model reads: the tool's own toModelOutput over its result, imported in its own module scope so the next replay loads the tool fresh.
    let rows: Row[] = [];
    await jest.isolateModulesAsync(async () => {
      const mod = (await import("@/lib/agent/tools/get-theses")) as unknown as { getTheses: (ctx: unknown) => { toModelOutput: (o: unknown) => { value: { data: { theses: Row[] } } } } };
      rows = mod.getTheses({ runId: "r", userId: REPLAY_USER_ID, analystId: REPLAY_ANALYST_ID, runMode: "MORNING_PLAN" }).toModelOutput({ toolCallId: "c1", input: ARGS, output: result }).value.data.theses;
    });
    return (rows.find((r) => String(r.stock ?? "").startsWith("CEG ·"))?.triggers as string[] | undefined) ?? [];
  } finally {
    jest.useRealTimers();
  }
}

describe("the fixtures are the production rows", () => {
  it("09-30: no note on CEG's rules was written by an analyst; two of the analyst's rules had fired on CEG", () => {
    expect([...fl.thesisBefore.triggers, ...fl.analyst.triggers].some((t) => t.source === "AGENT")).toBe(false);
    expect(Object.keys(fl.thesisBefore.triggerState as Row)).toEqual(expect.arrayContaining(["06506e39-522f-4ad1-aa62-d7fe10bf7003", "cf39ff35-5a15-43d4-a0f1-911cb5fd519b"]));
  });
});

describe("CEG's 09-30 morning read, through get_theses", () => {
  it("every rule keeps its sentence and id, and no note code wrote is quoted", async () => {
    const lines = await triggerLines(
      {
        ...fl.thesisBefore,
        createdAt: new Date(fl.thesisBefore.createdAt),
        lastReviewedAt: new Date(fl.thesisBefore.lastReviewedAt),
        researchUpdatedAt: fl.thesisBefore.researchUpdatedAt ? new Date(fl.thesisBefore.researchUpdatedAt) : null,
      },
      { ...fl.position, openedAt: new Date(fl.position.openedAt), peakAt: new Date(fl.position.peakAt) },
      fl.price0930.at,
      fl.price0930.price,
    );
    const text = lines.join("\n");
    for (const phrase of TEMPLATE_PHRASES) expect(text).not.toContain(phrase);
    expect(text).not.toContain('"');
    // CEG's own five rules, each with its id; the two analyst rules that fired, with theirs.
    for (const t of fl.thesisBefore.triggers) expect(text).toContain(`[id ${t.id}]`);
    expect(lines.find((l) => l.includes("[id 06506e39-522f-4ad1-aa62-d7fe10bf7003]"))).toMatch(/^.+ · inherited · fired 09-28 11:20 ET \[id /);
    expect(lines.find((l) => l.includes("[id cf39ff35-5a15-43d4-a0f1-911cb5fd519b]"))).toMatch(/ · inherited · fired 09-25 09:45 ET \[id /);
  });
});

describe("CEG's 10-08 row, through get_theses", () => {
  it("the analyst's own notes on the floor and the target travel word for word; the template's do not", async () => {
    const lines = await triggerLines(co.thesis, { avgCost: co.position.avgCost, quantity: co.position.quantity }, "2026-10-08T18:00:00Z", co.price);
    const written = co.thesis.triggers.filter((t) => t.source === "AGENT");
    expect(written.map((t) => t.id)).toEqual(["cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e", "9dde5606-86b2-46c3-bed6-57cfd57ac942"]);
    for (const t of written) expect(lines.find((l) => l.includes(`[id ${t.id}]`))).toContain(`set by the agent · "${t.rationale}"`);
    const text = lines.join("\n");
    for (const phrase of TEMPLATE_PHRASES) expect(text).not.toContain(phrase);
    expect(lines.filter((l) => l.includes('"'))).toHaveLength(2);
  });
});
