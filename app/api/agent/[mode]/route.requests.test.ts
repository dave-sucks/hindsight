/**
 * The agent route keeps what a turn sent when the turn hits its time limit,
 * and writes only to a run of the caller's own account.
 *
 * A research run through the real route and the SDK's own streaming loop: the
 * first request is answered with a tool call, the second never gets a reply,
 * and the turn's limit (770 seconds, stood in for so it fires at once) stops
 * it. Before the limit, the platform killed the function at 800 seconds and
 * nothing of the turn was kept.
 */
import { tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { prismaDouble } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests-format";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

async function turn(runId: string) {
  const db = prismaDouble({
    researchRun: [
      { id: "run_mine", userId: "user_1", accountId: "acct_1", environment: "PAPER", agentConfigId: null, status: "RUNNING", mode: "MANUAL" },
      { id: "run_theirs", userId: "user_2", accountId: "acct_2", environment: "LIVE", agentConfigId: null, status: "COMPLETE", mode: "MANUAL" },
    ],
    runMessage: [],
    runEvent: [],
  });
  const pending: Promise<unknown>[] = [];
  const limits: number[] = [];
  const limit = new AbortController();
  const spy = jest.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => (limits.push(ms), limit.signal));
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async (opts: { abortSignal?: AbortSignal }) => {
      calls++;
      const body = { model: "gpt-5.4", input: [{ role: "user", content: "Run the review." }], n: calls };
      if (calls === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "c1", toolName: "get_theses", input: "{}" },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ]),
          request: { body },
        };
      }
      // The second request: no reply comes, and the turn's limit fires.
      const stream = new ReadableStream({ start: (c) => opts.abortSignal?.addEventListener("abort", () => c.error(opts.abortSignal?.reason)) });
      setTimeout(() => limit.abort(new DOMException("The operation timed out.", "TimeoutError")), 0);
      return { stream, request: { body } };
    },
  } as never);

  let res: Response | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) } }) }));
    jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "acct_1", getUserRole: async () => "OWNER" }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => model }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({ get_theses: tool({ description: "Read the book.", inputSchema: z.object({}), execute: async () => ({ ok: true, summary: "Read" }) }) }),
    }));
    const { POST } = await import("@/app/api/agent/[mode]/route");
    res = await POST(
      new Request("http://localhost/api/agent/research-run", { method: "POST", body: JSON.stringify({ runId, messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Run the review." }] }] }) }),
      { params: Promise.resolve({ mode: "research-run" }) },
    );
  });
  const text = await res!.text();
  for (let i = 0; i < pending.length; i++) await pending[i];
  spy.mockRestore();
  for (const m of ["@/lib/prisma", "@/lib/supabase/server", "@/lib/auth/account", "@/lib/actions/api-keys.actions", "@vercel/functions", "@ai-sdk/openai", "@/lib/agent/tools"]) jest.dontMock(m);
  const rows = (m: string) => (db.store as Record<string, Array<Record<string, unknown>>>)[m] ?? [];
  return { status: res!.status, text, limits, calls, runs: rows("researchRun"), messages: rows("runMessage") as Array<{ runId: string; role: string; content: string }>, events: rows("runEvent") };
}

describe("a turn of the agent route at its time limit", () => {
  it("stops itself at 770 seconds and keeps the requests that got a reply, with why it stopped; the run is marked failed", async () => {
    const r = await turn("run_mine");
    expect(r.status).toBe(200);
    expect(r.limits).toContain(770_000);
    expect(r.calls).toBe(2);
    const kept = r.messages.filter((m) => m.role === "request");
    expect(kept).toHaveLength(1);
    const record = JSON.parse(kept[0].content) as RequestRecord;
    expect(record).toMatchObject({ call: "Run", source: "agent/research-run", error: "Stopped at the 770s time limit before the call finished." });
    // The first request, which got its reply; the second was still waiting when the limit came.
    expect(record.steps).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ id: "run_mine", status: "FAILED" });
    expect(r.events.map((e) => e.message)).toEqual(["Stopped at the 770s time limit before the call finished."]);
  });

  it("a run id from another account is refused, and nothing is written to it", async () => {
    const r = await turn("run_theirs");
    expect(r.status).toBe(404);
    expect(r.calls).toBe(0);
    expect(r.messages).toEqual([]);
    expect(r.runs.find((x) => x.id === "run_theirs")).toMatchObject({ status: "COMPLETE" });
  });
});
