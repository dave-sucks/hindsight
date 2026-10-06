/**
 * run-thread.test.ts — every run saves its conversation one way, and the
 * saved thread keeps what the screen saw (docs/plans/AGENT_ARCHITECTURE.md,
 * step 4a).
 *
 * The model reads get_theses without its cards; the screen and a saved run
 * keep them. The restore was pasted into the morning run twice and discovery
 * once; the trigger run had none, so a trigger run that read get_theses
 * would have replayed without its card.
 *
 * Through the real get_theses execute, its real model-output hook, the SDK's
 * own loop and the real save.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { replayTool, thesisRow } from "@/lib/replay";
import type { RunStep } from "@/lib/agent/run-thread";
import trigger from "@/lib/agent/__fixtures__/trigger-run-get-theses-2026-08-28.json";

/** The real save, with the database stood in for (the replay harness keeps its own). */
async function save(runId: string, thread: { opening: unknown[]; messages: unknown[] | undefined; steps: ReadonlyArray<RunStep> }) {
  const created: Array<{ runId: string; role: string; content: string }> = [];
  let mod: typeof import("@/lib/agent/run-thread") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        runMessage: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }: { data: { runId: string; role: string; content: string } }) => (created.push(data), data),
        },
        $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      },
    }));
    mod = await import("@/lib/agent/run-thread");
  });
  await mod!.saveRunThread(runId, thread, "test");
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ runId, role: "thread" });
  return created[0].content;
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** The SDK's loop over the real get_theses: one recorded call, then a closing line. */
async function runOver(callInput: unknown, toolCallId: string, result: unknown) {
  // Only the tool's description, schema and hook are used; its database is never reached.
  let mod: typeof import("@/lib/agent/tools/get-theses") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    mod = await import("@/lib/agent/tools/get-theses");
  });
  const real = mod!.getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as { toModelOutput?: unknown; description?: string; inputSchema: unknown };
  const sent: unknown[] = [];
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (opts: { prompt: unknown }) => {
      sent.push(opts.prompt);
      call++;
      return call === 1
        ? { content: [{ type: "tool-call", toolCallId, toolName: "get_theses", input: JSON.stringify(callInput) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  } as never);
  const out = await generateText({
    model,
    prompt: "read the stock",
    // The real description, schema and model-output hook; an execute that
    // returns the recorded result, so no database is needed here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: { get_theses: { ...real, execute: async () => result } } as any,
    stopWhen: stepCountIs(2),
  });
  return { out, sent };
}

const ceg = () =>
  thesisRow({
    id: "t_ceg",
    ticker: "CEG",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 250,
    targetPrice: 340,
    stopLoss: 220,
    snapshot: { text: "Nuclear baseload under long contracts; the research text the card repeats.", citations: [] },
    triggers: [
      { id: "t_buy", action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 250 }, rationale: "Buy the reclaim.", cooldownDays: 1 },
      { id: "t_rev", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 1 }, rationale: "Daily.", cooldownDays: 1 },
    ],
  });

describe("get_theses: the cards are for the screen", () => {
  it("execute still returns the cards (the chat's carousel)", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: { tickers: ["CEG"] }, quotes: { CEG: 260 } });
    const data = result.data as { cards?: unknown[]; theses?: unknown[] };
    expect(data.theses?.length).toBe(1);
    expect(data.cards?.length).toBe(1);
  });

  it("the model is sent the rows without the cards, and the saved thread gets them back", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: { tickers: ["CEG"] }, quotes: { CEG: 260 } });
    const { out, sent } = await runOver({ tickers: ["CEG"] }, "c1", result);

    const second = JSON.stringify(sent[1]);
    expect(second).toContain("CEG");
    expect(second).not.toContain('"cards"');
    expect(JSON.stringify(out.response.messages)).not.toContain('"cards"');

    expect(await save("run_morning", { opening: [{ role: "user", content: "go" }], messages: out.response.messages, steps: out.steps as never })).toContain('"cards"');
  });
});

describe("the trigger run's saved thread (CYTK, 2026-08-28)", () => {
  it("keeps the card its get_theses read showed", async () => {
    const { out } = await runOver(trigger.call.input, trigger.call.toolCallId, trigger.result);
    expect(JSON.stringify(out.response.messages)).not.toContain('"cards"');

    const thread = JSON.parse(await save("run_cytk", { opening: [{ role: "user", content: "CYTK's trigger fired." }], messages: out.response.messages, steps: out.steps as never })) as Array<{ role: string; content: unknown }>;
    const toolTurn = thread.find((m) => m.role === "tool") as { content: Array<{ output: { value: { data: { cards: Array<{ ticker: string }> } } } }> };
    expect(toolTurn.content[0].output.value.data.cards.map((c) => c.ticker)).toEqual(["CYTK"]);
  });

  it("rebuilds the messages from the steps when the SDK hands back none", async () => {
    const { out } = await runOver(trigger.call.input, trigger.call.toolCallId, trigger.result);
    expect(await save("run_tail", { opening: [], messages: [], steps: out.steps as never })).toContain('"cards"');
  });
});

describe("one save", () => {
  /** Every source file under these folders, tests left out. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name === "generated" || name.startsWith(".")) return [];
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("only run-thread.ts writes a run's saved conversation", () => {
    const writers = [...sources("lib"), ...sources("app")].filter((f) =>
      /runMessage\.(create|upsert|createMany)\([\s\S]{0,240}role:\s*["']thread["']/.test(readFileSync(f, "utf8")),
    );
    expect(writers).toEqual([join("lib", "agent", "run-thread.ts")]);
  });
});
