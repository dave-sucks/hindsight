/**
 * prompt-blocks.test.ts — the Context panel cuts the instructions at the
 * openers the prompt builders print, and reads each provider's request.
 *
 * The four agents' prompts come from their real builders (sample-prompts.ts).
 * The trigger run's stock is CEG on 2026-09-14 from its real Activity rows
 * (ceg-what-was-said-2026-09.json) with a note pinned on it. The Market and
 * portfolio block is its loader's own output (loadPortfolioBlock) on the
 * stand-in book and a digest of Wed Nov 11.
 */
import { generateText, tool, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { promptBlocks } from "@/lib/agent/prompt-blocks";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { rowForModel } from "@/lib/agent/row-for-model";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { viewOfRecord } from "@/lib/agent/run-requests";
import { cachedMessages, cachedSystem } from "@/lib/agent/prompt-cache";
import type { StoredLine } from "@/lib/thesis/activity-feed";
import type { SharedNoteRow } from "@/lib/agent/shared-notes";
import type { Trigger } from "@/lib/agent/triggers/types";
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";
import { loadPortfolioBlock } from "@/lib/agent/portfolio-block";

jest.mock("@/lib/prisma", () => ({ prisma: { portfolioDigest: { findFirst: async () => ({ narrative: "Most of the book rides one theme; two sales wait on your decision.", createdAt: new Date("2026-11-12T01:00:00Z") }) } } }));
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => jest.requireActual("@/lib/agent/__fixtures__/portfolio-snapshot-standin").STANDIN_SNAPSHOT }));

const labels = (text: string) => promptBlocks(text).map((b) => b.label);
const sum = (text: string) => promptBlocks(text).reduce((n, b) => n + b.chars, 0);

describe("the four agents' prompts, from their builders", () => {
  it.each([
    ["morning run", "daily", ["Instructions", "Analyst: Secular Compounder", "House rules"]],
    ["trigger run", "tactical", ["Instructions", "Analyst: PEAD Specialist", "$HPE row", "House rules"]],
    ["chat", "chat", ["Instructions", "Analyst: Secular Compounder", "House rules"]],
    ["Writer", "writer", ["Instructions", "Analyst: Research Analyst", "House rules"]],
  ] as const)("the %s: its instructions, the brief, the house rules, every character in one part", (_n, key, want) => {
    const text = SAMPLE_PROMPTS[key]();
    const blocks = promptBlocks(text);
    expect(blocks.map((b) => b.label)).toEqual(want);
    expect(blocks.find((b) => b.label === "House rules")).toMatchObject({ text: HOUSE_RULES, part: "house" });
    expect(blocks[1]).toMatchObject({ part: "analyst" });
    expect(blocks[1].text).toMatch(/^## Analyst: .+\n\n(?:[\s\S]*\n\n)?Rules:\n(- .+\n?)+$/);
    expect(blocks[0].text).toContain(`[See ${want[1]}]`);
    expect(sum(text)).toBe(text.length);
  });
});

describe("the Market and portfolio block", () => {
  // As its loader prints it for 8 AM ET, Thu Nov 12.
  let BLOCK = "";
  beforeAll(async () => {
    BLOCK = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: new Date("2026-11-12T13:00:00Z") });
    expect(BLOCK).toMatch(/^## Market and portfolio\n\n### Portfolio snapshot\n/);
  });

  it("one part, its ### parts its sections, last in the morning run's prompt and just before the trigger run's row", () => {
    const daily = `${SAMPLE_PROMPTS.daily()}\n\n${BLOCK}`;
    const block = promptBlocks(daily).find((b) => b.label === "Market and portfolio")!;
    expect(block).toMatchObject({ part: "portfolio", text: BLOCK, chars: BLOCK.length });
    expect(block.sections!.map((s) => s.label)).toEqual(["Portfolio snapshot", "Portfolio digest (written Wed, Nov 11, 8:00 PM ET)"]);
    expect(block.sections!.map((s) => s.text).join("")).toBe(BLOCK);
    expect(sum(daily)).toBe(daily.length);

    const tactical = SAMPLE_PROMPTS.tactical();
    const banner = tactical.indexOf("═══════════════════════════════════════════════════════════════════\n$HPE, its row");
    const text = `${tactical.slice(0, banner)}${BLOCK}\n\n${tactical.slice(banner)}`;
    expect(labels(text)).toEqual(["Instructions", "Analyst: PEAD Specialist", "Market and portfolio", "$HPE row", "House rules"]);
    expect(promptBlocks(text).find((b) => b.label === "Market and portfolio")!.text).toBe(BLOCK);
    expect(sum(text)).toBe(text.length);
  });

  it("on the run page: one category, its sections by heading", () => {
    const body = { model: "gpt-5.4", messages: [{ role: "system", content: `${SAMPLE_PROMPTS.daily()}\n\n${BLOCK}` }, { role: "user", content: "Start." }] };
    const view = viewOfRecord({ v: 1, call: "Main", source: "morning-research", model: "gpt-5.4", startedAt: "", endedAt: "", requests: [body] });
    const market = view.categories.find((c) => c.name === "Market and portfolio")!;
    expect(market.part).toBe("portfolio");
    expect(market.sections.map((s) => [s.label, s.chars])).toEqual(promptBlocks(body.messages[0].content).find((b) => b.sections)!.sections!.map((s) => [s.label, s.text.length]));
  });
});

describe("CEG's trigger run on 09-14: its row, the note pinned on it and its Activity lines", () => {
  const fx = raw as unknown as { runs: { trigger0914_1530: { loadedAt: string } }; thesis0918: { id: string }; updates: Array<StoredLine & { timestamp: string; runMode?: string }> };
  const now = new Date(fx.runs.trigger0914_1530.loadedAt);
  const rows = fx.updates
    .filter((u) => new Date(u.timestamp).getTime() < now.getTime())
    .map((u) => ({ ...u, thesisId: fx.thesis0918.id, timestamp: new Date(u.timestamp), fieldChanges: u.fieldChanges ?? {}, tradeId: null, signalIds: [], positionAtTime: null, run: u.runMode ? { mode: u.runMode } : null })) as unknown as StoredLine[];
  const note: SharedNoteRow = {
    id: "note_power", author: "PORTFOLIO_MANAGER", runId: "run_pm", body: "CEG and VST trade together on power demand.",
    audience: "STOCKS", analystId: null, tickers: ["CEG", "VST"], eventDate: null,
    pinnedUntil: new Date(now.getTime() + 3 * 86_400_000), createdAt: new Date(now.getTime() - 3_600_000),
  };
  const context = stockContextFor({ ticker: "CEG", rows, notes: [note], now }).text;
  const trail = { id: "trail", action: "EXIT", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, rationale: "Gave back 8% from the high." } as Trigger;
  const prompt = buildTacticalSystemPrompt({
    analyst: { name: "Secular Compounder", analystPrompt: null },
    stock: { ticker: "CEG", direction: "LONG", row: rowForModel({ id: fx.thesis0918.id, ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", context, coreBelief: "CEG compounds." }, { named: true, size: "short", setupLines: true }) as never },
    trigger: trail,
    position: { peakPrice: 303.4 },
    fired: { price: 264.6 },
  });

  it("three parts of the read, their sizes as sent, adding up to the prompt", () => {
    const blocks = promptBlocks(prompt);
    expect(blocks.map((b) => [b.label, b.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Secular Compounder", "analyst"],
      ["$CEG row", "read"],
      ["Notes on $CEG", "read"],
      ["Activity on $CEG", "read"],
      ["House rules", "house"],
    ]);
    const by = (l: string) => blocks.find((b) => b.label === l)!;
    expect(by("Notes on $CEG").text).toMatch(/^PINNED ON \$CEG: notes to more than this stock/);
    expect(by("Activity on $CEG").text).toMatch(/^WHAT'S BEEN SAID ON \$CEG — /);
    expect(by("$CEG row").text).toContain('"said": "[See Notes on $CEG and Activity on $CEG]"');
    expect(by("Notes on $CEG").chars + by("Activity on $CEG").chars).toBe(JSON.stringify(context).length);
    expect(sum(prompt)).toBe(prompt.length);
  });
});

describe("when the openers aren't there", () => {
  it("a prompt with none of them is one part", () => {
    const text = "You are a helpful agent.\n\n## How to work\nDo it.";
    expect(promptBlocks(text)).toEqual([{ label: "Instructions", part: "job", text, chars: text.length }]);
  });

  it("a row quoted inside the analyst's strategy is not split, and leaves no notes or Activity part behind", () => {
    const quoted = `═══════════════\n$XYZ, its row (get_theses)\n═══════════════\n${JSON.stringify({ said: "A note.\n\nWHAT'S BEEN SAID ON $XYZ — lines" }, null, 2)}`;
    const text = `Do the job.\n\n## Analyst: Quoter\n\nMy strategy:\n${quoted}\n\nRules:\n- Hold.`;
    expect(labels(text)).toEqual(["Instructions", "Analyst: Quoter"]);
    expect(sum(text)).toBe(text.length);
  });

  it("an analyst heading with no Rules before the next heading claims nothing past it", () => {
    expect(labels("## Analyst: Old\n\nA strategy.\n\n## Your job\nWork.\n\nRules:\n- Someone else's.")).toEqual(["Instructions"]);
  });
});

describe("each provider's request, as the panel reads it", () => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const tools = { get_theses: tool({ description: "Read the book.", inputSchema: z.object({ tickers: z.array(z.string()) }) }) };
  const record = (source: string, body: string) => ({ v: 1 as const, call: "Main", source, model: "m", startedAt: "", endedAt: "", requests: [JSON.parse(body)] });

  it("the morning run (Chat Completions): its instructions in parts, its first message, its tool menu", async () => {
    const sent: string[] = [];
    const openai = createOpenAI({ apiKey: "t", fetch: (async (_u: string, i: RequestInit) => (sent.push(String(i.body)), json({ id: "c", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Done." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))) as typeof fetch });
    await generateText({ model: openai.chat("gpt-5.4"), system: SAMPLE_PROMPTS.daily(), prompt: "It's the start of the trading day.", tools });
    const view = viewOfRecord(record("morning-research", sent[0]));
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Secular Compounder", "analyst"],
      ["House rules", "house"],
      ["First message", "read"],
      ["Tool menu", "tools"],
    ]);
    expect(view.categories.slice(0, 3).reduce((n, c) => n + c.chars, 0)).toBe(SAMPLE_PROMPTS.daily().length);
  });

  it("a chat's second message (Anthropic): the conversation so far as one part, then the new message", async () => {
    const sent: string[] = [];
    const anthropic = createAnthropic({ apiKey: "t", fetch: (async (_u: string, i: RequestInit) => (sent.push(String(i.body)), json({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn", content: [{ type: "text", text: "Because the case is intact." }], usage: { input_tokens: 1, output_tokens: 1 } }))) as typeof fetch });
    const history: ModelMessage[] = [
      { role: "user", content: "How is V doing?" },
      { role: "assistant", content: "Under its floor with the market." },
      { role: "user", content: "Why hold it?" },
    ];
    await generateText({ model: anthropic("claude-sonnet-4-6"), system: cachedSystem("anthropic", SAMPLE_PROMPTS.chat()), messages: cachedMessages("anthropic", history), tools });
    const view = viewOfRecord(record("agent/principal", sent[0]));
    expect(view.categories.map((c) => c.name)).toEqual(["Instructions", "Analyst: Secular Compounder", "House rules", "The conversation so far", "This message", "Tool menu"]);
    expect(view.categories[4].sections.map((s) => s.text).join("")).toBe("Why hold it?");
    expect(view.categories[3].chars).toBe("How is V doing?".length + "Under its floor with the market.".length);
  });
});
