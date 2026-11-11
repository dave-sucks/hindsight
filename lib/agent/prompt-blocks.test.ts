/**
 * prompt-blocks.test.ts — the instructions chip splits at the openers the
 * prompt builders print, and every opener is held to what they print.
 *
 * The four agents' prompts come from their real builders (sample-prompts.ts),
 * each with the Market and portfolio block of the sample day (the Nov 10
 * close's real numbers), here rendered with a note to the account. The
 * trigger run's stock is CEG on 2026-09-14, from its real Activity rows
 * (ceg-what-was-said-2026-09.json) with a note pinned on it, through the same
 * stockContextFor and rowForModel a trigger run uses.
 */
import { promptBlocks } from "@/lib/agent/prompt-blocks";
import { SAMPLE_BLOCK_PARTS, SAMPLE_MARKET_AND_PORTFOLIO, SAMPLE_NOW, SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { marketAndPortfolioBlock } from "@/lib/agent/market-and-portfolio";
import { runNoteLine } from "@/lib/agent/shared-notes";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { rowForModel } from "@/lib/agent/row-for-model";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { viewOfCall } from "@/lib/agent/run-requests-view";
import type { StoredLine } from "@/lib/thesis/activity-feed";
import type { SharedNoteRow } from "@/lib/agent/shared-notes";
import type { Trigger } from "@/lib/agent/triggers/types";
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const fx = raw as unknown as { runs: { trigger0914_1530: { loadedAt: string } }; thesis0918: { id: string }; updates: Array<StoredLine & { timestamp: string; runMode?: string }> };

const labels = (text: string) => promptBlocks(text).map((b) => b.label);
const sum = (text: string) => promptBlocks(text).reduce((s, b) => s + b.chars, 0);

/** The block's parts in the order #947's BLOCK_PARTS prints them. The sample day has no notes. */
const MARKET = ["Market brief", "Market numbers", "Portfolio brief", "Portfolio numbers"];
/** A note to the account (a stand-in: none is written yet), and the sample day's block printed with it. */
const ACCOUNT_NOTE: SharedNoteRow = {
  id: "note_fed", author: "PORTFOLIO_MANAGER", runId: "run_pm", body: "The Fed speaks Wednesday; size buys for a swing.",
  audience: "ACCOUNT", analystId: null, tickers: [], eventDate: "2026-11-12",
  pinnedUntil: new Date("2026-11-13T05:00:00Z"), createdAt: new Date("2026-11-11T01:05:00Z"),
};
const WITH_NOTE = marketAndPortfolioBlock({ ...SAMPLE_BLOCK_PARTS, notes: [{ author: ACCOUNT_NOTE.author, line: runNoteLine(ACCOUNT_NOTE) }] }, SAMPLE_NOW);

describe("the four agents' prompts, from their builders", () => {
  it.each([
    ["morning run", "daily", "Analyst: Secular Compounder"],
    ["trigger run", "tactical", "Analyst: PEAD Specialist"],
    ["chat", "chat", "Analyst: Secular Compounder"],
    ["Writer", "writer", "Analyst: Research Analyst"],
  ] as const)("the %s: its instructions, the analyst's brief and the house rules, every character in one block", (_name, key, brief) => {
    const text = SAMPLE_PROMPTS[key]();
    const blocks = promptBlocks(text);
    expect(blocks[0].label).toBe("Instructions");
    expect(labels(text)).toEqual(expect.arrayContaining([brief, "House rules"]));
    expect(blocks.find((b) => b.label === "House rules")!.text).toBe(HOUSE_RULES);
    const b = blocks.find((x) => x.label === brief)!;
    expect(b.text).toMatch(/^## Analyst: .+\n\n(?:[\s\S]*\n\n)?Rules:\n(- .+\n?)+$/);
    expect(blocks[0].text).toContain(`[See the "${brief}" chip]`);
    expect(sum(text)).toBe(text.length);
  });

  it("the trigger run's sample: the stock's row is its own block, from its banner to the row's last brace", () => {
    const text = SAMPLE_PROMPTS.tactical();
    expect(labels(text)).toEqual(["Instructions", "Analyst: PEAD Specialist", ...MARKET, "$HPE row", "House rules"]);
    const row = promptBlocks(text).find((b) => b.label === "$HPE row")!;
    expect(row.text).toMatch(/^═+\n\$HPE, its row \(get_theses\)\n═+\n\{[\s\S]*\n\}$/);
    expect(sum(text)).toBe(text.length);
  });
});

describe("CEG's trigger run on 09-14, from its real Activity rows, with a note pinned on it", () => {
  const at = fx.runs.trigger0914_1530.loadedAt;
  const now = new Date(at);
  const rows = fx.updates
    .filter((u) => new Date(u.timestamp).getTime() < now.getTime())
    .map((u) => ({ ...u, thesisId: fx.thesis0918.id, timestamp: new Date(u.timestamp), fieldChanges: u.fieldChanges ?? {}, tradeId: null, signalIds: [], positionAtTime: null, run: u.runMode ? { mode: u.runMode } : null })) as unknown as StoredLine[];
  const note: SharedNoteRow = {
    id: "note_power", author: "PORTFOLIO_MANAGER", runId: "run_pm", body: "CEG and VST trade together on power demand; read one's drop against the other.",
    audience: "STOCKS", analystId: null, tickers: ["CEG", "VST"], eventDate: null,
    pinnedUntil: new Date(now.getTime() + 3 * 86_400_000), createdAt: new Date(now.getTime() - 3_600_000),
  };
  const context = stockContextFor({ ticker: "CEG", rows, notes: [note], now }).text;
  const trail = { id: "cacca7f6-ab5e-4f8c-9922-f2c2c94ce5d8", action: "EXIT", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, rationale: "Gave back 8% from the high." } as Trigger;
  const prompt = buildTacticalSystemPrompt({
    analyst: { name: "Secular Compounder", analystPrompt: null },
    stock: { ticker: "CEG", direction: "LONG", row: rowForModel({ id: fx.thesis0918.id, ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", context, coreBelief: "CEG compounds to $360+ over 24 months." }, { named: true, size: "short", setupLines: true }) as never },
    trigger: trail,
    position: { peakPrice: 303.4 },
    fired: { price: 264.6 },
    marketAndPortfolio: WITH_NOTE,
  });
  const blocks = promptBlocks(prompt);
  const by = (label: string) => blocks.find((b) => b.label === label)!;

  it("the Market and portfolio parts, then the row, its notes and its Activity lines, each a block", () => {
    expect(blocks.map((b) => b.label)).toEqual(["Instructions", "Analyst: Secular Compounder", ...MARKET, "Notes", "$CEG row", "Notes on $CEG", "Activity on $CEG", "House rules"]);
    // The note to the account is in the block; the note pinned on CEG is in its row.
    expect(by("Notes").text).toBe(`### Notes\n- ${runNoteLine(ACCOUNT_NOTE)}`);
    expect(by("Notes on $CEG").text).toMatch(/^PINNED ON \$CEG: notes to more than this stock, read before its Activity lines:\n.+CEG and VST trade together/);
    expect(by("Activity on $CEG").text).toMatch(/^WHAT'S BEEN SAID ON \$CEG — its newest 7 Activity lines, newest first, as the owner sees them:\n/);
    expect(by("Activity on $CEG").text).toMatch(/Declined sell \d+ shares/);
    expect(by("Activity on $CEG").text).not.toContain("PINNED ON");
  });

  it("the row shows its notes and Activity by name, and nothing is lost or counted twice", () => {
    const row = by("$CEG row").text;
    expect(row).toContain('"said": "[See the Notes on $CEG and Activity on $CEG chips]"');
    // Put back, the row is the prompt's own text.
    const said = JSON.stringify(context);
    expect(prompt).toContain(row.replace(JSON.stringify("[See the Notes on $CEG and Activity on $CEG chips]"), said));
    // The row's size leaves its said out; the notes and Activity carry it, as sent (escaped, in quotes).
    expect(by("$CEG row").chars).toBe(by("$CEG row").text.length - JSON.stringify("[See the Notes on $CEG and Activity on $CEG chips]").length);
    expect(by("Notes on $CEG").chars + by("Activity on $CEG").chars).toBe(said.length);
    expect(sum(prompt)).toBe(prompt.length);
  });

  it("on the run page: one chip per block, the same in every request of the call", () => {
    const body = { model: "gpt-5.4", input: [{ role: "developer", content: prompt }, { role: "user", content: [{ type: "input_text", text: "Tactical run on $CEG." }] }], tools: [] };
    const view = viewOfCall({ v: 1, call: "Main", source: "tactical-run", provider: "openai.responses", model: "gpt-5.4", list: "input", startedAt: "", endedAt: "", steps: [{ keys: Object.keys(body), set: { model: body.model, tools: body.tools }, keep: 0, add: body.input }, { keep: 2 }] });
    expect(view.pieces.map((p) => [p.label, p.request, p.lastRequest])).toEqual([
      ["Instructions", 1, 2],
      ["Analyst: Secular Compounder", 1, 2],
      ...[...MARKET, "Notes"].map((l) => [l, 1, 2]),
      ["$CEG row", 1, 2],
      ["Notes on $CEG", 1, 2],
      ["Activity on $CEG", 1, 2],
      ["House rules", 1, 2],
      ["First message", 1, 2],
      ["Tool menu (0 tools)", 1, 2],
    ]);
  });
});

describe("the Market and portfolio block, as its builder prints it in each agent's prompt", () => {
  it.each([
    ["morning run", "daily"],
    ["trigger run", "tactical"],
    ["chat", "chat"],
    ["Writer", "writer"],
  ] as const)("the %s: one block per ### part, named by its heading, together exactly the block", (_name, key) => {
    const sample = SAMPLE_PROMPTS[key]();
    expect(sample).toContain(SAMPLE_MARKET_AND_PORTFOLIO);
    // The same prompt with the block its builder would print on a day with a note.
    const text = sample.replace(SAMPLE_MARKET_AND_PORTFOLIO, WITH_NOTE);
    const blocks = promptBlocks(text);
    const at = blocks.findIndex((b) => b.label === "Market brief");
    expect(blocks.slice(at, at + 5).map((b) => b.label)).toEqual([...MARKET, "Notes"]);
    expect(blocks[at].text).toMatch(/^## Market and portfolio\n\n### Market brief\nWed Nov 11, 7:34 AM ET: Sample text\./);
    // Put together, the parts are the block as printed, to the character.
    expect(blocks.slice(at, at + 5).map((b) => b.text).join("\n\n")).toBe(WITH_NOTE);
    // Last in the morning run, the chat and the Writer; just before the stock's row in the trigger run.
    expect(blocks[at + 5]?.label).toBe(key === "tactical" ? "$HPE row" : undefined);
    for (const l of [...MARKET, "Notes"]) expect(blocks[0].text).toContain(`[See the "${l}" chip]`);
    expect(sum(text)).toBe(text.length);
  });

  it("a part renamed in BLOCK_PARTS still splits, named by the heading it was sent under", () => {
    const text = "Do the job.\n\n## Market and portfolio\n\n### Market, Tue Nov 10\nRead.\n\n### The account\n8:02 PM ET: $100,000";
    expect(labels(text)).toEqual(["Instructions", "Market, Tue Nov 10", "The account"]);
    expect(sum(text)).toBe(text.length);
  });
});

describe("when the openers aren't there", () => {
  it("a prompt with none of them is one block", () => {
    const text = "You are a helpful agent.\n\n## How to work\nDo it.";
    expect(promptBlocks(text)).toEqual([{ label: "Instructions", text, chars: text.length }]);
  });

  it("a stock's row inside another block (a strategy quoting one) is not split, and leaves no notes or Activity chip behind", () => {
    const said = { ticker: "XYZ", said: "A note.\n\nWHAT'S BEEN SAID ON $XYZ — its lines" };
    const row = `═══════════════\n$XYZ, its row (get_theses)\n═══════════════\n${JSON.stringify(said, null, 2)}`;
    const text = `Do the job.\n\n## Analyst: Quoter\n\nMy strategy, with an example:\n${row}\n\nRules:\n- Hold.`;
    expect(labels(text)).toEqual(["Instructions", "Analyst: Quoter"]);
    expect(sum(text)).toBe(text.length);
  });

  it("an analyst heading with no Rules before the next heading claims nothing past it", () => {
    const text = "## Analyst: Old\n\nA strategy.\n\n## Your job\nWork.\n\nRules:\n- Someone else's.";
    expect(labels(text)).toEqual(["Instructions"]);
  });

  it("house rules from an older build still split, from their first line to the next section", () => {
    const older = HOUSE_RULES.replace("weigh it", "weigh it carefully");
    const text = `Do the job.\n\n${older}\n\n## Your job\nWork.`;
    const rules = promptBlocks(text).find((b) => b.label === "House rules")!;
    expect(rules.text).toBe(older);
    expect(promptBlocks(text)[0].text).toBe('Do the job.\n\n[See the "House rules" chip]\n\n## Your job\nWork.');
  });
});
