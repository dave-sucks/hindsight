/**
 * screen-outputs.test.ts — the model reads get_theses without its cards;
 * the screen and a saved run keep them (docs/plans/AGENT_ARCHITECTURE.md,
 * step 4a).
 *
 * Through the real get_theses execute, its real model-output hook, and the
 * SDK's own loop, so the test fails if the hook is not wired to what the
 * model is actually sent.
 */
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { replayTool, thesisRow } from "@/lib/replay";
import { withScreenOutputs } from "@/lib/agent/screen-outputs";

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
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [ceg()] },
      args: { tickers: ["CEG"] },
      quotes: { CEG: 260 },
    });
    const data = result.data as { cards?: unknown[]; theses?: unknown[] };
    expect(data.theses?.length).toBe(1);
    expect(data.cards?.length).toBe(1);
  });

  it("the model is sent the rows without the cards, and the saved thread gets them back", async () => {
    // The real tool instance, so its real toModelOutput is what the SDK calls.
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [ceg()] },
      args: { tickers: ["CEG"] },
      quotes: { CEG: 260 },
    });
    const { getTheses } = await import("@/lib/agent/tools/get-theses");
    const real = getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as { toModelOutput?: unknown; description?: string; inputSchema: unknown };

    const sent: unknown[] = [];
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (opts: { prompt: unknown }) => {
        sent.push(opts.prompt);
        call++;
        return call === 1
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "get_theses", input: JSON.stringify({ tickers: ["CEG"] }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] }
          : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] };
      },
    } as never);
    const out = await generateText({
      model,
      prompt: "read the book",
      // The real description, schema and model-output hook; an execute that
      // returns the replayed result, so no database is needed here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: { get_theses: { ...real, execute: async () => result } } as any,
      stopWhen: stepCountIs(2),
    });

    // What the model was sent on the step after the call: no cards.
    const second = JSON.stringify(sent[1]);
    expect(second).toContain("CEG");
    expect(second).not.toContain('"cards"');

    // What a server-side run saves for /runs/[id]: the cards are back.
    const saved = JSON.stringify(withScreenOutputs(out.response.messages as ModelMessage[], out.steps as never));
    expect(saved).toContain('"cards"');
    expect(JSON.stringify(out.response.messages)).not.toContain('"cards"');
  });
});
