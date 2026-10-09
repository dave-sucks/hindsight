/**
 * analyst-brief.test.ts — the analyst is rendered once, and every door reads
 * the same text (step 10, docs/plans/AGENT_ARCHITECTURE.md §11.6).
 *
 * Before step 10 the analyst was rendered five ways: the morning run's
 * `## Edge` + `## Rules`, the trigger run's "You are X. <strategy>" and room
 * block, the chat's scope bullets and fenced strategy, the writer's "Your
 * strategy" + `YOUR SETUPS`, discovery's "operating manual" and config block.
 * Each door here is built through its real prompt builder from one analyst.
 *
 * The analyst is the Catalyst Event PM's production row of 2026-10-08: its
 * numbers, its setups and its fence. Its strategy text is replaced; the
 * repo is public.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { analystBrief, setupLines, universeLines, type BriefAnalyst } from "@/lib/agent/analyst-brief";
import { getSetup, setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { buildDiscoverySystemPrompt } from "@/lib/agent/system-prompts/discovery";
import { buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import { buildWriterResearchPrompt } from "@/lib/agent/run-thesis-writer";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { VOICE_RULES } from "@/lib/agent/voice";
import type { RunInput } from "@/lib/agent/run-input";

const STRATEGY = "(The analyst's strategy, as written on its page.)";

/** The Catalyst Event PM, 2026-10-08. A money column comes off the row as a Decimal; a string here is the same to the brief. */
const CATALYST = {
  id: "cmmmh0wxu000004js7yoyzvlf",
  name: "Catalyst Event PM",
  analystPrompt: STRATEGY,
  directionBias: "LONG",
  holdDurations: ["SWING", "POSITION"],
  minConfidence: 50,
  minPositionSize: "3000",
  maxPositionSize: "8000",
  maxPositionTotal: "16000",
  maxOpenPositions: 5,
  setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"],
  sectors: ["Health Care", "Information Technology"],
  industries: ["Biotechnology", "Pharmaceuticals", "Health Care Equipment & Supplies", "Life Sciences Tools & Services", "Semiconductors", "Software"],
  themes: [],
  marketCapMin: BigInt(500_000_000),
  marketCapMax: BigInt(20_000_000_000),
  exclusionList: [],
  watchlist: ["XENE", "ARQT"],
};

const runInput = (held: string[]) =>
  ({
    portfolio: {
      cash: 31000, buyingPower: 62000, portfolioValue: 100000,
      positions: held.map((symbol) => ({ symbol, direction: "LONG", quantity: 10, avgCost: 100, currentPrice: 101, unrealizedPnl: 10, unrealizedPnlPct: 1, targetPrice: null })),
      exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 },
    },
    pendingApprovalCount: 1,
    watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [], priorityReviews: [],
    triggersFiredSinceLastRun: [], triggersMatchingNow: [],
    earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] },
    intelligencePolicy: { maxSignalsPerRun: 0 }, openRefusals: [],
  }) as unknown as RunInput;

const trail = { id: "trig_trail", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Protect the gain." };
const buy = { id: "trig_buy", predicate: { watch: "price", is: "below", value: 67 }, action: "ENTER", rationale: "The pullback level." };
const tactical = (analyst: BriefAnalyst, extra: Record<string, unknown> = {}) =>
  buildTacticalSystemPrompt({
    analyst,
    stock: { ticker: "DOCU", direction: "LONG", row: { stock: "DOCU · held · LONG · MA_PULLBACK", id: "thesis_1" } },
    trigger: trail,
    position: { peakPrice: 80 },
    ...extra,
  } as never);

const DOORS = {
  daily: () => buildDailyRunSystemPromptV2(CATALYST, runInput(["MRNA", "IONS"])),
  trigger: () => tactical(CATALYST),
  chat: () => buildPrincipalSystemPrompt({ scopedAnalyst: CATALYST }),
  writer: () => buildWriterResearchPrompt({ analyst: CATALYST, ticker: "DOCU", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-10-08", setups: setupsForAnalyst(CATALYST.setupIds) }),
  discovery: () => buildDiscoverySystemPrompt({ config: CATALYST, analystId: CATALYST.id, existingTickers: [] }),
};

const count = (text: string, part: string) => text.split(part).length - 1;

describe("the Catalyst Event PM's brief", () => {
  const brief = analystBrief(CATALYST);

  it("is the heading, the strategy word for word, the rules' numbers and one line per chosen setup", () => {
    expect(brief).toBe(
      [
        "## Analyst: Catalyst Event PM",
        STRATEGY,
        [
          "Rules:",
          "- Direction: LONG",
          "- Hold style: SWING, POSITION",
          "- Min confidence: 50%",
          "- Position size: $3,000–$8,000 per entry (place_trade sizes every buy inside this band by risk)",
          "- Most in one stock: $16,000",
          "- Max open positions: 5",
        ].join("\n"),
        [
          "Setups:",
          `- ${setupLines(getSetup("PRE_CATALYST")!)[0]}`,
          `- ${setupLines(getSetup("BASE_BREAKOUT")!)[0]}`,
          `- ${setupLines(getSetup("MA_PULLBACK")!)[0]}`,
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(brief).toContain("- PRE_CATALYST — ");
  });

  it("states the room when the caller counted it: the limit, never what is left of it", () => {
    // The cron once passed the slots left in the limit's place, and a
    // half-full analyst read as full (2026-09-18). The brief reads the row.
    const withRoom = analystBrief(CATALYST, { open: 3, max: CATALYST.maxOpenPositions, held: ["MRNA", "IONS"], awaitingApproval: 1 });
    expect(withRoom).toContain("- Max open positions: 5\n- Positions: 3 of 5 — 2 free. It holds $MRNA, $IONS. 1 buy awaiting your approval already took a slot.");
    expect(withRoom.replace(/\n- Positions: [^\n]*/, "")).toBe(brief);
  });

  it("an analyst with no setups chosen gets no setups block, never the catalog", () => {
    const none = analystBrief({ ...CATALYST, setupIds: [] });
    expect(none).not.toContain("Setups:");
    expect(none).not.toContain("BASE_BREAKOUT");
  });

  it("an unset analyst reads as the morning run always rendered one", () => {
    expect(analystBrief({})).toContain("## Analyst: Research Analyst\n\nRules:\n- Direction: Long & Short\n- Hold style: SWING\n- Min confidence: 70%\n- Max position size: $2,500");
  });
});

describe("every door reads the same brief, once", () => {
  const brief = analystBrief(CATALYST);
  const prompts = Object.fromEntries(Object.entries(DOORS).map(([door, build]) => [door, build()])) as Record<keyof typeof DOORS, string>;

  it("the trigger run off a sale, the chat, the writer and discovery: the brief byte for byte", () => {
    for (const door of ["trigger", "chat", "writer", "discovery"] as const) expect(count(prompts[door], brief)).toBe(1);
  });

  it("the morning run: the same brief with its room line", () => {
    expect(count(prompts.daily, analystBrief(CATALYST, { open: 3, max: 5, held: ["MRNA", "IONS"], awaitingApproval: 1 }))).toBe(1);
    expect(prompts.daily).not.toContain("## Regime and cash\nPositions:");
  });

  it("the trigger run on a buy: the same brief with its room line", () => {
    const room = { open: 5, max: 5, held: ["MRNA", "IONS", "XENE", "ARQT", "PRAX"] };
    expect(count(tactical(CATALYST, { trigger: buy, position: null, capacity: room }), analystBrief(CATALYST, room))).toBe(1);
  });

  it("each door names the analyst once and carries its strategy once", () => {
    for (const door of Object.keys(DOORS) as Array<keyof typeof DOORS>) {
      expect([door, count(prompts[door], "## Analyst: ")]).toEqual([door, 1]);
      expect([door, count(prompts[door], STRATEGY)]).toEqual([door, 1]);
      expect([door, count(prompts[door], "Min confidence:")]).toEqual([door, 1]);
    }
  });

  it("each door carries the house rules once, and the voice rules once", () => {
    for (const door of Object.keys(DOORS) as Array<keyof typeof DOORS>) {
      expect([door, count(prompts[door], HOUSE_RULES)]).toEqual([door, 1]);
      expect([door, count(prompts[door], VOICE_RULES)]).toEqual([door, 1]);
    }
  });

  it("no door renders the analyst its own way any more", () => {
    const gone = ["## Edge", "## Rules", "Your strategy:", "THE ANALYST'S ROOM", "Your operating manual", "Analyst prompt (the strategy)", "You are Catalyst Event PM", "Direction bias:", "Hold durations:"];
    for (const door of Object.keys(DOORS) as Array<keyof typeof DOORS>) for (const g of gone) expect([door, g, prompts[door].includes(g)]).toEqual([door, g, false]);
  });

  it("the chat and discovery show the fence, from one function", () => {
    const fence = universeLines(CATALYST);
    expect(fence).toEqual([
      "Sectors: Health Care, Information Technology",
      "Industries: Biotechnology, Pharmaceuticals, Health Care Equipment & Supplies, Life Sciences Tools & Services, Semiconductors, Software",
      "Themes: (any)",
      "Market cap: $0.5B – $20B",
      "Exclusions: (none)",
    ]);
    for (const line of fence) {
      expect(count(prompts.chat, line)).toBe(1);
      expect(count(prompts.discovery, line)).toBe(1);
    }
  });
});

describe("the writer names a setup by id from the same lines", () => {
  const prompt = DOORS.writer();
  it("its full block is setupLines, every line, for each setup it writes on", () => {
    for (const id of CATALYST.setupIds) {
      const lines = setupLines(getSetup(id)!);
      expect(prompt).toContain(lines.join("\n  "));
      expect(lines[0].startsWith(`${id} — `)).toBe(true);
    }
  });
  it("the brief's line for a setup is the full block's first line", () => {
    const first = setupLines(getSetup("MA_PULLBACK")!)[0];
    expect(analystBrief(CATALYST).split("\n")).toContain(`- ${first}`);
    expect(prompt.split("\n")).toContain(first);
  });
});

describe("setupLines", () => {
  const pullback = getSetup("MA_PULLBACK")!;
  it("with a horizon, the one Manage line for it", () => {
    const lines = setupLines(pullback, "TARGET");
    expect(lines.filter((l) => l.startsWith("Manage"))).toEqual([`Manage: ${pullback.trail.TARGET}`]);
  });
  it("without one, each horizon's, labelled", () => {
    const lines = setupLines(pullback);
    expect(lines.filter((l) => l.startsWith("Manage"))).toEqual(Object.entries(pullback.trail).map(([h, t]) => `Manage (${h}): ${t}`));
  });
  it("three cuts of one text: the brief's first line, the writer's all, a row's decision lines", () => {
    const all = setupLines(pullback, "TARGET");
    const decision = setupLines(pullback, "TARGET", "decision");
    expect(all[0]).toBe(`MA_PULLBACK — ${pullback.name}: ${pullback.summary}`);
    expect(all[1]).toBe(`Needs: ${pullback.preconditions.join("; ")}`);
    expect(decision).toEqual(all.slice(2));
    expect(decision[0]).toMatch(/^Entry: /);
    expect(decision.at(-1)).toMatch(/^Failure looks like: /);
  });
  it("carries the confirmation and the failure signs the trigger run reads", () => {
    const lines = setupLines(pullback, "TARGET");
    expect(lines).toContain(`Failure looks like: ${pullback.failureSigns.join("; ")}`);
    expect(lines.find((l) => l.startsWith("Entry: "))).toContain(`Confirm a buy by: ${pullback.entry.confirmation.join("; ")}`);
  });
});
