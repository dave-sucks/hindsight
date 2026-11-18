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
let reply: { text: string; fail?: boolean; finish?: string; output?: unknown } = { text: "Done." };
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
    if (reply.fail) throw new Error("the model is down");
    args.onStepFinish({ usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
    return { text: reply.text, steps: [], response: { messages: [{ role: "assistant", content: reply.text }] }, finishReason: reply.finish ?? "stop", output: reply.output };
  },
}));

import { runAgentAsRun, type AgentToRun, type RunAgentArgs } from "./run";
import type { RunnableRecord } from "./types";

const RECORD: RunnableRecord = {
  id: "portfolio_manager",
  name: "Test agent",
  does: "Tests.",
  runsWhen: "Never.",
  messageFrom: "The test.",
  model: "gpt-5.4",
  maxSteps: 3,
  timeoutMs: 1_000,
  instructions: [{ own: "Do the job." }],
  context: ["last_output", "message"],
  tools: [],
  output: "A reply.",
};

const FOR = { userId: "user_1", accountId: "acct_1", environment: "PAPER" as const, analystId: "analyst_1" };
const args = (): Omit<RunAgentArgs, "runId"> => ({ input: { now: new Date("2026-11-18T15:00:00Z"), environment: "PAPER" as const, message: "Go." }, sources: { context: { last_output: async () => "Bought nothing." } }, toolset: {}, source: "test-agent" });

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
  const run = await runAgentAsRun(agent({ args: () => ({ ...args(), sources: { context: { last_output: async () => Promise.reject(new Error("no database")) } } }) }), FOR);
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
