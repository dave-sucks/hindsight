/**
 * What /how-it-works/framework shows, as the server hands it down: every
 * agent's parts as the engine built them from its record (./framework.ts),
 * the situation texts, and which parts of a thesis each size of the read
 * carries. Client-safe.
 */

import type { PartId } from "@/components/docs/framework/swatch";

/** Where a part of a request goes: the instructions, the first message, or each new message of a conversation. */
export type FrameworkWhere = "instructions" | "message" | "newest";

/** Each place a part can go, in the order a request is read, as the page names it. */
export const WHERE_LABEL: Record<FrameworkWhere, string> = {
  instructions: "Its instructions",
  message: "Its first message",
  newest: "On each new message you send",
};

/** One part of an agent's request, in its record's order. */
export interface FrameworkPart {
  /** The own part's key, or the block's id. */
  id: string;
  title: string;
  /** Its own words, or a block from the library. */
  kind: "own" | "block";
  where: FrameworkWhere;
  /** A block's line from the library; for its own words, how they open on the sample. */
  about: string;
  /** The file its text comes from. */
  source: string;
  /** Its own words, written for each run (a date, the account) rather than one fixed text. */
  perRun?: boolean;
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

/** When a sheet field is sent on a row in a situation (lib/agent/row-for-model.ts ROW_FIELDS, read on the server by lib/docs/read-grid.ts). */
export type ReadWhen = "always" | "situations" | "review" | "named";

export interface ReadGridRow {
  fieldId: string;
  when: ReadWhen;
  /** For "situations": the situations that send it, in rank order, each with what puts a stock in it. */
  situations: Array<{ code: string; name: string; origin: SituationOrigin }>;
}

/** The read section, built on the server from the one builder: which keys each read sends, each read as the model gets it, and the grid. */
export interface FrameworkRead {
  keys: { line: string[]; review: string[]; named: string[]; writer: string[]; bySituation: Record<string, string[]> };
  samples: { line: string; review: string; named: string; bySituation: Record<string, string> };
  grid: ReadGridRow[];
}

export interface FrameworkData {
  agents: FrameworkAgent[];
  situations: FrameworkSituation[];
  read: FrameworkRead;
}

export type RowSize = "line" | "short" | "full";

/** The one line's parts (row-for-model.ts `line()`), by the sheet field they come from. */
export const LINE_KEYS = ["stock", "id", "analyst", "price", "proposal_waiting", "research", "catalyst"] as const;
/** What the Writer's prompt carries of the existing thesis (lib/agent/run-thesis-writer.ts). */
export const WRITER_KEYS = ["stock", "belief", "triggers", "company"] as const;

/** The quiet line for the page's CRWD row, as rowForModel builds it (pinned to the builder by lib/docs/read-cases.test.ts). */
export const EXAMPLE_LINE =
  "CRWD · held · LONG · PEAD · paid $404.10 · proposal waiting: sell 14 sh, placed 10-16 09:31 ET, expires 10-17 09:31 ET · review 10-14 · catalyst 2026-12-02 · id th_8f2c";

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
  { id: "said", label: "Activity, the newest 8 lines", value: "Today · Trigger: Review if above 10% from our entry · This week · Review: the beat held and the floor was raised to $384…", keys: ["said"] },
  { id: "street", label: "The Street", value: "23 buy / 7 hold / 0 sell · targets $380–$520, avg $451, from $432 a month ago · next-quarter EPS $1.04, 6 up / 1 down · room to the Street average is 1.0× the floor's distance from the price", keys: ["street"] },
  { id: "company", label: "About CrowdStrike", value: "CrowdStrike sells cloud-delivered endpoint and identity security on one agent; revenue is subscription, growing about 30% a year.", keys: ["company"] },
  { id: "setup", label: "Playbook", value: "Post-earnings drift: fails when the gap day's low breaks or revisions stall; on a watch, the triggers that come with the buy.", keys: ["setup", "playbook_checks"] },
  { id: "assumptions", label: "Key assumptions", value: "Net new ARR above $200M, checked at the Q3 report on December 2 · gross margin holds above 78%", keys: ["assumptions"] },
  { id: "would_prove_it_wrong", label: "What would prove us wrong", value: "Net new ARR under $180M at the Q3 report · a second outage with customer churn named on the call", keys: ["would_prove_it_wrong"] },
  { id: "bull_case", label: "Bull case", value: "Five points: the beat and raise, Falcon Flex adoption, module attach, the margin step-up, the buyback.", keys: ["bull_case"] },
  { id: "bear_case", label: "Bear case", value: "Four points: valuation at 90× earnings, the July outage's legal tail, a slowing net new ARR cohort, insider selling.", keys: ["bear_case"] },
  { id: "conviction_rationale", label: "Conviction and its reason", value: "MEDIUM: the business is compounding, but the stock is extended 18% above its 50-day and estimates have not moved in a month.", keys: ["conviction_rationale"] },
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
  id: "line" | "situation" | "review" | "named" | "writer";
  /** The chip: one or two words. */
  chip: string;
  /** The scenario, as a heading. */
  title: string;
  /** The scenario in one sentence, under the heading. */
  body: string;
  /** The row size this read sends, or the writer's own block. */
  size: RowSize | "writer";
  /** What is sent and why, two or three short lines. */
  points: readonly string[];
}

export const READ_CASES: ReadonlyArray<ReadCase> = [
  {
    id: "line",
    chip: "Nothing new",
    title: "Nothing is happening on this stock",
    body: "No trigger fired, no review is due, no report is near. Most of the book, most mornings.",
    size: "line",
    points: [
      "One line: the stock, its status, the price, the buy it waits on, a proposal if one is waiting, the next review, the catalyst date, its id.",
      "No target and no floor: the levels are the triggers, and a quiet stock's are not read.",
      "Thirty quiet stocks stay thirty lines, so the ones that need a decision stand out.",
    ],
  },
  {
    id: "situation",
    chip: "In a situation",
    title: "Something is going on with this stock",
    body: "A trigger fired or a flag is up: the floor broke, the price reached the buy, a report is close, a winner should be pressed.",
    size: "short",
    points: [
      "A blue field with no badge goes on every stock in a situation.",
      "A blue field with badges goes only when one of those situations is on the stock. Two situations, both sets.",
      "A field's content never changes with the situation; only whether it goes. The situation's own instructions are attached once per read.",
    ],
  },
  {
    id: "review",
    chip: "Review due",
    title: "The review clock came due",
    body: "The stock's own review trigger fired. The one situation that reads the whole case.",
    size: "short",
    points: [
      "Everything on the sheet except the history.",
      "The bull and bear cases are read here and nowhere else in a run.",
      "A review is about the case itself, not one level, so the case has to be in front of it.",
    ],
  },
  {
    id: "named",
    chip: "Asked by name",
    title: "An agent asks for one stock by name",
    body: "get_theses with a ticker: your chat when you ask about a stock, a run right before a buy.",
    size: "full",
    points: [
      "The full row: everything the review clock reads, and every Activity line ever written, each with its id.",
      "One stock's history fits in a prompt where thirty stocks' would not.",
    ],
  },
  {
    id: "writer",
    chip: "Being rewritten",
    title: "The Writer rewrites the thesis",
    body: "A rewrite was ordered: from your chat, because the write-up went stale, or the one-time rewrite of the old theses.",
    size: "writer",
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
 * The blocks an agent is given, the ones the fewest agents get first (a tie
 * in its record's order), so what sets it apart leads: the chips on the
 * workflow diagram.
 */
export function blocksByRarity(agent: FrameworkAgent, agents: readonly FrameworkAgent[]): FrameworkPart[] {
  const blockIds = (a: FrameworkAgent) => [...new Set(a.parts.filter((p) => p.kind === "block").map((p) => p.id))];
  const given = new Map<string, number>();
  for (const a of agents) for (const id of blockIds(a)) given.set(id, (given.get(id) ?? 0) + 1);
  const first = blockIds(agent).map((id) => agent.parts.find((p) => p.kind === "block" && p.id === id)!);
  return first.map((p, i) => ({ p, i })).sort((a, b) => (given.get(a.p.id) ?? 0) - (given.get(b.p.id) ?? 0) || a.i - b.i).map((x) => x.p);
}
