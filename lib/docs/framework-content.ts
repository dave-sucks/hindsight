/**
 * What /how-it-works/framework shows, as the server hands it down: every
 * agent's parts as the engine built them from its record (./framework.ts),
 * the situation texts, and which parts of a thesis each size of the read
 * carries. Client-safe.
 */

import type { PartId } from "@/components/docs/framework/swatch";
import type { PartKind } from "@/lib/agent/engine/types";

/** Where a part of a request goes: the instructions, the first message, or each new message of a conversation. */
export type FrameworkWhere = "instructions" | "message" | "newest";

/** Which of an agent's three parts a part is (its tools are the third, shown on their own). */
export type FrameworkSection = "instructions" | "context" | "message";

/** Each of an agent's parts, in the order a request is read, as the page names it. */
export const SECTION_LABEL: Record<FrameworkSection, string> = {
  instructions: "Its instructions",
  context: "Its context",
  message: "Its message",
};

/** One part of an agent's request, in its record's order. */
export interface FrameworkPart {
  /** "own", "line", "message", "situations", or the shared text's or read's id. */
  id: string;
  title: string;
  kind: PartKind;
  where: FrameworkWhere;
  section: FrameworkSection;
  /** Its line; for its own text, how it opens. */
  about: string;
  /** The file its text comes from. */
  source: string;
  /** Sent only on some runs (the stock's situations). */
  someRuns?: boolean;
  /** Characters on what it is sized on (its run, or its sample); null when that didn't send it (it goes only on some runs). */
  chars: number | null;
  swatch: PartId;
}

/** One agent as its record says and its sample built it. */
export interface FrameworkAgent {
  id: string;
  name: string;
  does: string;
  runsWhen: string;
  /** Who writes its message. */
  messageFrom: string;
  model: string;
  maxSteps: number;
  output: string;
  /**
   * What its sizes are from: its latest request the account's runs saved with
   * its parts named (`gone`: parts that run sent that its record no longer
   * lists), else its sample day (the case, in a few words), else nothing.
   */
  sizedOn: { kind: "run"; at: string; runId: string; gone: string[] } | { kind: "sample"; from: string } | null;
  parts: FrameworkPart[];
  /** Its tools by name; their menu in characters (each tool's description and schema, as sent), over the ones measured here. */
  tools: { names: string[]; chars: number | null; unmeasured: string[]; provider: string[] };
}

/** What usually puts a stock in a situation: a trigger firing (the bolt), or a flag read off the stock's facts (the flag). */
export type SituationOrigin = "trigger" | "flag";

export interface FrameworkSituation {
  code: string;
  name: string;
  chars: number;
  opening: string;
  origin: SituationOrigin;
}

/** The read section, built on the server from the one builder: which keys each read sends, and each read as the model gets it. */
export interface FrameworkRead {
  keys: { line: string[]; row: string[]; full: string[]; writer: string[] };
  samples: { line: string; row: string; full: string };
}

export interface FrameworkData {
  agents: FrameworkAgent[];
  situations: FrameworkSituation[];
  read: FrameworkRead;
}

/** What a stock's line of the stock table carries (lib/agent/stock-table.ts), by the sheet field it comes from. */
export const LINE_KEYS = ["stock", "analyst", "price", "proposal_waiting"] as const;
/** What the Writer's prompt carries of the existing thesis (lib/agent/run-thesis-writer.ts). */
export const WRITER_KEYS = ["stock", "belief", "triggers", "company"] as const;

/** The page's CRWD row as its line of the stock table, under the column names (pinned to the builder by lib/docs/read-cases.test.ts). */
export const EXAMPLE_LINE =
  "Stock | Status | Situation | Price | Day | Volume | 5-day | 1-month | vs S&P, 1-month | vs 50-day | Off 52w high | Since buy | Outlook | Conviction | Next report | Waiting for you\nCRWD | held | — | $418.20 | +6.8% | 1.8x | +3.1% | +7.9% | +4.0% | +7.8% | -0.7% | +3.5% | bullish | medium | — | sell 14";

/**
 * A thesis as the sheet shows it, field by field, in the sheet's order. Each
 * field names the keys of the row the agents read that carry it
 * (lib/agent/row-for-model.ts: every `put("…")`, the one line's parts, and
 * the writer's EXISTING THESIS block in lib/agent/run-thesis-writer.ts).
 * The read cases below say which keys each read sends; the page lights the
 * fields those keys carry. The order is the sheet's: the price, the trade,
 * the chart, then what is under the chips (situations, the plan, the
 * triggers, the belief, Activity, the Street), then the Research tab.
 */
export interface SheetField {
  id: string;
  label: string;
  /** One or two lines of a real-looking value, for the stack. */
  value: string;
  /** The row keys that carry this field, in any read that sends them. */
  keys: readonly string[];
}

export const SHEET_FIELDS: ReadonlyArray<SheetField> = [
  { id: "stock", label: "Stock", value: "CRWD · held · LONG · PEAD · conviction MEDIUM", keys: ["stock", "id", "analyst"] },
  { id: "price", label: "Live price", value: "$418.20, +6.8% today, 2.1% from the buy", keys: ["price"] },
  { id: "position", label: "Position", value: "Bought 14 shares at $404.10 on Oct 15, now $418.20 (+3.5%)", keys: ["position"] },
  { id: "proposal_waiting", label: "Proposal waiting", value: "sell 14 sh, placed 10-16 09:31 ET, expires 10-17", keys: ["proposal_waiting"] },
  { id: "chart", label: "Chart numbers", value: "20d $402 · 50d $388 · 200d $351 · RSI 64 · vs the S&P +9% over 3M", keys: ["chart"] },
  { id: "situations", label: "Situations", value: "ADD_OR_WINNER (add) · REVIEW_DUE (review due) · fired again, 3rd day", keys: ["situations", "repeat"] },
  { id: "triggers", label: "The plan: every trigger, as a sentence", value: "Sell if below $384 on the close · Review if above 10% from our entry · Review if above the Street's average target · Review if within 5 days before earnings · Review every 30 days", keys: ["triggers"] },
  { id: "floor_risk", label: "Floor risk and flags", value: "At the $384 floor, 14 shares lose $281, 0.3% of the account", keys: ["floor_risk", "buyBlockedByFull", "heldThroughFloor", "supersededBy"] },
  { id: "belief", label: "Core thesis", value: "The platform keeps taking share as security budgets consolidate; what has to stay true is net new ARR above $200M a quarter.", keys: ["belief"] },
  { id: "said", label: "Activity: the last 3 reviews, the news, your notes", value: "Review by its analyst, Oct 16, 9:31 AM at $418.20: stronger. The beat held and the floor was raised to $384…", keys: ["said"] },
  { id: "street", label: "The Street", value: "23 buy / 7 hold / 0 sell · targets $380–$520, avg $451, from $432 a month ago · next-quarter EPS $1.04, 6 up / 1 down · room to the Street average is 1.0× the floor's distance from the price", keys: ["street"] },
  { id: "company", label: "About CrowdStrike", value: "CrowdStrike sells cloud-delivered endpoint and identity security on one agent; revenue is subscription, growing about 30% a year.", keys: ["company"] },
  { id: "setup", label: "Playbook", value: "Post-earnings drift: fails when the gap day's low breaks or revisions stall; on a watch, its \"Sell if below\", the one trigger the buy names.", keys: ["setup", "playbook_checks"] },
  { id: "assumptions", label: "Key assumptions", value: "Net new ARR above $200M, checked at the Q3 report on December 2 · gross margin holds above 78%", keys: ["assumptions"] },
  { id: "would_prove_it_wrong", label: "What would prove us wrong", value: "Net new ARR under $180M at the Q3 report · a second outage with customer churn named on the call", keys: ["would_prove_it_wrong"] },
  { id: "bull_case", label: "Bull case", value: "Five points: the beat and raise, Falcon Flex adoption, module attach, the margin step-up, the buyback.", keys: ["bull_case"] },
  { id: "bear_case", label: "Bear case", value: "Four points: valuation at 90× earnings, the July outage's legal tail, a slowing net new ARR cohort, insider selling.", keys: ["bear_case"] },
  { id: "conviction_rationale", label: "Conviction and outlook, each with its reason", value: "MEDIUM: the business is compounding, but the stock is extended 18% above its 50-day and estimates have not moved in a month.", keys: ["conviction_rationale", "outlook_reason"] },
  { id: "variant_view", label: "Where we differ from the Street", value: "The Street models 25% growth; I think Flex pulls it to 30% because attach is running ahead of plan.", keys: ["variant_view"] },
  { id: "snapshot", label: "Snapshot", value: "A clean beat and raise; four targets raised after the call. The first paragraph on a short row, the whole text on a full one.", keys: ["snapshot"] },
  { id: "research", label: "Research date", value: "Written 2026-10-05 at $39.55, 2 days ago", keys: ["research"] },
  { id: "catalyst", label: "Catalyst date", value: "2026-12-02, the next report", keys: ["catalyst"] },
  { id: "history", label: "History", value: "Every Activity line ever written on the stock, with its id", keys: ["history"] },
  { id: "paper_record", label: "Paper record", value: "Held 41 days on paper, +12.4%, 3 reviews (a promoted stock only)", keys: ["paper_record"] },
];

/**
 * One way an agent reads a thesis: the scenario in plain words, what is
 * sent, why that much, and where its keys come from (the server's
 * FrameworkRead). A new stock has nothing to read, so the Writer's first pass
 * is not one.
 */
export interface ReadCase {
  id: "line" | "row" | "full" | "writer";
  /** The chip: one or two words. */
  chip: string;
  /** The scenario, as a heading. */
  title: string;
  /** The scenario in one sentence, under the heading. */
  body: string;
  /** What is sent and why, two or three short lines. */
  points: readonly string[];
}

export const READ_CASES: ReadonlyArray<ReadCase> = [
  {
    id: "line",
    chip: "Nothing new",
    title: "Nothing is happening on this stock",
    body: "No trigger fired, no review is due, no report is near. Most of the book, most mornings.",
    points: [
      "One line of the stock table, the same columns for every stock: its situation, the price, the day's move and volume, the 5-day and 1-month moves, where it sits against the S&P, its 50-day average and its 52-week high, the gain since the buy, outlook, conviction, the next report and a proposal if one is waiting.",
      "The Portfolio Manager gets the same table for the whole account, and the run page draws the same rows.",
      "Thirty quiet stocks stay thirty lines, so the ones that need a decision stand out.",
    ],
  },
  {
    id: "row",
    chip: "In a situation",
    title: "Something is going on with this stock, or an agent opened it",
    body: "A trigger fired or a clock came due: the floor broke, the price reached the buy, a report is close, a review is due. Or an agent asked for the stock by its ticker.",
    points: [
      "The same row every time, whatever the situation and whoever reads: an analyst's run, a trigger run, the Portfolio Manager, your chat.",
      "A field is there always, or when the stock has it: the position on a holding, a proposal when one waits, the paper record on a promoted stock.",
      "The situation changes one thing: which instructions are attached, once per read.",
    ],
  },
  {
    id: "full",
    chip: "With the research",
    title: "An agent asks for the long research",
    body: "get_theses with a ticker and include_research: a look that re-reads the case itself.",
    points: [
      "The row, plus the bull case, the bear case and the research summary.",
      "With include_history, every Activity line ever written on the stock, each with its id.",
      "It is the longest read, so it comes only when asked for.",
    ],
  },
  {
    id: "writer",
    chip: "Being rewritten",
    title: "The Writer rewrites the thesis",
    body: "A rewrite was ordered: from your chat, because the write-up went stale, or the one-time rewrite of the old theses.",
    points: [
      "The Writer gets the old claim, every trigger by id and the company line, in its own prompt. Nothing else from the sheet.",
      "Not the old cases, assumptions or conviction reason: those are what it is writing. It pulls the quote, the financials, the news and the Street fresh.",
    ],
  },
];

/** The fields a list of row keys lights: every sheet field one of the keys carries. */
export function fieldsLit(keys: readonly string[]): Set<string> {
  const set = new Set(keys);
  return new Set(SHEET_FIELDS.filter((f) => f.keys.some((k) => set.has(k))).map((f) => f.id));
}

/**
 * The shared texts and reads an agent is given, the ones the fewest agents
 * get first (a tie in its record's order), so what sets it apart leads: the
 * chips on the workflow diagram.
 */
export function partsByRarity(agent: FrameworkAgent, agents: readonly FrameworkAgent[]): FrameworkPart[] {
  const given_ = (p: FrameworkPart) => p.kind === "shared" || p.kind === "context";
  const blockIds = (a: FrameworkAgent) => [...new Set(a.parts.filter(given_).map((p) => p.id))];
  const given = new Map<string, number>();
  for (const a of agents) for (const id of blockIds(a)) given.set(id, (given.get(id) ?? 0) + 1);
  const first = blockIds(agent).map((id) => agent.parts.find((p) => given_(p) && p.id === id)!);
  return first.map((p, i) => ({ p, i })).sort((a, b) => (given.get(a.p.id) ?? 0) - (given.get(b.p.id) ?? 0) || a.i - b.i).map((x) => x.p);
}
