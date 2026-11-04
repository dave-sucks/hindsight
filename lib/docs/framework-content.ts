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
  "CRWD · held · LONG · PEAD · $418.20 · entry $401.00 · review 10-14 · catalyst 2026-12-02 · id th_8f2c";

/**
 * A thesis as the sheet shows it, field by field, in the sheet's order. Each
 * field names the keys of the row the agents read that carry it
 * (lib/agent/row-for-model.ts: every `put("…")`, the one line's parts, and
 * the writer's EXISTING THESIS block in lib/agent/run-thesis-writer.ts).
 * The read cases below say which keys each read sends; the page lights the
 * fields those keys carry.
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
  { id: "company", label: "About CrowdStrike", value: "CrowdStrike sells cloud-delivered endpoint and identity security on one agent; revenue is subscription, growing about 30% a year.", keys: ["company"] },
  { id: "belief", label: "Core thesis", value: "The platform keeps taking share as security budgets consolidate; what has to stay true is net new ARR above $200M a quarter.", keys: ["belief"] },
  { id: "assumptions", label: "Key assumptions", value: "Net new ARR above $200M, checked at the Q3 report on December 2 · gross margin holds above 78%", keys: ["assumptions"] },
  { id: "would_prove_it_wrong", label: "What would prove us wrong", value: "Net new ARR under $180M at the Q3 report · a second outage with customer churn named on the call", keys: ["would_prove_it_wrong"] },
  { id: "bull_case", label: "Bull case", value: "Five points: the beat and raise, Falcon Flex adoption, module attach, the margin step-up, the buyback.", keys: ["bull_case"] },
  { id: "bear_case", label: "Bear case", value: "Four points: valuation at 90× earnings, the July outage's legal tail, a slowing net new ARR cohort, insider selling.", keys: ["bear_case"] },
  { id: "conviction_rationale", label: "Conviction and its reason", value: "MEDIUM: the business is compounding, but the stock is extended 18% above its 50-day and estimates have not moved in a month.", keys: ["conviction_rationale", "note"] },
  { id: "variant_view", label: "Where we differ from the Street", value: "The Street models 25% growth; I think Flex pulls it to 30% because attach is running ahead of plan.", keys: ["variant_view"] },
  { id: "setup", label: "Setup", value: "Post-earnings drift: fails when the gap day's low breaks or revisions stall; manage with a 3 ATR trail after +10%.", keys: ["setup", "setup_lines", "nameTheSetup"] },
  { id: "triggers", label: "Every trigger, as a sentence", value: "Sell if below $384 on the close · Review if above 10% from our entry · Review 5 days before earnings · Review every 30 days", keys: ["triggers"] },
  { id: "plan_checks", label: "Plan checks", value: "The floor locks in +4.2% · the buy fired 3 days ago, unanswered", keys: ["plan_checks", "floor_risk", "buyBlockedByFull", "heldThroughFloor", "supersededBy"] },
  { id: "position", label: "Position", value: "Bought 14 shares at $404.10 on Oct 15, now $418.20 (+3.5%)", keys: ["position"] },
  { id: "proposal_waiting", label: "Proposal waiting", value: "sell 14 sh, placed 10-16 09:31 ET, expires 10-17", keys: ["proposal_waiting"] },
  { id: "price", label: "Live price", value: "$418.20, +6.8% today, 2.1% from the buy", keys: ["price"] },
  { id: "chart", label: "Chart numbers", value: "20d $402 · 50d $388 · 200d $351 · RSI 64 · vs the S&P +9% over 3M", keys: ["chart"] },
  { id: "street", label: "The Street", value: "23 buy / 7 hold / 0 sell · targets $380–$520, avg $451, from $432 a month ago · next-quarter EPS $1.04, 6 up / 1 down", keys: ["street"] },
  { id: "said", label: "Recent activity, the newest 8", value: "Today · Trigger: Review if above 10% from our entry · This week · Review: the beat held and the floor was raised to $384…", keys: ["said"] },
  { id: "situations", label: "Situations", value: "ADD_OR_WINNER (add or near target) · REVIEW_DUE (review due) · fired again, 3rd day", keys: ["situations", "repeat"] },
  { id: "research", label: "Research date", value: "Written 2026-10-05 at $39.55, 2 days ago", keys: ["research"] },
  { id: "catalyst", label: "Catalyst date", value: "2026-12-02, the next report", keys: ["catalyst"] },
  { id: "snapshot", label: "Snapshot", value: "A clean beat and raise; four targets raised after the call. The first paragraph on a short row, the whole text on a full one.", keys: ["snapshot"] },
  { id: "sections", label: "The seven old sections", value: "Recent catalysts · fundamentals · latest earnings · catalysts and events · analyst consensus · insider and technical · research data (no longer written; kept on old rows)", keys: ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"] },
  { id: "history", label: "History", value: "Every Activity line ever written on the stock, with its id", keys: ["history"] },
  { id: "paper_record", label: "Paper record", value: "Held 41 days on paper, +12.4%, 3 reviews (a promoted stock only)", keys: ["paper_record"] },
];

/** One way an agent reads a thesis: when it happens, which tool and size, why, and the keys it sends. */
export interface ReadCase {
  id: string;
  title: string;
  /** One line under the title on the case card. */
  body: string;
  /** The row size this read sends, or the writer's own block. */
  size: RowSize | "writer" | "none";
  /** What the agent is thinking as it asks. */
  ask: string;
  /** The tool row's label and the ticker's tag. */
  label: string;
  tag: string;
  when: string;
  how: string;
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
    body: "One line: the stock, the price, the plan, the next review.",
    size: "line",
    ask: "Reading the book before the open.",
    label: "Reading your book",
    tag: "Quiet",
    title: "A quiet stock",
    when: "Nothing about it is a situation today: no fire, no clock due, no plan check, no report near. Most of the book, most mornings.",
    how: "get_theses, every door. One line, about 120 characters: the stock, its stance and view, its setup, the price, the plan's three levels, a proposal if one waits, the next review, the catalyst date, its id.",
    why: "The agent should know the stock exists and where it stands, and nothing more. The belief, the cases, the triggers and the Street stay on the sheet until something changes.",
    keys: LINE_KEYS,
  },
  {
    id: "short",
    body: "It's listed: the short row, and that situation's text once.",
    size: "short",
    ask: "CRWD is near its buy. What does its plan say?",
    label: "Reading your book",
    tag: "Listed",
    title: "A stock in a situation: the morning run, the chat",
    when: "At least one situation is true of it today: a buy arrived, a review is due, a report is near, a plan check, a winner to press, a floor to raise.",
    how: "get_theses lists it as the short row, about 4,000 characters, and attaches each situation's text once per read.",
    why: "A decision is owed, so the whole view goes: the belief, the assumptions, the cases, the plan with every trigger, the position, the Street, the newest 8 Activity lines. Not the research essays, not the history.",
    keys: SHORT_KEYS,
  },
  {
    id: "trigger",
    body: "The short row again, with the setup's own rules in place of its name.",
    size: "short",
    ask: "The 10% review fired on CRWD. What does the setup say to do?",
    label: "Reading $CRWD for the fire",
    tag: "Fired",
    title: "A stock in a situation: the trigger run",
    when: "A trigger fired on this one stock during the day.",
    how: "The same short row, with the setup's own lines (how it fails, how to manage it) in place of the one-line setup. The full row is one get_theses call away.",
    why: "A fire is a decision about one stock against its setup's rules, so the rules ride along. Everything else is the same read the morning gets.",
    keys: SHORT_KEYS.map((k) => (k === "setup" ? "setup_lines" : k)),
  },
  {
    id: "full-rule",
    body: "A quiet watch woke, or no setup is named: the full row, unasked.",
    size: "full",
    ask: "CRWD woke after a quiet month. Does the research still stand?",
    label: "Reading $CRWD in full",
    tag: "By rule",
    title: "The full row, by rule",
    when: "Two situations: a quiet watch woke up, or a stock has no setup named. Both answers re-plan the research.",
    how: "get_theses sends the full row for it unasked: the short row plus the whole snapshot and the seven old sections.",
    why: "The decision is whether the research still stands, so the research comes. Still no history.",
    keys: [...SHORT_KEYS, ...FULL_EXTRA],
  },
  {
    id: "full-name",
    body: "Asked for by name: the full row and every line ever written on it.",
    size: "full",
    ask: "Pulling the full case on CRWD before deciding.",
    label: "Reading $CRWD in full",
    tag: "By name",
    title: "The full row, by name",
    when: "An agent asks for one stock: get_theses(tickers: [\"CRWD\"]). The chat does this on a question about a stock; a run does it before a buy.",
    how: "The full row plus the stock's history: every Activity line ever written on it, with its id.",
    why: "Asked by name means the agent wants everything the app knows about this one stock.",
    keys: [...SHORT_KEYS, ...FULL_EXTRA, "history"],
  },
  {
    id: "writer-refresh",
    body: "The old claim, the plan by id, the company line. Not the old cases.",
    size: "writer",
    ask: "Rewriting CRWD: what did we claim, and what is the plan?",
    label: "Writing $CRWD again",
    tag: "Refresh",
    title: "The Writer, refreshing a stock",
    when: "A refresh is dispatched: the owner's chat, a stale write-up, a quiet watch brought back, the one-time rewrite.",
    how: "The EXISTING THESIS block in the writer's prompt: status, direction, horizon, the belief, the target and floor, the company line, and every trigger by id. Then its own fresh pulls: quote, profile, financials, news, the Street, a web search.",
    why: "The writer rewrites the claim, so it gets the old claim to argue with and the plan to edit by id. It does not get the old assumptions, cases, conviction reason or variant view: those are what it writes.",
    keys: ["stock", "belief", "triggers", "company"],
  },
  {
    id: "writer-mint",
    body: "Nothing yet. The dispatch reason and the analyst\u2019s playbook.",
    size: "none",
    ask: "A new name. What is the dispatch asking for?",
    label: "Writing $CRWD for the first time",
    tag: "New",
    title: "The Writer, on a new stock",
    when: "A dispatch on a name with no thesis: the owner's chat, or a watchlist seed's first research.",
    how: "Only the dispatch reason, the analyst's strategy and setups, and the writer's own fresh pulls. No thesis fields exist yet.",
    why: "There is nothing to read. The writer's output is the first version of every field above.",
    keys: [],
  },
];

/** The fields a read lights: every sheet field one of the read's keys carries. */
export function fieldsLit(read: ReadCase): Set<string> {
  const keys = new Set(read.keys);
  return new Set(SHEET_FIELDS.filter((f) => f.keys.some((k) => keys.has(k))).map((f) => f.id));
}
