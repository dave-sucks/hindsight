/**
 * The Portfolio Reviewer's run keeps exactly what its model calls sent.
 *
 * Through the 8 PM job's own handler on Tue Nov 10's facts as the job builds
 * them (digest-facts-sample.ts) and that night's four waiting sales
 * (account-2026-11-10.json, stand-in amounts), with the real reviewer, the real SDK and the
 * real OpenAI provider; only `fetch` is stood in for. The first reply leaves
 * out its digest, so the reviewer asks once more: two model calls, "Main" and
 * "Retry", each kept on the run beside its thread.
 */
import { SAMPLE_FACTS } from "@/lib/agent/__fixtures__/digest-facts-sample";
import nov10 from "@/lib/agent/__fixtures__/account-2026-11-10.json";
import { decodeCalls, type RequestRecord } from "@/lib/agent/run-requests-format";
import { viewOfCall } from "@/lib/agent/run-requests-view";

const ACCOUNT = "account_live";
const BRIEF = "Four sales wait while the analysts' own notes on two of them call the case unchanged.";

type Handler = (ctx: { step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
type Row = { id?: string; runId: string; role: string; content: string };

/** The two replies: the brief alone, then the brief and the digest. */
function reply(n: number) {
  const content = n === 1 ? `## Brief\n${BRIEF}` : `## Brief\n${BRIEF}\n\n## Digest\nMU waits for your decision.`;
  return { id: `c${n}`, object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}

async function runTheJob() {
  const sent: string[] = [];
  const urls: string[] = [];
  const messages: Row[] = [];
  const upsert = jest.fn(async () => ({}));
  const runUpdate = jest.fn(async () => ({}));
  let handler: Handler | null = null;
  let prompt = "";
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, h: Handler) => ((handler = h), {}), send: jest.fn() },
    }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        researchRun: { findMany: jest.fn(async () => [{ accountId: ACCOUNT, environment: "LIVE" }]), create: jest.fn(async () => ({ id: "run_review" })), update: runUpdate },
        position: { findMany: jest.fn(async () => []) },
        agentConfig: { findMany: jest.fn(async () => [{ accountId: ACCOUNT, tradingEnvironment: "LIVE" }]) },
        portfolioDigest: { upsert },
        // The thread and each call's record are RunMessage rows; saving the thread replaces only the thread.
        runMessage: {
          create: jest.fn(async ({ data }: { data: Row }) => {
            const row = { ...data, id: `msg_${messages.length}` };
            messages.push(row);
            return row;
          }),
          findMany: jest.fn(async ({ where }: { where: { runId: string; role: string } }) => messages.filter((m) => m.runId === where.runId && m.role === where.role)),
          deleteMany: jest.fn(async ({ where }: { where: { runId: string; role: string } }) => {
            for (let i = messages.length - 1; i >= 0; i--) if (messages[i].runId === where.runId && messages[i].role === where.role) messages.splice(i, 1);
          }),
        },
        $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      },
    }));
    // The real provider; only the network is stood in for.
    jest.doMock("@ai-sdk/openai", () => {
      const actual = jest.requireActual("@ai-sdk/openai");
      const fakeFetch = async (url: string, init: RequestInit) => {
        urls.push(url);
        sent.push(String(init.body));
        return new Response(JSON.stringify(reply(sent.length)), { status: 200, headers: { "content-type": "application/json" } });
      };
      return { ...actual, openai: actual.createOpenAI({ apiKey: "test", fetch: fakeFetch }) };
    });
    jest.doMock("@/lib/portfolio/digest-facts-builder", () => ({ buildDigestFacts: async () => SAMPLE_FACTS }));
    jest.doMock("@/lib/portfolio/load-sale-queue", () => ({
      loadWaitingForReview: async () => ({ pending: nov10.pending.map((o) => ({ ticker: o.symbol, side: o.side, intent: o.intent, quantity: o.quantity, analystName: o.analystName })), sales: [] }),
    }));
    jest.doMock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
    jest.doMock("@/lib/agent/token-usage", () => ({ ...jest.requireActual("@/lib/agent/token-usage"), recordTokenUsage: jest.fn(async () => {}) }));
    await import("./portfolio-digest");
    prompt = (await import("@/lib/agent/portfolio-reviewer")).REVIEWER_PROMPT;
  });
  await handler!({ step: { run: async (_name, fn) => JSON.parse(JSON.stringify((await fn()) ?? null)) } });
  for (const m of ["@/lib/inngest/client", "@/lib/prisma", "@ai-sdk/openai", "@/lib/portfolio/digest-facts-builder", "@/lib/portfolio/load-sale-queue", "@/lib/auth/account", "@/lib/agent/token-usage"]) jest.dontMock(m);
  return { sent, urls, messages, upsert, runUpdate, prompt };
}

describe("the Portfolio Reviewer keeps what its model calls sent", () => {
  it("Nov 10: the call and its retry, each rebuilt byte for byte, kept on the run beside its thread", async () => {
    const r = await runTheJob();
    expect(r.urls).toEqual(["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
    expect(r.runUpdate).toHaveBeenCalledWith({ where: { id: "run_review" }, data: expect.objectContaining({ status: "COMPLETE" }) });
    expect((r.upsert.mock.calls[0] as unknown as [{ create: { brief: string } }])[0].create.brief).toBe(BRIEF);

    // Two calls kept, and the thread saved after them left them in place.
    expect(r.messages.map((m) => [m.runId, m.role])).toEqual([["run_review", "request"], ["run_review", "request"], ["run_review", "thread"]]);
    const kept = r.messages.filter((m) => m.role === "request").map((m) => ({ id: m.id!, record: JSON.parse(m.content) as RequestRecord }));
    const [main, retry] = kept.map((k) => k.record);
    expect(main).toMatchObject({ call: "Main", source: "portfolio-reviewer", provider: "openai.chat", model: "gpt-5.4", list: "messages" });
    // The retry resends the conversation, so it is kept against the main call's request.
    expect(retry).toMatchObject({ call: "Retry", source: "portfolio-reviewer", after: kept[0].id });
    const bodies = decodeCalls(kept);
    expect([...bodies.get(kept[0].id)!, ...bodies.get(kept[1].id)!].map((b) => JSON.stringify(b))).toEqual(r.sent);

    // On the run page: its instructions (no blocks of their own), the facts, and on the retry the ask.
    const mainView = viewOfCall(main);
    expect(mainView.pieces.map((p) => p.label)).toEqual(["Instructions", "First message"]);
    expect(mainView.pieces[0].text).toBe(r.prompt);
    expect(mainView.pieces[1].text).toMatch(/^FACTS:\nDATE: 2026-11-10\nVALUE/);
    expect(mainView.pieces[1].text).toContain("SALES WAITING FOR THE OWNER'S DECISION");
    const retryView = viewOfCall(retry, retry.refs ?? {}, bodies.get(kept[1].id));
    expect(retryView.pieces.map((p) => p.label)).toEqual(["Instructions", "First message", "Added message"]);
    expect(retryView.pieces[2].text).toBe('The reply needs the two headings, "## Brief" and then "## Digest". Reply again in the same form, with both parts.');
  });
});
