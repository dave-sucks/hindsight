/**
 * The trigger run's prompt in each shape it takes, on a made-up stock: a
 * trail sale on a holding (the tracked peak), a buy on a watch with the
 * analyst's room, its situations, the account's block and a decline line, a
 * review on a watch with the analyst's playbooks, an Auto sale's write-up, a
 * trim with its size and the principal's note, an add, and a row that
 * couldn't be read. The engine test checks the engine's request against what
 * the old builder made from the same cases (./trigger-run.golden.json).
 */
import { rowForModel } from "@/lib/agent/row-for-model";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { guidanceFor } from "@/lib/agent/situation-skills";
import { playbooksBlock, playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import type { Trigger } from "@/lib/agent/triggers/types";

const trail: Trigger = { id: "trg_trail", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Protect the gain." } as Trigger;
const buy: Trigger = { id: "trg_buy", predicate: { watch: "price", is: "above", value: 120 }, action: "ENTER", rationale: "The base's pivot, at $120.", source: "AGENT" } as Trigger;
const review: Trigger = { id: "trg_review", predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "A look every week." } as Trigger;
const sale: Trigger = { id: "trg_sale", predicate: { watch: "price", is: "below", value: 101 }, action: "EXIT", rationale: "Under the last swing low.", source: "AGENT" } as Trigger;
const trim: Trigger = { id: "trg_trim", predicate: { watch: "price", is: "above", value: 150 }, action: "TRIM", trimPct: 33, rationale: "Take a third at the prior high.", source: "PRINCIPAL" } as Trigger;
const add: Trigger = { id: "trg_add", predicate: { watch: "move", is: "above", value: 7, variable: "entry" }, action: "ADD", rationale: "The second half." } as Trigger;

const saved = (status: string, t: Trigger, extra: Record<string, unknown> = {}) => ({
  id: "thesis_case",
  ticker: "CASE",
  status,
  direction: "LONG",
  horizon: "SWING",
  setupId: "BASE_BREAKOUT",
  coreBelief: "The company sells a product people keep buying.",
  kpis: ["Sales grow 20% a year, checked at the next report.", "A guidance cut at the next report."],
  ...(status === "HOLDING" ? { position: { quantity: 60, avgCost: 110, peakPrice: 162.7 } } : {}),
  triggers: [{ id: t.id, says: sentenceOf(t), rationale: t.rationale }],
  ...extra,
});
const row = (status: string, t: Trigger, extra: Record<string, unknown> = {}) => rowForModel(saved(status, t, extra)) as Record<string, unknown>;

/** The Market and portfolio block's text the old builder was given, and its parts the engine is given. */
export const TRIGGER_PIECES = [
  { id: "market_numbers" as const, text: "### Market numbers (as of Tue, Nov 17, 10:55 AM ET)\n- S&P 500 (SPY) $600.00 −0.50%." },
  { id: "market_digest" as const, text: "### Market digest (written Tue, Nov 17, 7:31 AM ET)\n#### Market overview\nStocks slipped." },
  { id: "portfolio_snapshot" as const, text: "### Portfolio snapshot\nThe account, Tue, Nov 17\nValue $100,000.00" },
  { id: "portfolio_digest" as const, text: "### Portfolio digest (written Mon, Nov 16, 8:00 PM ET)\nA quiet day." },
];

const analyst = { name: "Case Analyst", analystPrompt: "You buy companies whose sales keep growing.", setupIds: ["BASE_BREAKOUT", "MA_PULLBACK"] };
const stock = (status: string, t: Trigger, extra: Record<string, unknown> = {}) => ({ ticker: "CASE", direction: "LONG", row: row(status, t, extra) });

export const TRIGGER_CASES = {
  trail_sale: { analyst, stock: stock("HOLDING", trail), trigger: trail, position: { peakPrice: 162.7 }, fired: { price: 141.2 }, pieces: TRIGGER_PIECES },
  buy_on_watch: {
    analyst,
    stock: stock("WATCHING", buy),
    trigger: buy,
    position: null,
    fired: { price: 120.4 },
    capacity: { open: 4, max: 6, held: ["AAA", "BBB", "CCC", "DDD"] },
    situations: { codes: ["BUY_ARRIVES"], guidance: guidanceFor([{ code: "BUY_ARRIVES", held: false }]) },
    pieces: TRIGGER_PIECES,
  },
  review_on_watch: {
    analyst,
    stock: stock("WATCHING", review),
    trigger: review,
    position: null,
    fired: { price: null },
    playbooks: playbooksBlock(setupsForAnalyst(["BASE_BREAKOUT", "MA_PULLBACK"]), (id: string) => playbookTemplates(null, id)),
  },
  auto_sale: { analyst, stock: stock("HOLDING", sale), trigger: sale, position: { peakPrice: 162.7 }, fired: { price: 100.6 }, autoTrade: { line: "The sale of 60 shares is waiting for your approval." }, pieces: TRIGGER_PIECES },
  trim_principal_note: { analyst, stock: stock("HOLDING", trim), trigger: trim, position: { peakPrice: 151 }, fired: { price: 150.2 } },
  add_held: { analyst, stock: stock("HOLDING", add), trigger: add, position: { peakPrice: 120 }, fired: { price: 118 } },
  row_unread: { analyst, stock: { ticker: "CASE", direction: "LONG", row: null }, trigger: sale, position: { peakPrice: 130 }, fired: { price: null } },
} as const;

export type TriggerCaseName = keyof typeof TRIGGER_CASES;

/** The kickoff's facts, stand-in. */
export const TRIGGER_KICKOFF = {
  fireSentence: "Sell if below $101",
  contextSuffix: " The report is in: EPS $1.10 vs $1.00 est.",
  windowSuffix: "",
  coFiredSuffix: " Also fired on the same pass: Review every 7 days — one decision covers both.",
  openOnStock: "",
  autoLine: "The sale of 60 shares is waiting for your approval.",
};
