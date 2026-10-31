/**
 * voice.test.ts — what the account owner reads is written in one voice
 * (lib/agent/voice.ts).
 *
 * Built from real production inputs: the Visa and AGIO buys (2026-10-05) and
 * Samsara's automatic floor sale (09-25). Each assertion below failed on
 * main, where the same inputs printed the old wording.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zodSchema } from "ai";
import { createResearchTools } from "@/lib/agent/tools";
import { makeSubmitThesisTool } from "@/lib/agent/run-thesis-writer";
import { SETUP_STANDING_RULES } from "@/lib/agent/knowledge/seat-rules";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { VOICE_RULES } from "@/lib/agent/voice";
import { sizeByRisk } from "@/lib/agent/position-sizing";
import { heatLine, type OpenRisk } from "@/lib/agent/portfolio-risk";
import { computeRegime } from "@/lib/agent/regime";
import { autoTradeLine } from "@/lib/agent/triggers/do-it";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

/** Words the rules forbid, in the forms the old text used them. */
const ANALYST_TALK = [/\b[A-Z]{2,}_[A-Z_]+\b/, /\[Belief unchanged/, /\bseat\b/i, /\bthe principal\b/i, /\bOVER the cap\b/, /stop distance/, /\(HIGH\)|\(MEDIUM\)/];
const plain = (text: string) => ANALYST_TALK.filter((re) => re.test(text)).map(String);

describe("every agent's text carries the rules, once", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") }));
  afterAll(() => jest.useRealTimers());

  for (const name of Object.keys(SAMPLE_PROMPTS) as Array<keyof typeof SAMPLE_PROMPTS>) {
    it(name, () => {
      expect(SAMPLE_PROMPTS[name]().split(VOICE_RULES).length - 1).toBe(1);
    });
  }
});

describe("the lines the app writes under a buy", () => {
  it("Visa, 2026-10-05: 27 shares capped at the largest trade, every number kept", () => {
    const r = sizeByRisk({ equity: 114_480, entry: 368.9, stop: 344, conviction: "HIGH", band: { floor: 3_000, ceiling: 10_000, floorClampedByCeiling: false } } as never)!;
    expect(r.line).toBe(
      "27 shares, $9,960, capped at this analyst's largest trade. Risk alone said 45 shares ($16,601): " +
        "1% of the $114,480 account at high conviction = $1,145 at risk, over $24.90 to the stop. " +
        "At the stop this loses $672, 0.59% of the account.",
    );
    expect(plain(r.line)).toEqual([]);
  });

  it("AGIO, 2026-10-05: raised to the smallest trade, the event halving named in words", () => {
    const r = sizeByRisk({ equity: 114_249, entry: 31.38, stop: 26, conviction: "MEDIUM", binary: true, band: { floor: 3_000, ceiling: 10_000, floorClampedByCeiling: false } } as never)!;
    expect(r.line).toBe(
      "96 shares, $3,012, raised to this analyst's smallest trade. Risk alone said 79 shares ($2,479): " +
        "1% of the $114,249 account × 0.75 for medium conviction × 0.5 for an all-or-nothing event = $428 at risk, over $5.38 to the stop. " +
        "At the stop this loses $516, 0.45% of the account, above the 0.38% this trade aims for because the stop is wide.",
    );
    expect(plain(r.line)).toEqual([]);
  });

  it("Visa, 2026-10-05: the open-risk line", () => {
    const open: OpenRisk = {
      riskDollars: 9_746,
      riskPct: 8.5,
      perName: [
        { symbol: "ASML", riskDollars: 1_429 },
        { symbol: "NVDA", riskDollars: 1_268 },
        { symbol: "GEV", riskDollars: 1_117 },
      ],
      unstopped: [],
      byIndustry: new Map(),
    };
    const line = heatLine(open, 114_480, 672.3);
    expect(line).toBe("If every open stop hit after this buy, the account would lose 9.1%, over the 6% limit. Biggest: ASML $1,429, NVDA $1,268, GEV $1,117.");
    expect(plain(line)).toEqual([]);
  });

  it("Visa, 2026-10-05: the market line", () => {
    const snap = (close: number, s50: number, s200: number) =>
      ({ asOf: "2026-10-02", sma: { 20: null, 50: s50, 150: null, 200: s200 }, closes: [close] }) as unknown as IndicatorSnapshot;
    // 91% of the stocks above their 50-day: 10 of 11.
    const book = [...Array.from({ length: 10 }, () => snap(10, 9, 8)), snap(10, 11, 8)];
    const r = computeRegime(snap(769.64, 763.7, 720.47), book)!;
    expect(r.line).toBe("Market risk-on: SPY $769.64, above its 50-day ($763.70) and above its 200-day ($720.47), so full size. 91% of our stocks are above their 50-day.");
    expect(plain(r.line)).toEqual([]);
  });
});

describe("Samsara, 2026-09-25: the automatic floor sale", () => {
  it("the app writes one plain line until the analyst's write-up replaces it; no ask count, no line to move", () => {
    const line = autoTradeLine({ action: "EXIT", predicate: { watch: "price", is: "below", value: 41.42 } } as never);
    expect(line).toBe('Your "Sell if below $41.42" came true. It\'s set to Auto-sell.');
    expect(line).not.toMatch(/ask|move the line|no analyst|recent low/i);
  });
});

describe("the old wording is gone from every line the app writes for the owner", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const cases: Array<[string, string[]]> = [
    ["lib/agent/tools/update-thesis.ts", ["[Belief unchanged: ${"]],
    ["lib/proposals/execute.ts", ["User approved the ${intent}", "Alpaca order id ${"]],
    ["lib/proposals/thesis-flips.ts", ["Entry filled at $", "the watchlist row is now a live position"]],
    ["lib/inngest/functions/proposal-expiry.ts", ["no approve / reject within the expiry window", "Original rationale:"]],
    ["lib/inngest/functions/reconcile-orders.ts", ["Once the stock is owned the buy price is what was paid, not the plan."]],
    ["lib/agent/system-prompts/intraday-tactical.ts", ["ladder intact:", "level no longer holds at\n           execution time", "False fire."]],
    // 2026-10-29: no Activity line carries a paragraph the app wrote. These
    // led the sheet (GEV's expiry) or reached the agents as an analyst's note.
    ["lib/inngest/functions/proposal-expiry.ts", ["expired without an answer", "Its reason:"]],
    ["lib/proposals/execute.ts", ["You approved the", "User rejected the ${intent} proposal without a written reason"]],
    ["lib/proposals/thesis-flips.ts", ["Bought on your approval", "Profit-take. Position closed", "Protective exit on price", "Position closed. Reason:", "Close proposal approved. Reason:"]],
    ["lib/inngest/functions/reconcile-orders.ts", ["Now that we own it, the buy price on the thesis is what we paid", "The automatic stop moves with it"]],
    ["lib/agent/record-buy-blocked.ts", ["Nothing is wrong with the plan; the analyst has no room"]],
    ["lib/agent/triggers/use-once.ts", ["is a one-time order: it came off the stock"]],
    ["lib/agent/triggers/demote.ts", ["was removed: ", "re-price it if the setup comes back"]],
    ["lib/trading/after-buy.ts", ["the next run will set it"]],
    ["lib/actions/thesis-edit.ts", ["You added this trigger:", "You changed this trigger to:", "You removed this trigger:", "Removed in the cleanup of copied rules:"]],
    ["lib/actions/promote-analyst.actions.ts", ["Administrative transition, not a thesis decision", "Demote-while-PROMOTED downgrade"]],
    ["lib/actions/analyst.actions.ts", ["Analyst was created with this ticker on the suggested watchlist", "Editor removed this ticker from the analyst's watchlist.", "Updated via editor"]],
    // 2026-10-30: a proposal's reason is the analyst's words alone. The sizing and a corrected sale label go to the agent.
    ["lib/agent/tools/close-position.ts", ["closed by agent — reason:"]],
    ["lib/actions/closeTrade.actions.ts", ["Automated ${reason} exit"]],
    ["lib/agent/tools/place-trade.ts", ["[proposalRationale, sizingNotes"]],
    ["lib/agent/tools/manage-position.ts", ["${args.reason}\\n\\n${addSizingLine}"]],
  ];
  for (const [path, phrases] of cases) {
    it(path, () => {
      const src = read(path);
      expect(phrases.filter((p) => src.includes(p))).toEqual([]);
    });
  }
});

/**
 * The standard (2026-10-20): the company and the stock first, then the
 * decision in the owner's dollars; a trigger is context, never the reason;
 * none of our shorthand. IOT's note that day led with its holding style and
 * its belief was a price path, because the field texts asked for that.
 */
describe("the field texts ask for the standard, and carry none of our shorthand", () => {
  type Prop = { description?: string; anyOf?: Prop[]; items?: { properties?: Record<string, Prop> } } | undefined;
  const wordsOf = (p: Prop): string => p?.description ?? p?.anyOf?.find((m) => m?.description)?.description ?? "";
  const SHORTHAND = [/\bPEAD\b/, /drift/i, /time-hold/i, /trend template/i, /\bR\/R\b/, /\bATR\b/, /ladder/i, /\brungs?\b/i, /fire.mode/i, /\bslot\b/i, /\b[A-Z]+_[A-Z_]+\b/];
  const shorthand = (text: string) => SHORTHAND.filter((re) => re.test(text)).map(String);

  // update_thesis is read through the writer's door (it carries every field); the rest through the chat's.
  const props = (tool: string): Record<string, Prop> => {
    const runMode = tool === "update_thesis" ? "THESIS_WRITER" : "PRINCIPAL_CHAT";
    const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER" } as never) as Record<string, { inputSchema: unknown }>;
    return (zodSchema(all[tool].inputSchema as never).jsonSchema as { properties: Record<string, Prop> }).properties;
  };
  const submit = (): Record<string, Prop> =>
    (zodSchema(makeSubmitThesisTool({ ticker: "X" } as never).inputSchema as never).jsonSchema as { properties: Record<string, Prop> }).properties;

  const shown = (): Array<[string, string]> => [
    ["update_thesis.rationale", wordsOf(props("update_thesis").rationale)],
    ["place_trade.entry_rationale", wordsOf(props("place_trade").entry_rationale)],
    ["close_position.notes", wordsOf(props("close_position").notes)],
    ["manage_position.reason", wordsOf(props("manage_position").reason)],
    ["record_thesis.reasoning_summary", wordsOf(props("record_thesis").reasoning_summary)],
    ["submit_thesis.rationale", wordsOf(submit().rationale)],
    ["record_run_summary.decision_rationale", wordsOf(props("record_run_summary").decision_rationale)],
    ["record_run_summary.ranked_picks.reasoning", wordsOf(props("record_run_summary").ranked_picks?.items?.properties?.reasoning)],
    ...["core_belief", "conviction_rationale", "variant_view", "snapshot", "stop_basis", "target_basis"].map(
      (f): [string, string] => [`update_thesis.${f}`, wordsOf(props("update_thesis")[f])],
    ),
  ];

  it("the voice rules state the standard and name the shorthand they ban", () => {
    // A note, in three parts: what is going on and why, what it means, then one closing sentence of what we did.
    expect(VOICE_RULES).toContain(`answers "what's going on with this stock, and what should I do?", in three parts, in this order:`);
    expect(VOICE_RULES).toContain("- What is going on with the company and the stock, and why: what happened, today or since the last look, with dates (its own news, its sector, the market).");
    expect(VOICE_RULES).toContain("- What it means: whether that touches the reason we own it (or watch it), and for this position the shares, the dollars, the profit or loss.");
    // GEV and ABBV replays, 10-28: the note listed every break that had not happened.
    expect(VOICE_RULES).toContain("when nothing that would break the case has happened, say so in a few words, never as a list of each thing that hasn't");
    expect(VOICE_RULES).toContain("- What you did, in one closing sentence of plain words, and what would change it");
    expect(VOICE_RULES).toContain("A stop or target goes in this last sentence, and only when the call turns on it.");
    // The standing description: a company page.
    expect(VOICE_RULES).toContain("reads like a research site's company page: what the company does; what it has done lately, with dates; the numbers that matter (growth, profits, valuation); what Wall Street thinks; what has to stay true. Sourced, never a trade formula.");
    expect(VOICE_RULES).toMatch(/never the reason by itself: "the stop at \$41\.42", not "the floor fired"/);
    // Always look it up, one search per stock.
    expect(VOICE_RULES).toContain("Before a decision note on a stock, run one web_search for its latest news. One per stock per run.");
    for (const term of ["PEAD", "drift", "time-hold", "Trend Template", "setup names", "R/R", "ATR", "ladder", "rung", "fire mode", "slot", "ids"]) expect(VOICE_RULES).toContain(term);
    expect(VOICE_RULES).not.toMatch(/Open with the call/);
  });

  it("every field the owner reads is filled in and carries no shorthand", () => {
    const fields = shown();
    expect(fields.filter(([, words]) => words === "").map(([name]) => name)).toEqual([]);
    expect(fields.flatMap(([name, words]) => shorthand(words).map((s) => `${name}: ${s}`))).toEqual([]);
  });

  it("each note and trade reason leads with the company and points at the rules", () => {
    const notes = shown().filter(([name]) => /\.(rationale|entry_rationale|notes|reason|reasoning_summary|decision_rationale)$/.test(name));
    expect(notes).toHaveLength(7);
    for (const [name, words] of notes) {
      const company = name.endsWith("decision_rationale") ? /what moved the stocks/ : /company/;
      expect([name, company.test(words), /How you write/.test(words)]).toEqual([name, true, true]);
    }
  });

  it("the belief is why we own the company, never a price path", () => {
    const words = wordsOf(props("update_thesis").core_belief);
    expect(words).toMatch(/Why we own the company, in two or three plain sentences: what it does, why it is worth owning, and what has to stay true/);
    expect(words).toMatch(/never the trade: no price path, no target, no dates/);
    expect(wordsOf(submit().core_belief)).toBe(words);
  });

  it("the writer asks for a company-first snapshot and belief", () => {
    const writer = SAMPLE_PROMPTS.writer();
    expect(writer).toContain("One paragraph, the first thing the owner reads on a new stock: the\n   stock's standing description");
    expect(writer).toContain("core_belief: why we own the company");
    expect(writer).not.toMatch(/outcome \+ timeframe \+\s+mechanism|which of YOUR\s+SETUPS it is/);
  });

  it("an analyst's standing rules read in plain words (a fired rule's note is an Activity line, and the reason on an Auto-sell)", () => {
    const notes = Object.values(SETUP_STANDING_RULES).flatMap((rules) => (rules ?? []).map((r) => r.rationale));
    expect(notes.length).toBeGreaterThan(5);
    const old = [/\bE\d\b/, /T\+\d/, /tranche/i, /\bseat\b/i, /re-underwrite/i, /catastrophe/i, /structure/i, /\bentry\b/i];
    expect(notes.flatMap((n) => [...shorthand(n), ...old.filter((re) => re.test(n)).map(String)].map((s) => `${n.slice(0, 40)}: ${s}`))).toEqual([]);
  });

  it("the trigger run and the morning run are not told to narrate their triggers", () => {
    expect(SAMPLE_PROMPTS.tactical()).not.toMatch(/Floor stays \$X|RE-LADDER|Not acting\s+yet: <reason>|validation (HOLDS|FAILS)/);
    // PLTR's case, 1 of 3 runs, once "Floor stays $X" went: it tried to move a held stock's sale line down.
    expect(SAMPLE_PROMPTS.tactical()).toContain("On a stock we hold you can raise the stop, never lower it;\n   if you think it is wrong, say so in the note and name the level.");
    expect(SAMPLE_PROMPTS.daily()).not.toContain("what triggered it");
  });
});
