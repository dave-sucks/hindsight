/**
 * runAgentAsRun keeps a run's books the same way for every agent: it opens
 * the run, runs the agent, saves the thread the run page shows, the token use
 * and the notes on its proposals, then the agent's own save, and sets the
 * status only while the run is still RUNNING.
 */
const created: Array<Record<string, unknown>> = [];
const statusWrites: Array<{ where: unknown; data: { status: string } }> = [];
const threads: Array<{ runId: string; opening: unknown[]; messages: unknown }> = [];
const tokens: Array<{ runId: string; model: string }> = [];
const noted: Array<{ runId: string; analystId: string | null }> = [];
const errors: Array<Record<string, unknown>> = [];
let reply: { text: string; fail?: boolean; finish?: string; output?: unknown; stepsFirst?: Array<Record<string, unknown>> } = { text: "Done." };
const calls: Array<Record<string, unknown>> = [];
const models: Array<Record<string, unknown>> = [];

jest.mock("@/lib/prisma", () => ({
  prisma: {
    researchRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => (created.push(data), { id: "run_1" }),
      updateMany: async (args: { where: unknown; data: { status: string } }) => (statusWrites.push(args), { count: 1 }),
      findUnique: async () => ({ parameters: { date: "2026-11-18" } }),
      update: async (args: { data: { parameters: Record<string, unknown> } }) => void errors.push(args.data.parameters),
    },
  },
}));
jest.mock("@/lib/agent/model", () => ({ modelFor: (_id: string, use: Record<string, unknown>) => (models.push(use), "the-model") }));
jest.mock("@/lib/agent/run-thread", () => ({
  saveRunThread: async (runId: string, t: { opening: unknown[]; messages: unknown }) => void threads.push({ runId, ...t }),
}));
jest.mock("@/lib/agent/token-usage", () => ({
  ...jest.requireActual("@/lib/agent/token-usage"),
  recordTokenUsage: async (runId: string, _u: unknown, model: string) => void tokens.push({ runId, model }),
}));
jest.mock("@/lib/proposals/auto-writeup", () => ({
  putNotesOnRunProposals: async (a: { runId: string; analystId: string | null }) => (noted.push(a), []),
}));
jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  generateText: async (args: Record<string, unknown> & { onStepFinish: (s: unknown) => void }) => {
    calls.push(args);
    // Steps that finish before the call fails (a time limit mid-run).
    for (const step of reply.stepsFirst ?? []) args.onStepFinish(step);
    if (reply.fail) throw new Error("the model is down");
    args.onStepFinish({ usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
    return { text: reply.text, steps: [], response: { messages: [{ role: "assistant", content: reply.text }] }, finishReason: reply.finish ?? "stop", output: reply.output };
  },
}));

// Its one fact, its last output, read where the Portfolio Manager keeps it (lib/agent/context/last-output.ts).
const lastWriteup = jest.fn(async () => "Bought nothing.");
jest.mock("@/lib/agent/portfolio-manager/run", () => ({ lastWriteup: () => lastWriteup() }));

import { runAgentAsRun, type AgentToRun, type RunAgentArgs } from "./run";
import type { RunnableRecord } from "./types";

const RECORD: RunnableRecord = {
  id: "portfolio_manager",
  name: "Test agent",
  does: "Tests.",
  runsWhen: "Never.",
  messageFrom: "The test.",
  subject: "account",
  model: "gpt-5.4",
  maxSteps: 3,
  timeoutMs: 1_000,
  // Any agent's instruction file: the runner reads it as the engine does.
  instructions: ["portfolio-digest.md"],
  context: ["last_output", "message"],
  tools: [],
  output: "A reply.",
};

const FOR = { userId: "user_1", accountId: "acct_1", environment: "PAPER" as const, analystId: "analyst_1" };
const args = (): Omit<RunAgentArgs, "runId"> => ({
  input: { now: new Date("2026-11-18T15:00:00Z"), environment: "PAPER" as const, message: "Go." },
  subject: { kind: "account", userId: FOR.userId, accountId: FOR.accountId, environment: FOR.environment },
  toolset: {},
  source: "test-agent",
});

const agent = (over: Partial<AgentToRun> = {}): AgentToRun => ({ record: RECORD, mode: "DISCOVERY", args, ...over });

beforeEach(() => {
  for (const a of [created, statusWrites, threads, tokens, noted, errors, calls, models]) a.length = 0;
  reply = { text: "Done." };
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("opens the run, saves its thread, token use and notes, and marks it COMPLETE while it is RUNNING", async () => {
  const kept: string[] = [];
  const run = await runAgentAsRun(agent({ keep: async (runId, done) => void kept.push(`${runId}: ${done.text}`) }), FOR);
  expect(created).toEqual([
    expect.objectContaining({ userId: "user_1", accountId: "acct_1", agentConfigId: "analyst_1", status: "RUNNING", mode: "DISCOVERY", environment: "PAPER", parameters: expect.objectContaining({ model: "gpt-5.4" }) }),
  ]);
  // The opening is the run's message, never its reads.
  expect(threads).toEqual([{ runId: "run_1", opening: [{ role: "user", content: [{ type: "text", text: "Go." }] }], messages: [{ role: "assistant", content: "Done." }], steps: [] }]);
  expect(tokens).toEqual([{ runId: "run_1", model: "gpt-5.4" }]);
  expect(noted).toEqual([expect.objectContaining({ runId: "run_1", analystId: "analyst_1" })]);
  expect(kept).toEqual(["run_1: Done."]);
  expect(statusWrites).toEqual([{ where: { id: "run_1", status: "RUNNING" }, data: expect.objectContaining({ status: "COMPLETE" }) }]);
  expect(errors).toEqual([]);
  expect(run).toEqual(expect.objectContaining({ runId: "run_1", status: "COMPLETE", text: "Done." }));
});

it("a run whose first message carries the book opens its thread with get_theses's card of the same read", async () => {
  const onScreen = { ok: true, ui: "thesis-card", summary: "1 thesis (0 active, 1 watching).", data: { theses: [{ ticker: "CEG" }], cards: [{ ticker: "CEG" }] }, sources: [] };
  const reads: unknown[] = [];
  const get_theses = {
    execute: async (input: unknown) => (reads.push(input), onScreen),
    toModelOutput: ({ output }: { output: typeof onScreen }) => ({ type: "json", value: { summary: output.summary, data: { theses: output.data.theses } } }),
  };
  // Discovery's shape: an analyst's run whose context reads its book.
  const record: RunnableRecord = { ...RECORD, id: "discovery", subject: "analyst", instructions: ["discovery.md"], context: ["the_book", "message"] };
  const subject = { kind: "analyst" as const, userId: FOR.userId, accountId: FOR.accountId, environment: FOR.environment, analystId: FOR.analystId };
  await runAgentAsRun(agent({ record, args: () => ({ ...args(), subject, toolset: { get_theses } as never }) }), FOR);
  expect(reads).toEqual([{}]);
  expect(String(calls[0].prompt)).toContain("## Your book (get_theses)\n1 thesis (0 active, 1 watching).");
  expect(String(calls[0].prompt)).not.toContain('"cards"');
  expect(threads[0].opening).toEqual([
    { role: "user", content: [{ type: "text", text: "Go." }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "read-the-book", toolName: "get_theses", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "read-the-book", toolName: "get_theses", output: { type: "json", value: onScreen } }] },
  ]);
});

it("marks it FAILED when the call fails", async () => {
  reply = { text: "", fail: true };
  const run = await runAgentAsRun(agent(), FOR);
  expect(run.status).toBe("FAILED");
  expect(run.error).toBe("the model is down");
  expect(statusWrites[0]).toEqual({ where: { id: "run_1", status: "RUNNING" }, data: expect.objectContaining({ status: "FAILED" }) });
  // Why it failed is kept with the run's parameters, where its page shows it.
  expect(errors).toEqual([{ date: "2026-11-18", error: "the model is down" }]);
});

it("marks it FAILED when it ends without its last reply", async () => {
  reply = { text: "  " };
  expect((await runAgentAsRun(agent(), FOR)).status).toBe("FAILED");
  expect(errors).toEqual([{ date: "2026-11-18", error: "The run ended without its last reply." }]);
});

it("marks it FAILED, with the thread saved, when a block can't be read", async () => {
  lastWriteup.mockRejectedValueOnce(new Error("no database"));
  const run = await runAgentAsRun(agent(), FOR);
  expect(run.status).toBe("FAILED");
  expect(run.error).toBe("no database");
  expect(threads).toHaveLength(1);
  expect(statusWrites).toHaveLength(1);
});

describe("how the model is called, from the record", () => {
  const DATA = { ...RECORD, api: "chat" as const, maxOutputTokens: 500, providerTools: ["web_search" as const], reply: { name: "the_reply", schema: () => ({ type: "object", properties: { said: { type: "string" } }, required: ["said"], additionalProperties: false }) } };

  it("takes its API, its budget, the provider's web search and its reply's schema, and hands back the reply parsed", async () => {
    reply = { text: '{"said":"hi"}', output: { said: "hi" } };
    const run = await runAgentAsRun(agent({ record: DATA }), FOR);
    expect(models[0]).toEqual(expect.objectContaining({ api: "chat" }));
    expect(calls[0]).toEqual(expect.objectContaining({ maxOutputTokens: 500, output: expect.anything() }));
    expect(Object.keys(calls[0].tools as object)).toEqual(["web_search"]);
    expect(run.output).toEqual({ said: "hi" });
    expect(run.status).toBe("COMPLETE");
  });

  it("a reply cut off at its budget fails the run, saying so", async () => {
    reply = { text: '{"said":"h', finish: "length" };
    const run = await runAgentAsRun(agent({ record: DATA }), FOR);
    expect(run.status).toBe("FAILED");
    expect(errors).toEqual([{ date: "2026-11-18", error: "The reply was cut off at its limit." }]);
  });

  it("a run with no message gives the thread no opening; an agent's own reading of its reply replaces the model's messages", async () => {
    reply = { text: '{"said":"hi"}', output: { said: "hi" } };
    await runAgentAsRun(agent({ record: DATA, args: () => ({ ...args(), input: { ...args().input, message: null } }), thread: (done) => [{ role: "assistant", content: `It said ${(done.output as { said: string }).said}.` }] }), FOR);
    expect(threads).toEqual([{ runId: "run_1", opening: [], messages: [{ role: "assistant", content: "It said hi." }], steps: [] }]);
  });

  it("its own save can find the reply unusable: the run fails with why", async () => {
    const run = await runAgentAsRun(agent({ keep: async () => "The reply had no digest." }), FOR);
    expect(run.status).toBe("FAILED");
    expect(run.error).toBe("The reply had no digest.");
    expect(errors).toEqual([{ date: "2026-11-18", error: "The reply had no digest." }]);
  });
});

describe("on Anthropic, and an agent with a save", () => {
  const WRITER_LIKE = { ...RECORD, model: "claude-sonnet-4-6", tools: ["save"], providerTools: ["web_search" as const], searchesPerCall: 4, endsWith: "save" };
  const toolset = { save: { description: "Save.", execute: async () => ({ accepted: true }) } };

  it("marks its instructions and its last tool for the cache, puts the provider's search first with its cap, and stops once its save goes through", async () => {
    await runAgentAsRun(agent({ record: WRITER_LIKE, args: () => ({ ...args(), toolset: toolset as never }) }), FOR);
    const call = calls[0] as { system: { role: string; providerOptions: unknown }; tools: Record<string, { providerOptions?: unknown; args?: { maxUses?: number } }>; stopWhen: Array<(o: { steps: unknown[] }) => boolean> };
    expect(call.system).toEqual(expect.objectContaining({ role: "system", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }));
    expect(Object.keys(call.tools)).toEqual(["web_search", "save"]);
    expect(call.tools.save.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(call.tools.web_search.args).toEqual({ maxUses: 4 });
    const stop = call.stopWhen[2];
    expect(stop({ steps: [{ toolResults: [{ toolName: "save", output: { accepted: false } }] }] })).toBe(false);
    expect(stop({ steps: [{ toolResults: [{ toolName: "save", output: { accepted: true } }] }] })).toBe(true);
  });

  it("a call cut short hands back what it wrote and called, so its thread is kept", async () => {
    reply = { text: "", fail: true, stepsFirst: [{ text: "## Company\nIt makes chips.", toolCalls: [{ toolName: "web_search", input: {} }], response: { messages: [{ role: "assistant", content: "## Company\nIt makes chips." }] }, usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } }] };
    const run = await runAgentAsRun(agent({ record: WRITER_LIKE, args: () => ({ ...args(), toolset: toolset as never }) }), FOR);
    expect(run.error).toBe("the model is down");
    expect(run.texts).toEqual(["## Company\nIt makes chips."]);
    expect(run.toolCalls).toEqual([{ tool: "web_search", input: {} }]);
    expect(threads[0].messages).toEqual([{ role: "assistant", content: "## Company\nIt makes chips." }]);
  });
});
