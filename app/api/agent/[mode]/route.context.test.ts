/**
 * Each call of the agent route keeps what it started with: a research run's
 * first turn, its follow-ups, each chat message. Through the real route and
 * the SDK's own streaming loop, with the SDK's stand-in model handing back
 * the request it was given; the run page shows the newest record.
 */
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { prismaDouble } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** The stand-in model: one short reply, and the request as the messages it was handed. */
const model = new MockLanguageModelV3({
  doStream: async (opts: { prompt: Array<{ role: string; content: unknown }> }) => ({
    stream: convertArrayToReadableStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Noted." },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ]),
    request: { body: { model: "gpt-5.4", messages: opts.prompt.map((m) => ({ role: m.role, content: m.content })) } },
  }),
} as never);

async function post(mode: string, body: Record<string, unknown>, db: ReturnType<typeof prismaDouble>) {
  const pending: Promise<unknown>[] = [];
  let res: Response | undefined;
  let mod: typeof import("@/lib/agent/run-requests") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) } }) }));
    jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "acct_1", getUserRole: async () => "OWNER" }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => model }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
    const { POST } = await import("@/app/api/agent/[mode]/route");
    mod = await import("@/lib/agent/run-requests");
    res = await POST(new Request(`http://localhost/api/agent/${mode}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ mode }) });
    await res.text();
    for (let i = 0; i < pending.length; i++) await pending[i];
  });
  for (const m of ["@/lib/prisma", "@/lib/supabase/server", "@/lib/auth/account", "@/lib/actions/api-keys.actions", "@vercel/functions", "@ai-sdk/openai", "@/lib/agent/tools"]) jest.dontMock(m);
  return { status: res!.status, requests: mod! };
}

const user = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });

describe("the agent route's calls, each kept for the run's Context", () => {
  it("a research run: its first turn keeps its first request, and its newest follow-up replaces the one before; the page shows the newest, the conversation before the new message as one part", async () => {
    const db = prismaDouble({
      researchRun: [{ id: "run_1", userId: "user_1", accountId: "acct_1", environment: "PAPER", agentConfigId: null, status: "RUNNING", mode: "MANUAL" }],
      runMessage: [],
      runEvent: [],
    });
    const said = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Noted." }] };
    await post("research-run", { runId: "run_1", messages: [user("m1", "Run the review.")] }, db);
    await post("research-run", { runId: "run_1", messages: [user("m1", "Run the review."), said, user("m2", "Why hold V?")] }, db);
    const second = await post(
      "research-run",
      { runId: "run_1", messages: [user("m1", "Run the review."), said, user("m2", "Why hold V?"), { ...said, id: "a2" }, user("m3", "And AVGO?")] },
      db,
    );
    const kept = (db.store.runMessage as Array<{ runId: string; role: string; content: string }>).filter((m) => m.role === "request");
    expect(kept.map((m) => [m.runId, (JSON.parse(m.content) as RequestRecord).call])).toEqual([
      ["run_1", "Run"],
      ["run_1", "Follow-up"],
    ]);
    const first = JSON.parse(kept[0].content) as RequestRecord;
    expect(first).toMatchObject({ source: "agent/research-run", of: 1 });
    expect(second.requests.viewOfRecord(first).categories.map((c) => c.name)).toEqual(["Instructions", "Analyst: Research Analyst", "House rules", "First message"]);

    // The page: the newest only. (The database stamps each row's createdAt; the double doesn't.)
    (db.store.runMessage as Array<{ createdAt?: Date }>).forEach((m, i) => (m.createdAt = new Date(Date.UTC(2026, 10, 12, 14, 0, i))));
    let latest: Awaited<ReturnType<typeof second.requests.loadRunRequests>> = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      latest = await (await import("@/lib/agent/run-requests")).loadRunRequests("run_1", { latest: true });
    });
    jest.dontMock("@/lib/prisma");
    expect(latest).toHaveLength(1);
    expect(latest[0].call).toBe("Follow-up");
    expect(latest[0].categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Research Analyst", "analyst"],
      ["House rules", "house"],
      ["The conversation so far", null],
      ["This message", "read"],
    ]);
    expect(latest[0].categories[4].sections.map((s) => s.text).join("")).toContain("And AVGO?");
    expect(latest[0].categories[3].sections.map((s) => s.text).join("")).toContain("Why hold V?");
  });

  it("a builder chat has no run, and keeps nothing", async () => {
    const db = prismaDouble({ researchRun: [], runMessage: [], runEvent: [] });
    await post("builder", { messages: [user("m1", "Build me a momentum analyst.")] }, db);
    expect(db.store.runMessage).toEqual([]);
  });
});
