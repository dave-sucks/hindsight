/**
 * What /how-it-works/framework says that the code can't measure: the doors in plain
 * words, the one real request the Roadmap measured, and which parts of a
 * thesis each size of the read carries. Client-safe; the measured numbers
 * come from ./framework.ts on the server.
 */

export type FrameworkDoorId = "morning" | "trigger" | "chat" | "writer";

/** A door as measured on the server. A null number is one the build couldn't take. */
export interface FrameworkDoor {
  id: FrameworkDoorId;
  model: string;
  maxSteps: number;
  promptChars: number | null;
  houseRules: boolean | null;
  tools: string[];
  toolChars: number | null;
}

export interface FrameworkSituation {
  code: string;
  name: string;
  chars: number;
  opening: string;
}

export interface FrameworkData {
  houseRulesChars: number;
  doors: FrameworkDoor[];
  situations: FrameworkSituation[];
  /** The read section's sample for each read, built through rowForModel (lib/docs/read-sample.ts). */
  readSamples: Record<string, string>;
}

/** The doors in words. `save` is how many fields its update_thesis may send (step 12, pinned by update-thesis-doors.test.ts). */
export const DOOR_COPY: Record<FrameworkDoorId, { name: string; woken: string; job: string; read: string; analyst: string; save: string }> = {
  morning: {
    name: "Morning run",
    woken: "A clock: 8:00 AM on the analyst's run days",
    job: "Walk the whole book, every holding and every watch, and act where something changed.",
    read: "Asks for its book once and gets every stock at the size today needs.",
    analyst: "Always. It works for one analyst.",
    save: "18 fields: the plan, the verdict and the note",
  },
  trigger: {
    name: "Trigger run",
    woken: "A trigger fires on one of its stocks",
    job: "One stock, one decision: sell, buy, add, or say why not.",
    read: "Its one stock's row from the same read every agent uses, with the fired trigger beside it.",
    analyst: "Always. The stock belongs to one analyst.",
    save: "11 fields: the plan and the note",
  },
  chat: {
    name: "Chat",
    woken: "You type",
    job: "Answer you, look things up, and act only when you say so.",
    read: "Asks for stocks by name when the conversation needs them.",
    analyst: "When you open the chat on an analyst.",
    save: "21 fields: also the belief and direction",
  },
  writer: {
    name: "Writer",
    woken: "Another agent asks for research on one stock",
    job: "Research one stock in depth and write its whole thesis.",
    read: "Its own pull of the stock's data, run in code before it writes.",
    analyst: "Always. It writes in the analyst's strategy.",
    save: "35 fields: the whole thesis, including the write-up only it may change",
  },
};

/**
 * One real request: a Secular Compounder morning run. The Oct 2 numbers and
 * the read with #816 were measured from a production request (Agent Rebuild
 * Roadmap); the analyst brief with #817 from that analyst's production row
 * (#817's description). The rest is measured from the code on the page.
 */
export const MEASURED_REQUEST = {
  before: { date: "Oct 2", instructions: 40_082, tools: 59_135, read: 266_767 },
  after: { read: 43_410, analystBrief: 6_291 },
  requestsPerMorning: 15,
} as const;

export const READ_SIZES = {
  line: "95 to 170 characters",
  short: "1,800 to 9,900 characters",
  full: "about 20,000 characters",
} as const;

export type RowSize = "line" | "short" | "full";

export const EXAMPLE_LINE =
  "CRWD · held · LONG · PEAD · $418.20 · buy $401.00 · target $480.00 · floor $384.00 · review 10-14 · catalyst 2026-12-02 · id th_8f2c";

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
  { id: "situations", label: "Situations", value: "ADD_OR_WINNER (add or near target) · REVIEW_DUE (review due) · fired again, 3rd day", keys: ["situations", "repeat"] },
  { id: "triggers", label: "The plan: every trigger, as a sentence", value: "Sell if below $384 on the close · Review if above 10% from our entry · Review if above the Street's average target · Review if within 5 days before earnings · Review every 30 days", keys: ["triggers"] },
  { id: "plan_checks", label: "Plan checks", value: "The buy fired 3 days ago, unanswered · at the $384 floor, 14 shares lose $281, 0.3% of the account", keys: ["plan_checks", "floor_risk", "buyBlockedByFull", "heldThroughFloor", "supersededBy"] },
  { id: "belief", label: "Core thesis", value: "The platform keeps taking share as security budgets consolidate; what has to stay true is net new ARR above $200M a quarter.", keys: ["belief"] },
  { id: "said", label: "Recent activity, the newest 8", value: "Today · Trigger: Review if above 10% from our entry · This week · Review: the beat held and the floor was raised to $384…", keys: ["said"] },
  { id: "street", label: "The Street", value: "23 buy / 7 hold / 0 sell · targets $380–$520, avg $451, from $432 a month ago · next-quarter EPS $1.04, 6 up / 1 down · room to the Street average is 1.0× the floor's distance from the price", keys: ["street"] },
  { id: "company", label: "About CrowdStrike", value: "CrowdStrike sells cloud-delivered endpoint and identity security on one agent; revenue is subscription, growing about 30% a year.", keys: ["company"] },
  { id: "setup", label: "Setup", value: "Post-earnings drift: fails when the gap day's low breaks or revisions stall; manage with a 3 ATR trail after +10%.", keys: ["setup", "setup_lines", "nameTheSetup"] },
  { id: "assumptions", label: "Key assumptions", value: "Net new ARR above $200M, checked at the Q3 report on December 2 · gross margin holds above 78%", keys: ["assumptions"] },
  { id: "would_prove_it_wrong", label: "What would prove us wrong", value: "Net new ARR under $180M at the Q3 report · a second outage with customer churn named on the call", keys: ["would_prove_it_wrong"] },
  { id: "bull_case", label: "Bull case", value: "Five points: the beat and raise, Falcon Flex adoption, module attach, the margin step-up, the buyback.", keys: ["bull_case"] },
  { id: "bear_case", label: "Bear case", value: "Four points: valuation at 90× earnings, the July outage's legal tail, a slowing net new ARR cohort, insider selling.", keys: ["bear_case"] },
  { id: "conviction_rationale", label: "Conviction and its reason", value: "MEDIUM: the business is compounding, but the stock is extended 18% above its 50-day and estimates have not moved in a month.", keys: ["conviction_rationale", "note"] },
  { id: "variant_view", label: "Where we differ from the Street", value: "The Street models 25% growth; I think Flex pulls it to 30% because attach is running ahead of plan.", keys: ["variant_view"] },
  { id: "snapshot", label: "Snapshot", value: "A clean beat and raise; four targets raised after the call. The first paragraph on a short row, the whole text on a full one.", keys: ["snapshot"] },
  { id: "research", label: "Research date", value: "Written 2026-10-05 at $39.55, 2 days ago", keys: ["research"] },
  { id: "catalyst", label: "Catalyst date", value: "2026-12-02, the next report", keys: ["catalyst"] },
  { id: "sections", label: "The seven old sections", value: "Recent catalysts · fundamentals · latest earnings · catalysts and events · analyst consensus · insider and technical · research data (no longer written; kept on old rows)", keys: ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"] },
  { id: "history", label: "History", value: "Every Activity line ever written on the stock, with its id", keys: ["history"] },
  { id: "paper_record", label: "Paper record", value: "Held 41 days on paper, +12.4%, 3 reviews (a promoted stock only)", keys: ["paper_record"] },
];

/**
 * One way an agent reads a thesis: the scenario in plain words, what is
 * sent, why that much, and the keys it sends. A new stock has nothing to
 * read, so the Writer's first pass is not one.
 */
export interface ReadCase {
  id: string;
  /** The chip: one or two words. */
  chip: string;
  /** The scenario, as a heading. */
  title: string;
  /** The scenario in one sentence, under the heading. */
  body: string;
  /** The row size this read sends, or the writer's own block. */
  size: RowSize | "writer";
  /** What is going on with the stock that puts it in this read. */
  when: string;
  /** What the agent is sent, in words. */
  how: string;
  /** Why that much and not more or less. */
  why: string;
  /** The row keys this read sends (the ones above, plus a few the line builds from the same facts). */
  keys: readonly string[];
}

/** The one line's parts (row-for-model.ts `line()`), by the sheet field they come from. */
const LINE_KEYS = ["stock", "id", "analyst", "price", "proposal_waiting", "research", "catalyst"] as const;
/** Every key the short row puts (row-for-model.ts `shortOrFull`, size "short"). */
const SHORT_KEYS = [
  "stock", "company", "id", "analyst", "situations", "said", "position", "proposal_waiting", "price", "plan_checks", "floor_risk", "triggers",
  "belief", "assumptions", "would_prove_it_wrong", "bull_case", "bear_case", "conviction_rationale", "variant_view", "setup", "nameTheSetup", "buyBlockedByFull",
  "heldThroughFloor", "supersededBy", "snapshot", "chart", "street", "research", "catalyst", "repeat", "note", "paper_record",
] as const;
const FULL_EXTRA = ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"] as const;

export const READ_CASES: ReadonlyArray<ReadCase> = [
  {
    id: "line",
    chip: "Nothing new",
    title: "Nothing is happening on this stock",
    body: "No trigger fired, no review is due, no report is near. Most of your book, most mornings.",
    size: "line",
    when: "The morning run and your chat read the whole book with one get_theses call. A stock with nothing going on today comes back as one line among the others.",
    how: "One line: the stock, its status, the price, the buy it waits on (the entry, on a holding), a proposal if one is waiting, the next review, the catalyst date, its id. It names no target and no floor: the levels are the triggers, and a quiet stock's are not read.",
    why: "The agent only needs to know the stock exists and where it stands. If it read the belief, the cases and every trigger on 30 quiet stocks every morning, the prompt would be 30 times longer and the quiet stocks would bury the ones that need a decision.",
    keys: LINE_KEYS,
  },
  {
    id: "short",
    chip: "Flagged today",
    title: "Something flagged it for today",
    body: "The price reached the buy, a review came due, a report is close, a winner should be pressed, a floor should be raised.",
    size: "short",
    when: "The same get_theses call, but this stock is in at least one situation today, so it comes back bigger than its neighbours. The morning run and your chat both see it this way.",
    how: "The short row, a few thousand characters: everything on the sheet except the old research essays and the history. The situation's own instructions are attached once per read.",
    why: "A decision is owed on this stock today, so the agent gets the whole case: what we believe, what would prove us wrong, the plan with every trigger, the position, the Street and the last 8 things said about it. The research write-up stays out because the decision is about the plan, not about re-researching the company.",
    keys: SHORT_KEYS,
  },
  {
    id: "trigger",
    chip: "Trigger fired",
    title: "A trigger fired during the day",
    body: "The price hit the floor, the 10% review, the earnings countdown. A small run wakes for this one stock.",
    size: "short",
    when: "The five-minute check saw a trigger cross its line. The trigger run is one agent, one stock, about 15 steps, and it is handed the stock instead of asking for it.",
    how: "The same short row as a flagged stock, with one swap: in place of the setup's name, the setup's own rules, how it fails and how to manage it.",
    why: "A fire is a question about one stock measured against its setup's rules, so the rules ride along. Everything else is exactly what the morning run would have seen, so the two can never disagree about the stock.",
    keys: SHORT_KEYS.map((k) => (k === "setup" ? "setup_lines" : k)),
  },
  {
    id: "full-rule",
    chip: "Research in doubt",
    title: "The research itself is in question",
    body: "A stock we only watched went quiet for weeks and just woke up, or a stock has no setup named at all.",
    size: "full",
    when: "Two situations do this. The question is not what the plan says but whether the research behind it still holds, and the agent has to re-plan the stock.",
    how: "The full row, without being asked for: the short row plus the whole snapshot and the seven old research sections.",
    why: "You cannot judge whether research still stands without the research. The history still stays out: it is long, and the question is about today's facts.",
    keys: [...SHORT_KEYS, ...FULL_EXTRA],
  },
  {
    id: "full-name",
    chip: "Asked by name",
    title: "An agent asks for one stock by name",
    body: "get_theses with a ticker. Your chat does this when you ask about a stock; a run does it right before a buy.",
    size: "full",
    when: "The agent already knows which stock it cares about and wants all of it, not the book.",
    how: "The full row plus the history: every Activity line ever written on the stock, each with its id.",
    why: "Asking by name means the agent wants everything the app knows about this one stock. One stock's history fits in a prompt where 30 stocks' would not.",
    keys: [...SHORT_KEYS, ...FULL_EXTRA, "history"],
  },
  {
    id: "writer-refresh",
    chip: "Being rewritten",
    title: "The Writer rewrites the thesis",
    body: "A rewrite was ordered: from your chat, because the write-up went stale, or the one-time rewrite of the old theses.",
    size: "writer",
    when: "The Writer is a different agent. It does not trade on the thesis; it writes it, from fresh pulls of the quote, the profile, the financials, the news, the Street and a web search.",
    how: "Only the old claim, every trigger by id and the company line, in its prompt. Not the old assumptions, cases, conviction reason or variant view.",
    why: "Those are what it is writing. If it read its own last answer it would copy it. It gets the claim to argue with and the triggers to edit by id, and pulls everything else fresh.",
    keys: ["stock", "belief", "triggers", "company"],
  },
];

/** The fields a read lights: every sheet field one of the read's keys carries. */
export function fieldsLit(read: ReadCase): Set<string> {
  const keys = new Set(read.keys);
  return new Set(SHEET_FIELDS.filter((f) => f.keys.some((k) => keys.has(k))).map((f) => f.id));
}
