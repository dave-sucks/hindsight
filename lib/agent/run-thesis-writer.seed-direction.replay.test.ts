/**
 * run-thesis-writer.seed-direction.replay.test.ts — a seed gets its view from
 * the writer (step 12, part 1: the claim is the writer's).
 *
 * COGT, 2026-09-28 01:03 UTC (writer run cmukjnhy4000604l5up1m1661): the
 * chat dispatched a refresh on a seed, a stock on the watchlist with no view.
 * The writer's refresh never sent a direction ("it NEVER changes direction or
 * status"), so the save landed the belief, the plan and the score on a row
 * that stayed "no view": a LONG-shaped claim with direction null, a target
 * column with no buy or floor. The accepted submit_thesis decision, verbatim
 * from the run's saved thread, through the real save-call builder, the
 * save's own input schema (as the writer runs it) and the real save, on the
 * row as it stood before that save
 * (lib/agent/__fixtures__/cogt-seed-refresh-2026-09-28.json).
 */
import { statSync } from "fs";
import type { z } from "zod";
import fixture from "@/lib/agent/__fixtures__/cogt-seed-refresh-2026-09-28.json";
import { replayTool, thesisRow, type Row } from "@/lib/replay";
import type { ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type { buildWriterSaveCall as BuildWriterSaveCall, RunThesisWriterArgs } from "./run-thesis-writer";

const FIXTURE = "lib/agent/__fixtures__/cogt-seed-refresh-2026-09-28.json";
type Fixture = { run: { mode: "refresh"; existingThesisId: string; ticker: string; price: number }; decision: Record<string, unknown>; thesis: Row };
const fx = fixture as unknown as Fixture;

const args: RunThesisWriterArgs = { childRunId: "cmukjnhy4000604l5up1m1661", analystId: "analyst_replay", ticker: fx.run.ticker, mode: "refresh", existingThesisId: fx.run.existingThesisId, reason: "a refresh on a seed" };
const pull = { currentPrice: fx.run.price, catalystOnFile: null } as never;
const decision = fx.decision as unknown as ValidatedThesisDecision;
const SEED = { direction: null, status: "WATCHING" };

/**
 * The writer's pure save-call builder and the save's writer-door schema,
 * loaded without a database (the replay doubles its own). The writer runs
 * its server-built args through that schema before executing
 * (executeThroughSchema): that is where trigger ids are minted and the
 * trigger shapes read. The same here.
 */
let build: typeof BuildWriterSaveCall;
let writerDoor: z.ZodTypeAny;
beforeAll(async () => {
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    build = (await import("./run-thesis-writer")).buildWriterSaveCall;
    const { updateThesis } = await import("@/lib/agent/tools/update-thesis");
    writerDoor = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
});

function throughTheWriterDoor(toolArgs: Record<string, unknown>): Record<string, unknown> {
  const parsed = writerDoor.safeParse(toolArgs);
  if (!parsed.success) throw new Error(`the writer door refused the args: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`);
  return parsed.data as Record<string, unknown>;
}

async function save(d: ValidatedThesisDecision) {
  const call = build(args, pull, d, {}, SEED);
  return replayTool("update-thesis", "updateThesis", {
    seed: { thesis: [thesisRow({ ...fx.thesis })] },
    args: throughTheWriterDoor(call.toolArgs),
    ctx: { runMode: "THESIS_WRITER" },
    quotes: { COGT: fx.run.price },
  });
}

describe("COGT 09-28: the writer's refresh on a seed", () => {
  it("sends its direction on a row with no view, and never on a row with one", () => {
    const seed = build(args, pull, decision, {}, SEED);
    expect(seed.toolName).toBe("update_thesis");
    expect(seed.toolArgs.direction).toBe("LONG");
    expect(seed.toolArgs.rationale).not.toContain("orchestrator should re-evaluate direction");
    const withView = build(args, pull, decision, {}, { direction: "LONG", status: "WATCHING" });
    expect(withView.toolArgs.direction).toBeUndefined();
    const changedView = build(args, pull, { ...decision, direction: "SHORT" } as ValidatedThesisDecision, {}, { direction: "LONG", status: "WATCHING" });
    expect(changedView.toolArgs.direction).toBeUndefined();
    expect(changedView.toolArgs.rationale).toContain("Writer's refreshed view is SHORT vs stored LONG");
  });

  it("the save commits the seed: LONG on watch, the plan priced, the claim on the row", async () => {
    const result = await save(decision);
    expect(result.crashed).toBe(false);
    expect(result.refused).toBe(false);
    const row = result.db.store.thesis[0];
    expect(row).toMatchObject({ direction: "LONG", status: "WATCHING", horizon: "CATALYST", setupId: "PRE_CATALYST", entryPrice: 36.95, targetPrice: 43.35, stopLoss: 34.91 });
    expect(row.coreBelief).toBe(fx.decision.core_belief);
    expect(row.invalidationConds).toEqual(fx.decision.invalidation_conditions);
    expect(row.conviction).toBe("MEDIUM");
    const written = (result.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");
    expect(written).toHaveLength(1);
    expect((written[0].fieldChanges as Record<string, unknown>).direction).toEqual({ from: null, to: "LONG" });
  });

  it("a PASS on a seed retires it as researched and declined (the same decision, its verdict changed: a variant, not a production call)", async () => {
    const pass = { ...decision, direction: "PASS" } as ValidatedThesisDecision;
    expect(build(args, pull, pass, {}, SEED).toolArgs.direction).toBe("PASS");
    const result = await save(pass);
    expect(result.crashed).toBe(false);
    expect(result.refused).toBe(false);
    expect(result.db.store.thesis[0]).toMatchObject({ direction: null, status: "PASSED" });
  });

  it("the fixture holds the decision and the row's read fields, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
    expect(fx.thesis).toMatchObject({ direction: null, coreBelief: null, entryPrice: null, stopLoss: null });
  });
});
