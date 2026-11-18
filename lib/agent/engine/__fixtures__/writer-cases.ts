/**
 * The Writer's prompt in each shape it takes, on made-up stocks: a new stock
 * plain and with its playbooks, a record and the account's block; a new
 * stock with the sender's notes and a pasted idea; a refresh of a watch, of a
 * seed, of a holding and of a promoted stock; a playbook list that couldn't
 * be read. The engine test checks the engine's request against what the old
 * builder made from the same cases (./writer.golden.json).
 */
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import type { Trigger } from "@/lib/agent/triggers/types";

/** The Market and portfolio block's parts, stand-in text. */
export const WRITER_PIECES: PortfolioPiece[] = [
  { id: "market_numbers", text: "### Market numbers (as of Tue, Nov 17, 7:10 PM ET)\n- S&P 500 (SPY) $600.00 −0.50%." },
  { id: "market_digest", text: "### Market digest (written Tue, Nov 17, 7:31 AM ET)\n#### Market overview\nStocks slipped." },
  { id: "portfolio_snapshot", text: "### Portfolio snapshot\nThe account, Tue, Nov 17 at the close\nValue $100,000.00 · cash $40,000.00 (40.0% of the account)" },
  { id: "portfolio_digest", text: "### Portfolio digest (written Mon, Nov 16, 8:00 PM ET)\nThe account had a quiet day." },
];

const buy: Trigger = { id: "trg_buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 120 }, rationale: "The base's pivot, at $120.", source: "AGENT" } as Trigger;
const stopWatching: Trigger = { id: "trg_stop", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 95, settings: { close: true } }, rationale: "The base's low.", source: "AGENT" } as Trigger;
const sell: Trigger = { id: "trg_sell", action: "EXIT", predicate: { watch: "price", is: "below", value: 101 }, rationale: "Under the last swing low.", source: "AGENT" } as Trigger;

const existing = (status: string, direction: string | null, triggers: Trigger[]) => ({
  id: "thesis_case",
  status,
  direction,
  horizon: "SWING",
  coreBelief: "The company sells a product people keep buying.",
  company: "Made-up Co. makes widgets.",
  triggers,
});

const base = {
  analyst: { name: "Case Analyst", analystPrompt: "You buy companies whose sales keep growing.", setupIds: ["BASE_BREAKOUT", "MA_PULLBACK"] },
  ticker: "CASE",
  reason: "A screen found it near its base.",
  runDate: "2026-11-17",
};

export const WRITER_CASES = {
  mint_plain: { ...base, mode: "mint", existingThesis: null },
  mint_playbooks: {
    ...base,
    mode: "mint",
    existingThesis: null,
    setups: setupsForAnalyst(["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"]),
    playbooks: (id: string) => playbookTemplates(null, id),
    setupRecord: ["Base breakout: 4 trades, 50% win, +0.4R, 21d held, 9.1pts given back from the peak."],
    pieces: WRITER_PIECES,
  },
  mint_notes_idea: {
    ...base,
    mode: "mint",
    existingThesis: null,
    researchNotes: "Pulled get_stock_data: above a rising 50-day, pulling back on light volume.",
    ideaSource: { author: "@made_up_author on X", url: "https://x.com/made_up_author/status/1", posted_on: "2026-11-15", text: "Widgets are the next big thing." },
  },
  refresh_watch: {
    ...base,
    mode: "refresh",
    existingThesis: existing("WATCHING", "LONG", [buy, stopWatching]),
    setups: setupsForAnalyst(["BASE_BREAKOUT"]),
    playbooks: (id: string) => playbookTemplates(null, id),
    priorExit: { exitPrice: 104.5, daysAgo: 6, closeReason: "STOP" },
    pieces: WRITER_PIECES,
  },
  refresh_seed: { ...base, mode: "refresh", existingThesis: existing("WATCHING", null, []) },
  refresh_held: { ...base, mode: "refresh", existingThesis: existing("HOLDING", "LONG", [sell]), pieces: WRITER_PIECES },
  refresh_promoted: {
    ...base,
    mode: "refresh",
    existingThesis: existing("PROMOTED", "LONG", []),
    promotionContext: { paperTenureDays: 41, paperRealizedPnl: 312.4, paperReviewCount: 6, promotedAt: "2026-11-16" },
  },
  mint_unread_playbooks: { ...base, mode: "mint", existingThesis: null, setups: setupsForAnalyst(["PRE_CATALYST"]), playbooks: null },
} as const;

export type WriterCaseName = keyof typeof WRITER_CASES;

/** The first message's parts, stand-in text. */
export const WRITER_MESSAGE = {
  dataBlock: "═══════════════════════════════════════════════════════════════════\nSTRUCTURED DATA: $CASE (Made-up Co.)\n═══════════════════════════════════════════════════════════════════\n\n## Snapshot\n\nCurrent: $110.00",
  chatFound: "### web_search \"made-up co news\"\n- Made-up Co. raised its outlook.",
};
