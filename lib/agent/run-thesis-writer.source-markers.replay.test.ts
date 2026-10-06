/**
 * run-thesis-writer.source-markers.replay.test.ts — Visa, 2026-09-29.
 *
 * The writer tags every claim in its note with where it came from
 * ("[STRUCTURED: MarketCap]") so the save can collect the citations. The
 * snapshot paragraph was saved with the tags still in it, and on a new
 * thesis that paragraph is the first Activity line: 18 of them in the 30
 * days to 2026-10-05 printed the tags mid-sentence. The save now drops them
 * from the paragraph; the citations are kept in their own list. Fails on
 * main, where the CREATED row carries the tags.
 */
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

/** The snapshot paragraph of the writer's note on Visa, 2026-09-29, as written. */
const VISA_SNAPSHOT = "Visa Inc. ($V) is a $687B-market-cap electronic payments network operating what is effectively a global infrastructure duopoly alongside Mastercard. [STRUCTURED: MarketCap] The stock closed at $367.74 on September 28, sitting 4.6% below its 52-week high of $385.57 and essentially pinned at its rising 50-day moving average of $368.18 — a textbook COMPOUNDER_ACCUMULATION pullback-to-the-50 setup. [STRUCTURED: Price, 50-day, 52w high, PCT_FROM_52W_HIGH] The business itself is conspicuously healthy: Q3 FY2026 net revenue hit $11.6 billion, a 14% increase over the prior year, driven by growth in payments volume, cross-border volume, and processed transactions. Visa sits in fiscal Q4 FY2026 today (the quarter ends September 30, 2026), meaning a full-year earnings release is expected in late October 2026. [STRUCTURED: FY end Sep 30] The chart is basing — 61 sessions, 10.7% deep, last 10 sessions tightening to 4.4% — with the pivot at $385.57. [STRUCTURED: Base]";

/** Each test loads the writer fresh; under a full parallel run that can pass jest's 5 s default. */
const LOAD_MS = 30_000;

async function writerSaveArgs(): Promise<Record<string, unknown>> {
  let args: Record<string, unknown> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { buildWriterSaveCall, sectionArgsFrom } = await import("@/lib/agent/run-thesis-writer");
    const { parseIntoSections } = await import("@/lib/agent/thesis-research/parse-sections");
    args = buildWriterSaveCall(
      { childRunId: "run_v", analystId: REPLAY_ANALYST_ID, ticker: "V", mode: "mint", reason: "Watchlist research" },
      null,
      { direction: "PASS", rationale: "Passing on Visa for now; the save under test is the note.", invalidation_conditions: ["A guidance cut."] } as never,
      sectionArgsFrom(parseIntoSections(`## Snapshot\n${VISA_SNAPSHOT}`)),
      null,
    ).toolArgs;
  });
  return args;
}

describe("Visa, 2026-09-29: the writer's first note is saved without its source tags", () => {
  it("the paragraph loses the tags and keeps every citation", async () => {
    const args = await writerSaveArgs();
    const snapshot = args.snapshot as { text: string; citations: unknown[] };
    expect(snapshot.text).not.toMatch(/\[(STRUCTURED|WEB):/);
    expect(snapshot.text).toContain("duopoly alongside Mastercard. The stock closed at $367.74 on September 28");
    expect(snapshot.citations).toHaveLength(4);
  }, LOAD_MS);

  it("the new thesis's first Activity line reads without them", async () => {
    const args = await writerSaveArgs();
    const { refused, refusal, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({})], account: [accountRow()] },
      ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
      args,
      quotes: { V: 367.74 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const created = (db.store.thesisUpdate as Array<{ type: string; rationale: string }>).find((u) => u.type === "CREATED");
    expect(created?.rationale).toBe((args.snapshot as { text: string }).text);
    expect(created?.rationale).not.toMatch(/\[(STRUCTURED|WEB):/);
  }, LOAD_MS);
});
