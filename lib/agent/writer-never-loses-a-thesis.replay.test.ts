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
 */
import type { z } from "zod";
import { asSchema, zodSchema } from "ai";
import { safeParseJSON } from "@ai-sdk/provider-utils";
import fixture from "@/lib/agent/__fixtures__/writer-lost-theses-2026-11.json";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { thesisDecisionSchema, validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import type { buildWriterSaveCall as Build, makeSubmitThesisTool as MakeSubmit, withoutRefused as Without, RunThesisWriterArgs, WriterSaveOutcome } from "./run-thesis-writer";

type Case = { run: string; price: number; passedThesis?: string; decision: Record<string, unknown> & { setup_id: string } };
const F = fixture as unknown as Record<"PRAX" | "AAOI" | "HTFL", Case>;
type T = { action: string; predicate: Record<string, unknown>; rationale: string };

/**
 * The call as the model wrote it. A saved thread holds each tool call as the
 * SDK's parse returned it, so the fixture's filing has its type in
 * `variable`. The model wrote it in `value`: the SDK runs a tool only on a
 * call its schema accepts, and the schema reads a filing's type from `value`.
 */
const asWritten = (d: Record<string, unknown>) => ({
  ...d,
  triggers: (d.triggers as T[]).map((t) => (t.predicate.watch === "filing" ? { ...t, predicate: { watch: "filing", value: t.predicate.variable } } : t)),
});

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
  validateThesisDecision(d as never, { mode: "mint", existingStatus: null, currentPrice: c.price, existingTargetPrice: null, setups: setupsForAnalyst([c.decision.setup_id]), chart: null });

/** submit_thesis as the Writer builds it; its input schema is what the SDK parses the model's call with. */
const submitTool = (c: Case, check: (d: ValidatedThesisDecision) => Promise<WriterSaveOutcome>, onAccept = jest.fn()) =>
  makeSubmit({ ticker: "T", validate: { mode: "mint", currentPrice: c.price, setups: setupsForAnalyst([c.decision.setup_id]), chart: null }, check, onAttempt: () => 1, onAccept }) as unknown as {
    inputSchema: Parameters<typeof asSchema>[0];
    execute: (raw: unknown) => Promise<{ accepted: boolean; errors?: string[]; saved_without?: string[] }>;
  };

/** What the SDK does with the model's call before the tool runs (ai's doParseToolCall). */
const sdkParse = (c: Case, call: unknown) => safeParseJSON({ text: JSON.stringify(call), schema: asSchema(submitTool(c, async () => ({ thesisId: null, wouldSave: true, fixable: false, error: null })).inputSchema) });

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

/** The model's call from the SDK's parse, through the Writer's check and the real save. */
async function submitAndSave(ticker: string, c: Case, call: Record<string, unknown>) {
  const sdk = await sdkParse(c, call);
  if (!sdk.success) throw new Error(`the SDK refused the call: ${sdk.error.message}`);
  const v = decide(c, sdk.value as Record<string, unknown>);
  expect(v.errors).toEqual([]);
  expect(v.decision!.dropped).toBeUndefined();
  const { refusal, crashed, db } = await mint(ticker, c, v.decision!);
  expect([refusal, crashed]).toEqual([null, false]);
  const row = stored(db as never, ticker);
  expect(db.store.thesisUpdate.filter((u) => u.thesisId === row.id && u.type === "CREATED")).toHaveLength(1);
  return (row.triggers as T[]).map((t) => t.predicate);
}

describe("the model is sent the same submit_thesis schema as before", () => {
  it("byte for byte: the JSON schema of the decision schema itself", async () => {
    const sent = await asSchema(submitTool(F.PRAX, async () => ({ thesisId: null, wouldSave: true, fixable: false, error: null })).inputSchema).jsonSchema;
    expect(JSON.stringify(sent)).toBe(JSON.stringify(await zodSchema(thesisDecisionSchema).jsonSchema));
  });
});

describe.each(["PRAX", "AAOI"] as const)("%s: the filing trigger the save refused", (ticker) => {
  const c = F[ticker];
  const call = asWritten(c.decision);
  const filing = (call.triggers as T[]).find((t) => t.predicate.watch === "filing")!;

  it("the SDK hands the Writer the call as the model wrote it, the filing's type still in `value`", async () => {
    const sdk = await sdkParse(c, call);
    expect(sdk.success).toBe(true);
    expect((sdk as { value: { triggers: T[] } }).value.triggers).toContainEqual(filing);
  });

  it("a filing written as storage keeps it is handed back by the SDK, saying where its type goes", async () => {
    const sdk = await sdkParse(c, c.decision);
    expect(sdk.success).toBe(false);
    expect((sdk as { error: Error }).error.message).toContain("goes in `value`, not `variable`");
  });

  it("the decision saves, the filing wake with it, converted once by the save", async () => {
    expect(await submitAndSave(ticker, c, call)).toContainEqual({ watch: "filing", variable: filing.predicate.value });
  });
});

describe("a trigger of two conditions holding a filing and a line", () => {
  const c = F.PRAX;
  const group = { match: "any", conditions: [{ watch: "filing", value: "tier:RED" }, { watch: "price", is: "below", value: "sma50" }] };
  const call = { ...asWritten(c.decision), triggers: [...asWritten(c.decision).triggers.filter((t) => t.predicate.watch !== "filing"), { action: "REVIEW", fireMode: "ASK_NOW", predicate: group, rationale: "A red-tier filing, or a break of the 50-day: look again." }] };

  it("saves whole, each condition converted once (until 2026-11-13 the Writer dropped it as not a condition)", async () => {
    expect(await submitAndSave("PRAX", c, call)).toContainEqual({
      match: "any",
      conditions: [{ watch: "filing", variable: "tier:RED" }, { watch: "price", is: "below", variable: "sma50" }],
    });
  });
});

describe("HTFL: a refresh sent onto a thesis passed in August", () => {
  const c = F.HTFL;
  const passed = () => thesisRow({ id: c.passedThesis!, ticker: "HTFL", status: "PASSED", direction: null });

  it("dispatch sends it as new research linked to the passed thesis, and says so", async () => {
    const { refusal, result, db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], thesis: [passed()] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { ticker: "HTFL", mode: "refresh", existing_thesis_id: c.passedThesis, reason: "The owner asked for HeartFlow's research refreshed." },
      mocks: { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map(), error: null }) }) },
    });
    expect(refusal).toBeNull();
    expect(db.store.researchRun.at(-1)!.parameters).toMatchObject({ mode: "mint", existingThesisId: null, parentThesisId: c.passedThesis });
    // In words: the ids stay in the run's parameters and the event.
    expect(result.summary).toMatch(/Its thesis from [A-Z][a-z]{2} \d{1,2} is passed, so this is new research on the stock, linked to it\.$/);
    expect(result.summary).not.toContain(c.passedThesis!);
  });

  it("with a live thesis on the stock, that one is refreshed instead", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], thesis: [passed(), thesisRow({ id: "htfl_live", ticker: "HTFL", status: "WATCHING" })] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { ticker: "HTFL", mode: "refresh", existing_thesis_id: c.passedThesis, reason: "The owner asked for HeartFlow's research refreshed." },
      mocks: { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map(), error: null }) }) },
    });
    expect(db.store.researchRun.at(-1)!.parameters).toMatchObject({ mode: "refresh", existingThesisId: "htfl_live", parentThesisId: null });
    expect(String((db.store.researchRun.at(-1)!.parameters as { reason: string }).reason)).toMatch(/is passed, so its live thesis is refreshed instead\.$/);
  });

  it("its decision, sent as a mint sends triggers, saves linked to the passed thesis, which stays passed", async () => {
    const { add_triggers, ...rest } = c.decision;
    const v = decide(c, { ...rest, triggers: add_triggers });
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
  const c = { ...F.AAOI, decision: { ...F.AAOI.decision, ...asWritten(F.AAOI.decision) } };
  const tool = (check: (d: ValidatedThesisDecision) => Promise<WriterSaveOutcome>, onAccept = jest.fn()) => ({
    onAccept,
    t: makeSubmit({ ticker: "AAOI", validate: { mode: "mint", currentPrice: c.price, setups: setupsForAnalyst(["PEAD"]), chart: null }, check, onAttempt: () => 1, onAccept }) as unknown as {
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

  it("after two hand-backs a refused trigger is left out, the rest is accepted, and the reply names what was left out", async () => {
    const check = jest.fn(async (d: ValidatedThesisDecision) => ((d.triggers ?? []).length === 3 ? refuses("bad", [{ path: ["triggers", 1, "predicate"], message: "Not a condition." }]) : saves));
    const { t, onAccept } = tool(check);
    expect((await t.execute(c.decision)).accepted).toBe(false);
    expect((await t.execute(c.decision)).accepted).toBe(false);
    const third = await t.execute(c.decision);
    expect(third.accepted).toBe(true);
    expect(third.saved_without).toEqual([expect.stringMatching(/^the review trigger ".+" — Not a condition\.$/)]);
    const kept = onAccept.mock.calls[0][0] as ValidatedThesisDecision;
    expect(kept.triggers).toHaveLength(2);
    expect(kept.dropped).toEqual([expect.objectContaining({ field: "triggers", reason: "Not a condition." })]);
  });
});

describe("a chat's rewrite keeps the row's levels, read off the stored shape", () => {
  const floor = { id: "floor_1", action: "EXIT", predicate: { watch: "price", is: "below", value: 300 }, rationale: "The floor." };
  const line = { action: "EXIT", predicate: { watch: "price", is: "below", value: "sma50" }, rationale: "Under the 50-day the run-up is broken." };
  const call = () =>
    build(
      { childRunId: "r", analystId: REPLAY_ANALYST_ID, ticker: "PRAX", mode: "refresh", reason: "a replay", existingThesisId: "t", keepLevels: true },
      { currentPrice: 324.76, catalystOnFile: null } as never,
      { direction: "LONG", rationale: "A rewrite the chat asked for.", horizon: "CATALYST", add_triggers: [line] } as never,
      {},
      { direction: "LONG", status: "HOLDING", keep: [floor] as never },
    ).toolArgs;

  it("a sale on a line, as the model writes it, is a new trigger, not the floor the chat set", () => {
    expect(call().add_triggers).toEqual([line]);
    expect(String(call().rationale)).not.toContain("stop $sma50");
  });
});

describe("what a save goes without is found in the call that was sent", () => {
  const a = { action: "REVIEW", predicate: { watch: "price", is: "below", value: 1 }, rationale: "a" };
  const b = { action: "REVIEW", predicate: { watch: "filing", value: "nope" }, rationale: "b" };
  const d = { add_triggers: [a, b] } as unknown as ValidatedThesisDecision;

  it("a chat's rewrite sends its added triggers less the kept levels, so place 0 in the call is the decision's second", () => {
    expect(without(d, [{ path: ["add_triggers", 0, "predicate"], message: "bad" }], { add_triggers: [b] })!.add_triggers).toEqual([a]);
  });

  it("a refusal of a level, the claim or a trigger code added is not something a save can go without", () => {
    expect(without(d, [{ path: ["entry_price"], message: "bad" }])).toBeNull();
    expect(without(d, [{ path: ["core_belief"], message: "bad" }])).toBeNull();
    expect(without(d, [{ path: ["add_triggers", 0], message: "bad" }], { add_triggers: [{ action: "REVIEW" }] })).toBeNull();
  });
});
