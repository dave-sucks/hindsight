/**
 * update-thesis-catalyst-date.replay.test.ts — a dated event with no date
 * lands, and says so (step 12, part 3). Information, never a refusal; the
 * mint (record_thesis) and the writer's own check keep their refusals.
 *
 * No production save or mint put a CATALYST row on the book without its date
 * in the 90 days to 2026-10-09 (0 live rows, 0 audit rows, 0 refusals), so
 * there is no verbatim call. The nearest real one: COGT's 2026-09-28 writer
 * decision (CATALYST, event 2026-11-30), built into its save call by the
 * writer's own builder, with catalyst_date taken out, through the chat's
 * update_thesis. A variant, labeled as one.
 */
import type { z } from "zod";
import fixture from "@/lib/agent/__fixtures__/cogt-seed-refresh-2026-09-28.json";
import { replayTool, thesisRow, type Row } from "@/lib/replay";
import type { ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type { buildWriterSaveCall as BuildWriterSaveCall, RunThesisWriterArgs } from "@/lib/agent/run-thesis-writer";

type Fixture = { run: { existingThesisId: string; ticker: string; price: number }; decision: Record<string, unknown>; thesis: Row };
const fx = fixture as unknown as Fixture;

let build: typeof BuildWriterSaveCall;
let chatDoor: z.ZodTypeAny;
let rowForModel: typeof import("@/lib/agent/row-for-model").rowForModel;
beforeAll(async () => {
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    build = (await import("@/lib/agent/run-thesis-writer")).buildWriterSaveCall;
    const { updateThesis } = await import("./update-thesis");
    chatDoor = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "PRINCIPAL_CHAT" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
    rowForModel = (await import("@/lib/agent/row-for-model")).rowForModel;
  });
});

describe("COGT's decision with its event date taken out, through the chat's save (a variant)", () => {
  it("lands as a CATALYST row with no date; the reply says the date is missing; the row says so", async () => {
    const args: RunThesisWriterArgs = { childRunId: "cmukjnhy4000604l5up1m1661", analystId: "analyst_replay", ticker: "COGT", mode: "refresh", existingThesisId: fx.run.existingThesisId, reason: "variant" };
    const call = build(args, { currentPrice: fx.run.price, catalystOnFile: null } as never, { ...(fx.decision as unknown as ValidatedThesisDecision), catalyst_date: undefined }, {}, { direction: null, status: "WATCHING" });
    expect(call.toolArgs.catalyst_date).toBeUndefined();
    const parsed = chatDoor.safeParse(call.toolArgs);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5)));
    const save = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ ...fx.thesis, catalystDate: null })] },
      args: parsed.data as Record<string, unknown>,
      ctx: { runMode: "PRINCIPAL_CHAT" },
      quotes: { COGT: fx.run.price },
    });
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row).toMatchObject({ direction: "LONG", horizon: "CATALYST", catalystDate: null });
    const line = "COGT: the catalyst date is missing, so the pre-catalyst check cannot schedule around the event. Set catalyst_date to the date the company announced.";
    expect(save.result.data?.what_this_means).toEqual(expect.arrayContaining([line]));
    expect(save.result.summary).toContain("the catalyst date is missing");
    expect(rowForModel({ ...row }, { named: false, size: "line" })).toContain("catalyst date missing");
    expect((rowForModel({ ...row, situations: [] }, { named: false, size: "short" }) as Record<string, unknown>).catalyst).toBe("date missing");
  });

  it("with its date the same save says nothing about it", async () => {
    const args: RunThesisWriterArgs = { childRunId: "cmukjnhy4000604l5up1m1661", analystId: "analyst_replay", ticker: "COGT", mode: "refresh", existingThesisId: fx.run.existingThesisId, reason: "as recorded" };
    const call = build(args, { currentPrice: fx.run.price, catalystOnFile: null } as never, fx.decision as unknown as ValidatedThesisDecision, {}, { direction: null, status: "WATCHING" });
    const parsed = chatDoor.parse(call.toolArgs) as Record<string, unknown>;
    const save = await replayTool("update-thesis", "updateThesis", { seed: { thesis: [thesisRow({ ...fx.thesis })] }, args: parsed, ctx: { runMode: "PRINCIPAL_CHAT" }, quotes: { COGT: fx.run.price } });
    expect(save.refused).toBe(false);
    expect(String(save.result.summary)).not.toContain("catalyst date is missing");
  });
});
