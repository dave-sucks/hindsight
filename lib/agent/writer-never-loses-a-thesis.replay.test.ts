/**
 * A thesis is never lost (2026-11-13). In the 30 days to Nov 13, 3 of 20
 * Writer runs saved nothing:
 *
 * - PRAX and AAOI wrote a filing trigger as the model is told to, its type in
 *   `value`. The SDK's parse of submit_thesis ran the trigger schema, which
 *   converts a trigger to its stored shape (the type moved to `variable`), and
 *   handed that copy to the tool. The Writer then sent the copy through
 *   record_thesis's schema, which converts again and refuses the stored
 *   shape. Every filing and every price against an average the Writer wrote
 *   since #770 (Oct 6) was refused this way, and the retry quoted the model a
 *   converted call it never wrote. Now submit_thesis checks the call against
 *   the same schema and hands it over as written; the save converts it once.
 * - HTFL: the chat sent a refresh onto a thesis passed on Aug 20, which no
 *   save can update (update_thesis refuses a terminal row).
 *
 * Each run's last submit_thesis call, from its saved thread, through what the
 * SDK runs on a tool call (safeParseJSON with the tool's own input schema),
 * the Writer's check, the real save-call builder, the save's own input schema
 * and the real save (no model). HTFL goes through the real dispatch first.
 * Since T1 the decision carries no trigger (the save writes the playbook's and
 * the Writer tailors them with edit_triggers), so PRAX's and AAOI's filing
 * triggers reach the save through edit_triggers, converted once by its schema.
 */
import type { z } from "zod";
import { ratedNow } from "@/lib/replay/rated";
import { asSchema, zodSchema } from "ai";
import fixture from "@/lib/agent/__fixtures__/writer-lost-theses-2026-11.json";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { thesisDecisionSchema, validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type { buildWriterSaveCall as Build, makeSubmitThesisTool as MakeSubmit, withoutRefused as Without, RunThesisWriterArgs, WriterSaveOutcome } from "./run-thesis-writer";

type Case = { run: string; price: number; passedThesis?: string; decision: Record<string, unknown> & { setup_id: string } };
const F = fixture as unknown as Record<"PRAX" | "AAOI" | "HTFL", Case>;

let build: typeof Build;
let makeSubmit: typeof MakeSubmit;
let without: typeof Without;
let recordDoor: z.ZodTypeAny;
beforeAll(async () => {
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
    ({ buildWriterSaveCall: build, makeSubmitThesisTool: makeSubmit, withoutRefused: without } = await import("./run-thesis-writer"));
    const { recordThesis } = await import("@/lib/agent/tools/record-thesis");
    recordDoor = (recordThesis({ runId: "r", userId: "u", accountId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
});

const decide = (c: Case, d: Record<string, unknown> = c.decision) =>
  validateThesisDecision(ratedNow(d as never), { mode: "mint", existingStatus: null, currentPrice: c.price });

/** submit_thesis as the Writer builds it; its input schema is what the SDK parses the model's call with. */
const submitTool = (c: Case, check: (d: ValidatedThesisDecision) => Promise<WriterSaveOutcome>, onAccept = jest.fn()) =>
  makeSubmit({ ticker: "T", validate: { mode: "mint", currentPrice: c.price }, check, onAttempt: () => 1, onAccept }) as unknown as {
    inputSchema: Parameters<typeof asSchema>[0];
    execute: (raw: unknown) => Promise<{ accepted: boolean; errors?: string[]; saved_without?: string[] }>;
  };


/** The Writer's mint, through the save's schema as executeThroughSchema runs it, then the real record_thesis. */
async function mint(ticker: string, c: Case, d: ValidatedThesisDecision, extra: { parentThesisId?: string; seed?: Row[] } = {}) {
  const args: RunThesisWriterArgs = { childRunId: c.run, analystId: REPLAY_ANALYST_ID, ticker, mode: "mint", reason: "a replay", parentThesisId: extra.parentThesisId };
  const call = build(args, { currentPrice: c.price, catalystOnFile: null } as never, d, {}, null);
  const parsed = recordDoor.safeParse(call.toolArgs);
  if (!parsed.success) throw new Error(`the save's schema refused: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  return replayTool("record-thesis", "recordThesis", {
    seed: { agentConfig: [agentConfigRow({ setupIds: [c.decision.setup_id] })], account: [accountRow()], thesis: extra.seed ?? [] },
    ctx: { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID, runId: c.run },
    args: parsed.data as Record<string, unknown>,
    quotes: { [ticker]: c.price },
  });
}

const stored = (db: { store: Record<string, Row[]> }, ticker: string) => db.store.thesis.find((t) => t.ticker === ticker && t.status !== "PASSED")!;

describe("the model is sent the same submit_thesis schema as before", () => {
  it("byte for byte: the JSON schema of the decision schema itself", async () => {
    const sent = await asSchema(submitTool(F.PRAX, async () => ({ thesisId: null, wouldSave: true, fixable: false, error: null })).inputSchema).jsonSchema;
    expect(JSON.stringify(sent)).toBe(JSON.stringify(await zodSchema(thesisDecisionSchema).jsonSchema));
  });
});

describe("HTFL: a refresh sent onto a thesis passed in August", () => {
  const c = F.HTFL;
  const passed = () => thesisRow({ id: c.passedThesis!, ticker: "HTFL", status: "PASSED", direction: null });

  it("send to the Writer finds it by the stock: new research linked to the passed thesis, and says so", async () => {
    const { refusal, result, db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], thesis: [passed()] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { ticker: "HTFL", brief: "The owner asked for HeartFlow's research refreshed." },
      mocks: { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map(), error: null }) }) },
    });
    expect(refusal).toBeNull();
    expect(db.store.researchRun.at(-1)!.parameters).toMatchObject({ mode: "mint", existingThesisId: null, parentThesisId: c.passedThesis });
    // In words: the ids stay in the run's parameters and the event.
    expect(result.summary).toMatch(/Its thesis from [A-Z][a-z]{2} \d{1,2} is passed, so this is new research on the stock, linked to it\.$/);
    expect(result.summary).not.toContain(c.passedThesis!);
  });

  it("with a live thesis on the stock, that one is refreshed, and nothing is said of the passed one", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], thesis: [passed(), thesisRow({ id: "htfl_live", ticker: "HTFL", status: "WATCHING" })] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { ticker: "HTFL", brief: "The owner asked for HeartFlow's research refreshed." },
      mocks: { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map(), error: null }) }) },
    });
    expect(db.store.researchRun.at(-1)!.parameters).toMatchObject({ mode: "refresh", existingThesisId: "htfl_live", parentThesisId: null });
    expect(String((db.store.researchRun.at(-1)!.parameters as { reason: string }).reason)).not.toMatch(/passed/);
  });

  it("its decision, sent as a mint, saves linked to the passed thesis, which stays passed", async () => {
    const { add_triggers: _a, edit_triggers: _e, remove_trigger_ids: _r, ...rest } = c.decision;
    void [_a, _e, _r];
    const v = decide(c, rest);
    expect(v.errors).toEqual([]);
    const { refusal, crashed, db } = await mint("HTFL", c, v.decision!, { parentThesisId: c.passedThesis, seed: [passed()] });
    expect([refusal, crashed]).toEqual([null, false]);
    const row = stored(db as never, "HTFL");
    expect(row.parentThesisId).toBe(c.passedThesis);
    expect(db.store.thesis.find((t) => t.id === c.passedThesis)!.status).toBe("PASSED");
    expect(db.store.thesisUpdate.filter((u) => u.thesisId === row.id && u.type === "CREATED")).toHaveLength(1);
  });
});

describe("submit_thesis never says accepted unless the save will take it", () => {
  const c = F.AAOI;
  const tool = (check: (d: ValidatedThesisDecision) => Promise<WriterSaveOutcome>, onAccept = jest.fn()) => ({
    onAccept,
    t: makeSubmit({ ticker: "AAOI", validate: { mode: "mint", currentPrice: c.price }, check, onAttempt: () => 1, onAccept }) as unknown as {
      execute: (raw: unknown) => Promise<{ accepted: boolean; errors?: string[]; saved_without?: string[] }>;
    },
  });
  const refuses = (error: string, issues?: WriterSaveOutcome["issues"]): WriterSaveOutcome => ({ thesisId: null, wouldSave: false, fixable: true, error, issues });
  const saves: WriterSaveOutcome = { thesisId: null, wouldSave: true, fixable: false, error: null };

  it("a refusal of the whole call is handed back, and after the hand-backs still refused, never accepted", async () => {
    const { t, onAccept } = tool(async () => refuses("record_thesis refused: no provenance"));
    for (let i = 0; i < 4; i++) expect((await t.execute(c.decision)).accepted).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("after two hand-backs a refused optional field is left out, the rest is accepted, and the reply names what was left out", async () => {
    const check = jest.fn(async (d: ValidatedThesisDecision) => (d.variant_view ? refuses("bad", [{ path: ["variant_view"], message: "Too vague." }]) : saves));
    const { t, onAccept } = tool(check);
    const call = ratedNow({ ...c.decision, variant_view: "Analysts expect X; I think Y." });
    expect((await t.execute(call)).accepted).toBe(false);
    expect((await t.execute(call)).accepted).toBe(false);
    const third = await t.execute(call);
    expect(third.accepted).toBe(true);
    expect(third.saved_without).toEqual(["variant view — Too vague."]);
    const kept = onAccept.mock.calls[0][0] as ValidatedThesisDecision;
    expect(kept.variant_view).toBeUndefined();
  });

  it("a refusal of the claim or of a trigger code wrote is not something a save can go without", () => {
    const d = { ...c.decision } as unknown as ValidatedThesisDecision;
    expect(without(d, [{ path: ["core_belief"], message: "bad" }])).toBeNull();
    expect(without(d, [{ path: ["triggers", 0], message: "bad" }])).toBeNull();
  });
});
