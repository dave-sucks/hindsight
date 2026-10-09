/**
 * What /docs/framework says that the code can't measure: the doors in plain
 * words, the one real request the Roadmap measured, and which parts of a
 * thesis each size of the read carries. Client-safe; the measured numbers
 * come from ./framework.ts on the server.
 */

export type FrameworkDoorId = "morning" | "trigger" | "chat" | "discovery" | "writer";

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

/** The doors in words. `save` is how many fields its save may send (Roadmap, step 10). */
export const DOOR_COPY: Record<FrameworkDoorId, { name: string; woken: string; job: string; read: string; analyst: string; save: string }> = {
  morning: {
    name: "Morning run",
    woken: "A clock: 8:00 AM on the analyst's run days",
    job: "Walk the whole book, every holding and every watch, and act where something changed.",
    read: "Asks for its book once and gets every stock at the size today needs.",
    analyst: "Always. It works for one analyst.",
    save: "26 fields",
  },
  trigger: {
    name: "Trigger run",
    woken: "A trigger fires on one of its stocks",
    job: "One stock, one decision: sell, buy, add, or say why not.",
    read: "Its one stock arrives in its own prompt block today. Step 10 (#818) moves it into the read.",
    analyst: "Always. The stock belongs to one analyst.",
    save: "12 fields",
  },
  chat: {
    name: "Chat",
    woken: "You type",
    job: "Answer you, look things up, and act only when you say so.",
    read: "Asks for stocks by name when the conversation needs them.",
    analyst: "When you open the chat on an analyst.",
    save: "25 fields",
  },
  discovery: {
    name: "Discovery",
    woken: "You start it",
    job: "Find up to five new stocks worth watching, inside the analyst's universe.",
    read: "Only the tickers it already covers, so it doesn't bring back the same names.",
    analyst: "Always. It searches for one analyst.",
    save: "A new watch, with record_thesis",
  },
  writer: {
    name: "Writer",
    woken: "Another agent asks for research on one stock",
    job: "Research one stock in depth and write its whole thesis.",
    read: "Its own pull of the stock's data, run in code before it writes.",
    analyst: "Always. It writes in the analyst's strategy.",
    save: "The whole thesis, with submit_thesis",
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
  short: "1,800 to 6,900 characters",
  full: "about 20,000 characters",
} as const;

export type RowSize = "line" | "short" | "full";

/**
 * A thesis as the sheet shows it, field by field, with the sizes of the read
 * that carry each one (lib/agent/row-for-model.ts in #816). A field in no
 * size stays on the screen and never reaches the model.
 */
export const SHEET_FIELDS: ReadonlyArray<{
  section: string;
  fields: ReadonlyArray<{ key: string; label: string; value: string; sizes: readonly RowSize[] }>;
}> = [
  {
    section: "The stock",
    fields: [
      { key: "stock", label: "Stock", value: "CRWD · watch · long · post-earnings drift", sizes: ["line", "short", "full"] },
      { key: "price", label: "Price", value: "$418.20, +6.8% today", sizes: ["line", "short", "full"] },
      { key: "said", label: "What you said", value: "\"Don't chase the gap.\"", sizes: ["short", "full"] },
    ],
  },
  {
    section: "Plan",
    fields: [
      { key: "plan", label: "Buy · target · floor", value: "$401 · $480 · $384", sizes: ["line", "short", "full"] },
      { key: "review", label: "Next review", value: "Oct 14", sizes: ["line"] },
      { key: "catalyst", label: "Catalyst", value: "Dec 2, next report", sizes: ["line", "short", "full"] },
      { key: "triggers", label: "Triggers", value: "Buy if within 2% of the 20-day · Sell if below $384 on the close", sizes: ["short", "full"] },
    ],
  },
  {
    section: "The case",
    fields: [
      { key: "belief", label: "Strategy", value: "Drifts toward $480 over two months as estimates rise.", sizes: ["short", "full"] },
      { key: "assumptions", label: "Assumptions", value: "Guidance holds · margins keep expanding", sizes: ["short", "full"] },
      { key: "wrong", label: "What would prove it wrong", value: "A close back under the gap day's low", sizes: ["short", "full"] },
      { key: "setup", label: "Setup", value: "Post-earnings drift: how it fails, how to manage it", sizes: ["short", "full"] },
    ],
  },
  {
    section: "Numbers",
    fields: [
      { key: "score", label: "Score", value: "7/10", sizes: ["line", "short", "full"] },
      { key: "chart", label: "Chart", value: "20d $402 · 50d $388 · RSI 64 · vs the S&P +9%", sizes: ["short", "full"] },
      { key: "snapshot", label: "Snapshot", value: "A clean beat and raise; four targets raised after the call.", sizes: ["short", "full"] },
    ],
  },
  {
    section: "Research",
    fields: [
      { key: "bull", label: "Bull case", value: "Five points", sizes: ["full"] },
      { key: "bear", label: "Bear case", value: "Four points", sizes: ["full"] },
      { key: "conviction", label: "Why this conviction", value: "Two paragraphs", sizes: ["full"] },
      { key: "variant", label: "Where we differ from the Street", value: "One paragraph", sizes: ["full"] },
      { key: "sections", label: "Fundamentals · earnings · filings · insiders", value: "Seven sections", sizes: ["full"] },
    ],
  },
];

/** What the model is handed for the example stock, by size. The one line is built the way row-for-model.ts builds it. */
export const EXAMPLE_LINE = "CRWD · watch · LONG · PEAD · $418.20 · buy $401.00 · target $480.00 · floor $384.00 · review 10-14 · score 7 · catalyst 2026-12-02 · id th_8f2c";
