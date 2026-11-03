/**
 * run-thesis-writer.source-markers.replay.test.ts — Visa, 2026-09-29.
 *
 * The writer tags every claim in its note with where it came from
 * ("[STRUCTURED: MarketCap]"). Its snapshot paragraph used to be saved with
 * the tags still in it, and as a new thesis's first Activity line printed
 * them mid-sentence (18 of 30 in the 30 days to 2026-10-05). Since
 * 2026-11-03 the writer writes a company line instead of a snapshot: it is
 * saved as a plain column without the tags, and the first Activity line is
 * the writer's own decision note. Visa's tagged sentences are the case.
 */
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

/** The company section of the writer's note on Visa, 2026-09-29, with the tags the model wrote. */
const VISA_COMPANY = "Visa Inc. ($V) is a $687B-market-cap electronic payments network operating what is effectively a global infrastructure duopoly alongside Mastercard. [STRUCTURED: MarketCap] Revenue is a fee on payments volume, cross-border volume and processed transactions; Q3 FY2026 net revenue hit $11.6 billion, up 14%. [STRUCTURED: Revenue]";
const RATIONALE = "Passing on Visa for now; the save under test is the note.";

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
      { direction: "PASS", rationale: RATIONALE, invalidation_conditions: ["A guidance cut."] } as never,
      sectionArgsFrom(parseIntoSections(`## Company\n${VISA_COMPANY}`)),
      null,
    ).toolArgs;
  });
  return args;
}

describe("Visa, 2026-09-29: the writer's company line is saved without its source tags", () => {
  it("the line loses the tags and keeps every sentence", async () => {
    const args = await writerSaveArgs();
    const company = args.company as string;
    expect(company).not.toMatch(/\[(STRUCTURED|WEB):/);
    expect(company).toContain("duopoly alongside Mastercard. Revenue is a fee on payments volume");
    expect(company.endsWith("up 14%.")).toBe(true);
  }, LOAD_MS);

  it("the new thesis's first Activity line is the writer's note, and the row carries the company line", async () => {
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
    expect(created?.rationale).toBe(RATIONALE);
    const row = (db.store.thesis as Array<{ company?: string | null }>)[0];
    expect(row.company).toBe(args.company);
    expect(row.company).not.toMatch(/\[(STRUCTURED|WEB):/);
  }, LOAD_MS);
});
