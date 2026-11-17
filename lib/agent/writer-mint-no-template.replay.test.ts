/**
 * writer-mint-no-template.replay.test.ts — a stock has triggers and nothing
 * else (2026-11-16). A Writer mint that sends no triggers is saved with the
 * review clock its dispatch asked for and nothing more: no buy, floor or
 * target is stamped from a horizon template. The decision goes through the
 * Writer's own save-call builder and then the real record_thesis.
 */
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import type { ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type { buildWriterSaveCall as BuildWriterSaveCall } from "@/lib/agent/run-thesis-writer";

type Trig = { action: string; predicate: { watch?: string; value?: number }; source?: string };

const decision = {
  direction: "LONG",
  horizon: "COMPOUNDER",
  rationale: "Bullish on the business; no level worth waiting for until the next report, so I'll look again on the clock.",
  core_belief: "The company compounds as its subscription base grows and margins widen with scale.",
  key_assumptions: ["Subscription revenue grows above 20%, checked at each quarterly report.", "Gross margin stays above 75%, in each 10-Q."],
  invalidation_conditions: ["A guidance cut at the next report.", "Gross margin under 72% in the 10-Q."],
  conviction: "MEDIUM",
  conviction_rationale: "A good business at a full price; I want the chart to come to me.",
} as unknown as ValidatedThesisDecision;

async function writerMint(reviewCadenceDays: number | null) {
  let build: typeof BuildWriterSaveCall | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    build = (await import("@/lib/agent/run-thesis-writer")).buildWriterSaveCall;
  });
  jest.dontMock("@/lib/prisma");
  const args = { childRunId: "writer_run", analystId: REPLAY_ANALYST_ID, ticker: "ACME", mode: "mint" as const, reason: "new coverage", reviewCadenceDays };
  const call = build!(args, { currentPrice: 100 } as never, decision, {}, null);
  expect(call.toolName).toBe("record_thesis");
  return replayTool("record-thesis", "recordThesis", {
    seed: { agentConfig: [agentConfigRow({ setupIds: ["COMPOUNDER_ACCUMULATION"] })], account: [accountRow()] },
    ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID },
    args: call.toolArgs,
    quotes: { ACME: 100 },
  });
}

describe("a Writer mint that sends no triggers", () => {
  it("gets the review clock its dispatch asked for, and no buy, floor or target", async () => {
    const { refused, refusal, db } = await writerMint(14);
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ status: "WATCHING", direction: "LONG" });
    expect((row.triggers as Array<{ action: string; predicate: { watch?: string } }>).some((t) => ["ENTER", "EXIT", "STOP_WATCHING"].includes(t.action) && t.predicate.watch === "price")).toBe(false);
    const triggers = row.triggers as Trig[];
    expect(triggers.map((t) => [t.action, t.predicate.watch, t.predicate.value])).toEqual([["REVIEW", "repeat", 14]]);
  });

  it("with no clock asked for, it is saved with nothing on it: a watch carries only what it was given", async () => {
    const { refused, db } = await writerMint(null);
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect(row.triggers).toEqual([]);
    expect((row.triggers as Array<{ action: string; predicate: { watch?: string } }>).some((t) => ["ENTER", "EXIT", "STOP_WATCHING"].includes(t.action) && t.predicate.watch === "price")).toBe(false);
  });
});
