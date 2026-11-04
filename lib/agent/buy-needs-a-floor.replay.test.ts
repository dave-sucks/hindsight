/**
 * A buy needs a floor, not a target (2026-11-04). The house sets no target
 * of its own, so the reward/risk floor had nothing of ours to measure: the
 * stored plan the 2:1 rule was written for is legal, and the row's Street
 * line says how much room there is to the Street's average against the
 * floor's distance instead. Fixtures: ETN's and PLTR's real rows as
 * get_theses read them on 2026-11-04 (activity text and history left out).
 */
import type { z } from "zod";
import etn from "@/lib/agent/__fixtures__/row-etn-2026-11-04.json";
import pltr from "@/lib/agent/__fixtures__/row-pltr-2026-11-04.json";
import cogt from "@/lib/agent/__fixtures__/cogt-seed-refresh-2026-09-28.json";
import { rowForModel } from "@/lib/agent/row-for-model";
import { validateThesisShape } from "@/lib/agent/thesis-shape";
import { validateThesisDecision, type ThesisDecisionInput, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { checkLadder } from "@/lib/agent/triggers/ops";
import { planTriggers, replayTool, thesisRow } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { buildWriterSaveCall as BuildWriterSaveCall, RunThesisWriterArgs } from "@/lib/agent/run-thesis-writer";

type Row = Record<string, unknown>;

describe("the plan the 2:1 rule was written for (PLTR as stored, 183 / 190 / 110)", () => {
  it("is legal on every write path: the shape rule and the ladder check both pass it, as the agent", () => {
    expect(validateThesisShape({ direction: "LONG", entryPrice: 183, targetPrice: 190, stopLoss: 110 })).toMatchObject({ ok: true, riskReward: expect.closeTo(0.1, 1) });
    const check = checkLadder({ triggers: planTriggers({ entry: 183, target: 190, stop: 110 }) as unknown as Trigger[], direction: "LONG", status: "WATCHING", actor: "AGENT" });
    expect(check).toEqual({ ok: true, columns: { entryPrice: 183, targetPrice: 190, stopLoss: 110 } });
  });
});

describe("the room to the Street average, on the real rows", () => {
  it("ETN, watched (buy $410, floor $358.50, Street avg $511.57): 2.0× from the buy level, on the street line", () => {
    const short = rowForModel(etn as Row, { named: false, size: "short" }) as Row;
    expect(String(short.street)).toContain("room to the Street average is 2.0× the floor's distance from the buy level");
    expect(String(short.street)).not.toMatch(/\d:1/);
  });

  it("PLTR, held (price $171.92 under its $196 floor): the line says the price is past the floor, no ratio", () => {
    const short = rowForModel(pltr as Row, { named: false, size: "short" }) as Row;
    expect(String(short.street)).toContain("the price is past the floor");
  });
});

/**
 * A priced plan is a buy and a floor. COGT's real writer decision
 * (2026-09-28, a refresh on a seed with no view) with its target taken out:
 * the Writer's own check passes it, the writer's save-call builder sends the
 * commit, and the save lands LONG on watch with a buy trigger and a floor
 * trigger and no target, through the writer's door and the chat's.
 */
describe("COGT 09-28, the target taken out of the writer's real decision", () => {
  type Fixture = { run: { existingThesisId: string; ticker: string; price: number }; decision: Record<string, unknown>; thesis: Row };
  const fx = cogt as unknown as Fixture;
  const decision = { ...(fx.decision as unknown as ValidatedThesisDecision), target_price: undefined, target_basis: undefined };
  const args: RunThesisWriterArgs = { childRunId: "cmukjnhy4000604l5up1m1661", analystId: "analyst_replay", ticker: "COGT", mode: "refresh", existingThesisId: fx.run.existingThesisId, reason: "a refresh on a seed" };
  let build: typeof BuildWriterSaveCall;
  const doors: Record<string, z.ZodTypeAny> = {};
  beforeAll(async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
      build = (await import("@/lib/agent/run-thesis-writer")).buildWriterSaveCall;
      const { updateThesis } = await import("@/lib/agent/tools/update-thesis");
      for (const mode of ["THESIS_WRITER", "PRINCIPAL_CHAT"]) {
        doors[mode] = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: mode } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
      }
    });
  });

  it("the Writer's own check passes a buy and a floor with no target", () => {
    const v = validateThesisDecision(decision as unknown as ThesisDecisionInput, { mode: "refresh", existingStatus: "WATCHING", currentPrice: fx.run.price } as never);
    expect(v.errors.filter((e) => /target/.test(e))).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it.each(["THESIS_WRITER", "PRINCIPAL_CHAT"])("through the %s door: the seed commits LONG with a buy and a floor trigger and no target", async (mode) => {
    const call = build(args, { currentPrice: fx.run.price, catalystOnFile: null } as never, decision, {}, { direction: null, status: "WATCHING" });
    expect(call.toolArgs.target_price).toBeUndefined();
    const parsed = doors[mode].safeParse(call.toolArgs);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
    const r = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [thesisRow({ ...fx.thesis })] }, args: parsed.data as Row, ctx: { runMode: mode }, quotes: { COGT: fx.run.price } });
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.result.data?.error).toBeUndefined();
    expect(String(r.result.summary)).not.toMatch(/target_price|missing|Target set/);
    const row = r.db.store.thesis[0];
    expect(row).toMatchObject({ direction: "LONG", status: "WATCHING", entryPrice: 36.95, stopLoss: 34.91, targetPrice: null });
    const actions = (row.triggers as Trigger[]).map((t) => t.action);
    expect(actions).toContain("ENTER");
    expect(actions).toContain("EXIT");
  });
});
