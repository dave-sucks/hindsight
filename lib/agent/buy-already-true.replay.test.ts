/**
 * buy-already-true.replay.test.ts — an agent's new buy has to be able to cross.
 *
 * HPE, 2026-09-09 19:40. The Writer minted HPE with "Entry set at $54.75 (just
 * above SMA20 on a bounce)", a pullback, while the stock was at $57.08. The
 * save stored the buy as "above $54.75": true already, so it could never cross
 * and never fire, and a hand repair flipped it to "below" five minutes later.
 * The same decision is written below as the Writer writes it today, a buy
 * trigger in its decision, and goes through the Writer's own save-call
 * builder, the save's own schema and record_thesis in check-only mode
 * (checkDecisionAgainstSave's three steps), then readWriterSaveResult: the
 * refusal comes back to the Writer as fixable, before anything is saved.
 */
import type { z } from "zod";
import { replayTool, agentConfigRow, accountRow, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import type { ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type * as Writer from "@/lib/agent/run-thesis-writer";
import { applyTriggerOps } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";

const PRICE = 57.08;
const buy = (is: "above" | "below", value: number) => ({
  action: "ENTER",
  predicate: { watch: "price", is, value },
  rationale: "Entry at $54.75, just above the SMA20 on a bounce.",
});
const FLOOR = { action: "EXIT", predicate: { watch: "price", is: "below", value: 50.35 }, rationale: "Below the 50-day SMA ($50.50) the support is broken." };

/** The 09-09 submit_thesis, its entry and stop written as triggers. */
const decision = (entry: ReturnType<typeof buy>) =>
  ({
    direction: "LONG",
    horizon: "TARGET",
    rationale: "A textbook PEAD print marred by a -6.8% gap down. The pullback entry at $54.75 (SMA20 bounce) targets $64 with a stop below the 50-day.",
    core_belief: "HPE drifts toward $64+ within 45 days as estimate revisions resolve the gap-down reaction to a clean beat-and-raise.",
    key_assumptions: ["FY26 non-GAAP EPS of $3.75-$3.85 holds through the Q4 print.", "Hyperscaler AI capex stays elevated through the Oct-Nov earnings cycle."],
    invalidation_conditions: ["A close below the 50-day SMA ($50.50) on above-average volume.", "A guidance cut or a hyperscaler capex reduction."],
    conviction: "MEDIUM",
    conviction_rationale: "Every PEAD metric is clean, but the drift has to reverse the gap's direction.",
    triggers: [entry, FLOOR],
  }) as unknown as ValidatedThesisDecision;

const seed = () => ({ agentConfig: [agentConfigRow()], account: [accountRow()] });
const ctx = (dryRun: boolean) => ({ runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID, ...(dryRun ? { dryRun: true } : {}) });

async function writerModules() {
  let mod: typeof Writer | undefined;
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    mod = await import("@/lib/agent/run-thesis-writer");
    const { recordThesis } = await import("@/lib/agent/tools/record-thesis");
    schema = (recordThesis(ctx(true) as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  jest.dontMock("@/lib/prisma");
  return { ...mod!, schema: schema! };
}

/** The Writer's mint of the decision: its save call, through the save's schema, into record_thesis. */
async function writerMint(entry: ReturnType<typeof buy>, dryRun: boolean) {
  const { buildWriterSaveCall, readWriterSaveResult, schema } = await writerModules();
  const args = { childRunId: "writer_run", analystId: REPLAY_ANALYST_ID, ticker: "HPE", mode: "mint" as const, reason: "new coverage" };
  const call = buildWriterSaveCall(args, { currentPrice: PRICE } as never, decision(entry), {}, null);
  expect(call.toolName).toBe("record_thesis");
  const r = await replayTool("record-thesis", "recordThesis", { seed: seed(), ctx: ctx(dryRun), args: schema.parse(call.toolArgs) as Record<string, unknown>, quotes: { HPE: PRICE } });
  return { ...r, outcome: readWriterSaveResult("record_thesis", r.result as never) };
}

describe("HPE 2026-09-09: a buy above $54.75 written at $57.08", () => {
  it("the Writer's check-only save hands the refusal back with both fixes, and nothing is saved", async () => {
    const { outcome, db } = await writerMint(buy("above", 54.75), true);
    expect(outcome).toMatchObject({ wouldSave: false, fixable: true });
    expect(outcome.error).toBe(
      "record_thesis refused: A buy above $54.75 is already true at $57.08, so it never crosses and never fires. To buy now, set it at or a few cents past $57.08 (is: above); for a pullback, write is: below at a level under $57.08.",
    );
    expect(db.store.thesis ?? []).toEqual([]);
  });

  it("the save itself refuses it too", async () => {
    const { result, db } = await writerMint(buy("above", 54.75), false);
    expect(result.data).toMatchObject({ thesis_id: null, status: "FAILED" });
    expect(db.store.thesis ?? []).toEqual([]);
  });

  it.each([
    ["the pullback it was meant to be", buy("below", 54.75)],
    ["a buy now, a few cents past the price", buy("above", 57.1)],
  ])("%s saves", async (_name, entry) => {
    expect((await writerMint(entry, true)).outcome).toMatchObject({ wouldSave: true, error: null });
    const { db } = await writerMint(entry, false);
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect((row.triggers as Trigger[]).find((t) => t.action === "ENTER")?.predicate).toEqual(entry.predicate);
  });

  it("an update_thesis add is refused by id and the rest of the call lands; the pullback lands", async () => {
    const row = thesisRow({ ticker: "HPE", status: "WATCHING", direction: "LONG", triggers: [{ ...FLOOR, id: "floor" }] });
    const add = (entry: ReturnType<typeof buy>) =>
      replayTool("update-thesis", "updateThesis", {
        seed: { thesis: [row], agentConfig: [agentConfigRow()], account: [accountRow()] },
        ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID },
        args: { thesis_id: row.id, add_triggers: [{ ...entry, id: "buy" }], rationale: "Buying the pullback to the 20-day." },
        quotes: { HPE: PRICE },
      });
    const dead = await add(buy("above", 54.75));
    expect(dead.result.data?.trigger_ops).toEqual([
      expect.objectContaining({ op: "add", id: "buy", ok: false, reason: expect.stringContaining("is already true at $57.08") }),
    ]);
    expect((dead.db.store.thesis[0].triggers as Trigger[]).map((t) => t.id)).toEqual(["floor"]);
    expect(dead.refused).toBe(false);
    expect(dead.db.store.thesisUpdate.map((u) => u.rationale)).toContain("Buying the pullback to the 20-day.");
    const fixed = await add(buy("below", 54.75));
    expect((fixed.db.store.thesis[0].triggers as Trigger[]).map((t) => t.id)).toEqual(["floor", "buy"]);
  });

  it("the owner's buy is the owner's: the same add from the owner lands", () => {
    const op = (actor: "AGENT" | "PRINCIPAL") =>
      applyTriggerOps({
        stored: [],
        ops: [{ op: "add", trigger: buy("above", 54.75) as unknown as Trigger }],
        direction: "LONG",
        status: "WATCHING",
        actor,
        currentPrice: PRICE,
        mintId: () => "t1",
      }).results[0];
    expect(op("AGENT")).toMatchObject({ ok: false });
    expect(op("PRINCIPAL")).toMatchObject({ ok: true });
  });
});

/**
 * A group is already true only when it is true as a whole. In "all", a part
 * that is not a typed price (the 20-day, volume) or a price part not yet true
 * leaves it able to cross. SMMT 2026-10-02's buy was "closes above $17.10 and
 * above the 20-day"; at $17.50 under the 20-day it waits for the reclaim. A
 * breakout with a chase cap ("above $50 on the close, 1.5× volume, below $55")
 * written between the two waits for the close and the volume.
 */
describe("a buy written as a group, added by an agent", () => {
  const price = (is: "above" | "below", value: number, close = false) => ({ watch: "price", is, value, ...(close ? { settings: { close: true } } : {}) });
  const addGroup = (ticker: string, at: number, floor: number, predicate: unknown) => {
    const row = thesisRow({ ticker, status: "WATCHING", direction: "LONG", triggers: [{ ...FLOOR, id: "floor", predicate: price("below", floor) }] });
    return replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [row], agentConfig: [agentConfigRow()], account: [accountRow()] },
      ctx: { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID },
      args: { thesis_id: row.id, add_triggers: [{ id: "buy", action: "ENTER", predicate, rationale: "The buy." }], rationale: "Setting the buy." },
      quotes: { [ticker]: at },
    });
  };
  const landed = async (r: ReturnType<typeof addGroup>) => ((await r).result.data?.trigger_ops as Array<{ ok: boolean; reason?: string }>)[0];

  it.each([
    ["SMMT: closes above $17.10 and above the 20-day, at $17.50", "SMMT", 17.5, 15.9, { match: "all", conditions: [price("above", 17.1, true), { watch: "price", is: "above", variable: "sma20" }] }],
    ["a breakout under a chase cap: above $50 on the close, 1.5× volume, below $55, at $52", "AAA", 52, 45, { match: "all", conditions: [price("above", 50, true), { watch: "volume", value: 1.5 }, price("below", 55)] }],
  ])("%s saves", async (_name, ticker, at, floor, predicate) => {
    expect(await landed(addGroup(ticker, at, floor, predicate))).toMatchObject({ ok: true });
  });

  it.each([
    ['"all" of two price levels, both true: above $50 and below $55, at $52', { match: "all", conditions: [price("above", 50), price("below", 55)] }],
    ['"any" with one price part true: above $50 or below $40, at $52', { match: "any", conditions: [price("above", 50), price("below", 40)] }],
  ])("%s is refused", async (_name, predicate) => {
    expect(await landed(addGroup("AAA", 52, 45, predicate))).toMatchObject({ ok: false, reason: expect.stringContaining("is already true at $52,") });
  });
});
