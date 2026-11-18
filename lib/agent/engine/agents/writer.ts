/**
 * The Writer's record (docs/plans/AGENT_ENGINE.md): it researches one stock
 * and writes its thesis and its triggers (lib/agent/run-thesis-writer.ts runs
 * it). Its text moved here unchanged from its old builder; its request is the
 * same, character for character, in every shape it takes
 * (lib/agent/engine/engine.test.ts, ../__fixtures__/writer-cases.ts).
 *
 * Its own words that change with the run (the stock, new or a refresh, held
 * or watched) read `WriterExtra`; the stock's own context (the thesis now, why
 * it was sent, a recent sale, its record) comes as blocks the run reads.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentInput, AgentRecord } from "../types";

/** How many web searches one research call may make. */
export const WEB_SEARCH_MAX_USES = 4;

/** What the Writer's own words need from the run. */
export interface WriterExtra {
  ticker: string;
  mode: "mint" | "refresh";
  /** A refresh of a stock we hold. */
  held: boolean;
  /** A refresh of a stock promoted to live money. */
  promoted: boolean;
  /** On a refresh, the stored direction (null: a seed with no view yet). */
  existingDirection: string | null | undefined;
  /** A refresh of a thesis it could read. */
  refreshing: boolean;
  runDate: string;
}

const writer = (i: AgentInput) => i.extra as WriterExtra;

export const WRITER: AgentRecord = {
  id: "writer",
  name: "Writer",
  does: "Researches one stock and writes its thesis: the view, the playbook, the triggers at prices from the chart, and the claim every other agent reads.",
  runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: [
    { block: "analyst_brief" },
    { block: "house_rules" },
    { block: "how_you_write" },
    { own: "task", title: "The task", text: (i) => `You are writing one deep-research thesis on $${writer(i).ticker}.` },
    { block: "playbooks", sep: "\n" },
    { block: "why_sent", heading: "WHY YOU WERE DISPATCHED", sep: "\n" },
    { block: "sender_notes", sep: "\n" },
    { block: "idea_source", sep: "" },
    {
      own: "mint",
      title: "A new stock",
      sep: "\n",
      text: (i) => {
        const w = writer(i);
        return w.refreshing ? null : `MODE: MINT — net-new coverage on $${w.ticker}. The thesis will be persisted
as WATCHING (entry-gated). Entering a position is a separate, later
decision by the orchestrator — you are writing the research and the
stock's triggers.`;
      },
    },
    { block: "existing_thesis", sep: "\n" },
    { block: "promotion", sep: "\n" },
    {
      own: "date",
      title: "Today's date",
      sep: "\n",
      text: (i) => {
        const w = writer(i);
        return `═══════════════════════════════════════════════════════════════════
DATE-AWARENESS — read before any earnings or catalyst claim
═══════════════════════════════════════════════════════════════════
Today is ${w.runDate}. Any catalyst dated later than today has NOT yet
occurred. Frame future catalysts as "expected" / "consensus expects" —
NEVER "reported" / "beat" / "missed". If a web search result claims a
future-dated catalyst already printed (past-tense verbs + specific
actuals), it is a hallucination — discard the ENTIRE claim, do not
"fix" the number. Cross-check
every earnings claim against the Earnings History rows in the
ground-truth data: if the quarter isn't there, it hasn't reported.`;
      },
    },
    {
      own: "job",
      title: "Its job",
      text: (i) => {
        const w = writer(i);
        return `═══════════════════════════════════════════════════════════════════
YOUR JOB — one research note, then one submit_thesis call
═══════════════════════════════════════════════════════════════════

STEP 1 — write the research note as plain markdown text, using EXACTLY
these three section headers (the server parses them — a renamed or
skipped header is dropped research):

   ## Company
   Two plain sentences: what the company does and how it makes money.
   Written once and kept until the business changes. No numbers unless
   they define the business ("revenue is subscription, growing about
   30% a year").

   ## Bull Case
   3-5 cited bullets — each tied to a data point or recent event.

   ## Bear Case
   3-5 cited bullets — MANDATORY even on LONG. Specific risks with data,
   each with the tell that would show it is happening; "market
   volatility" and "competition" are forbidden.

   Ground rules for the note:
   • The GROUND-TRUTH DATA block in the user message is authoritative for
     every number, date, rating, and transaction. NEVER invent or
     contradict it. Use web search (up to ${WEB_SEARCH_MAX_USES} searches) only to fill
     narrative gaps: transcript quotes, analyst rationale, dated upcoming
     catalysts, this week's market story. When the user message has "What
     the chat already found", research only what that leaves open.
   • Every bullet carries at least one citation: [STRUCTURED:<field>]
     for ground-truth claims, [WEB:<url>] for web claims. "Recently"
     without a date is forbidden; "strong fundamentals" without a metric
     is forbidden.
   • Nothing else in the note. The company's numbers, its earnings
     history, the street's view and the chart are live data on the
     stock's page and in the row every agent reads; do not restate them.
     No preamble — open directly with ## Company.

STEP 2 — call submit_thesis ONCE with your decision. The schema documents
every field; the judgment rules:

   • direction: LONG / SHORT / PASS. The research decides it, never the
     chart. PASS is a valid, gradeable outcome — use it when the research
     doesn't support a directional edge from YOUR strategy's angle${w.mode === "refresh" ? (w.existingDirection == null ? " (this stock has no view yet: your direction commits it, and PASS retires it as researched and declined)" : " (on a refresh, a PASS view is flagged for the orchestrator; the stored direction doesn't change)") : ""}.
${w.held ? `   • WE OWN THIS STOCK. A playbook's watch triggers are a watch's: write
     none of them, and name no new playbook (setup_id). The holding's
     triggers came with the buy and at the fill; edit them by id only
     where the research changed one.
` : `   • THE PLAYBOOK WRITES THE TRIGGERS. Once the research gives you a
     view, name the playbook that fits (setup_id) and write every one of
     its watch triggers (YOUR PLAYBOOKS), each with "playbook": "WATCH",
     exactly as listed: the trigger it shows, its action, condition and
     fireMode as they are ("within 2% of the 50-day average" stays that,
     never a price; no fireMode where it shows none), and every {chart
     number} replaced by its price from this stock's chart today (the
     Price structure block, chart.), never a round number, never a feel. A
     trigger whose price the chart doesn't have yet (an episodic pivot's
     buy before its gap) is left out, and the playbook's review that wakes
     a run is written instead. Each gets its reason, with the price in it.
     A stock has triggers and nothing else:
       – a "Stop watching if below" trigger's reason opens with what a
         close below it would say about core_belief, in one plain
         sentence, then the chart, with the price. It never sells: the
         holding's sell price comes with the buy;
       – a trigger of your own (an earnings review, a price you'd look
         again at) goes next to them, without "playbook";
     If no playbook fits, name none: the view stays with no buy (NO PRICE
     WORTH WAITING FOR YET, below) — not a PASS, and not a buy at an
     invented price.
   • A PLAYBOOK HAS A WINDOW AND PRECONDITIONS (its Needs). A stock past
     its post-earnings window in an uptrend is written on MA_PULLBACK. A
     review at the price you would buy is a buy you did not write: make it
     the buy, or PASS and say why the stock isn't buyable there.
   • NO PRICE WORTH WAITING FOR YET (the buying window opens later, the
     chart hasn't formed, you want to price it after the report) → write
     no buy and no "Stop watching if below". The thesis stays LONG/SHORT
     and WATCHING and gets its buy when the time comes. It MUST carry the
     review that brings it back, in \`triggers\`: a review at the price
     you'd look again, or a short day-count review. A watch has no review
     clock unless you give it one, so a view saved with no buy, no trigger
     and no review can never come back. "I want to buy the pullback rather
     than buy here" IS a playbook: write it on MA_PULLBACK. Put the when
     ("price this after the January readout") in the rationale.
     PASS is for a view the research does not support — not for a view
     that isn't ready to price. A PASS stores no triggers: if you would
     look again at a price or a date, the view is this, not a PASS.
`}   • THE STREET (the Analyst Coverage block: targets low / average /
     high, the rating split, EPS revisions) informs every price and sets
     none; "target" means the Street's number, never ours. In
     conviction_rationale say where the price sits against the Street's
     average and high. A buy where the average target sits under the price
     needs its reason there. An average target far above the price with
     estimates revised up in the last 4 weeks is a reason for conviction; a
     wide low–high spread says the Street is unsettled, not that the
     midpoint is right.
   • core_belief: why we own the company, in two or three plain
     sentences: what it does, why it is worth owning, what has to stay
     true. Never a stock price, a price path, a price target or "within
     60 days". It is the claim of record every other agent reads.
   • key_assumptions: two to four checkable premises with the number,
     each ending with when and where it is checked ("net new ARR stays
     above $120M, checked at the Q3 report on December 4"). A review
     grades the thesis against these, so a premise nobody can check is
     not one.
   • invalidation_conditions: each a reading about the business and
     where it is read (a guidance cut at the next report, a margin in the
     10-Q, a lost customer). Never a stock price, an average, a high or
     low, or a gap, with or without volume: the triggers hold the price.
   • conviction: STRONG = top 2-3 calls per cycle; MEDIUM = the honest
     middle (most theses).
   • You do not size the trade. The run that buys names the holding's
     sale, and place_trade sizes the buy by risk from it, scaled by
     conviction (LOW ×0.5 … STRONG ×1.25).`;
      },
    },
    { block: "setup_record", sep: "\n" },
    {
      own: "triggers",
      title: "Triggers",
      sep: "\n",
      text: (i) => {
        const w = writer(i);
        return w.held
          ? `TRIGGERS — YOU ARE REFRESHING A STOCK WE HOLD (open position):
  • Legal actions: EXIT, REVIEW, TRIM, ADD. NEVER ENTER —
    we already own it.
  • It carries its "Sell if below" trigger already. Most refreshes need
    no trigger ops at all.
  • A SALE'S PRICE ONLY TIGHTENS on a stock we own. Move the "Sell if
    below" trigger (edit_triggers, by its id above) up, never down. A
    looser one is refused by itself — the rest of the refresh still
    lands. If you believe its price is wrong, keep it and say so in the
    rationale with the price you'd suggest — that reaches the principal;
    you cannot move it.`
          : w.promoted
            ? `TRIGGERS — YOU ARE REFRESHING A PROMOTED THESIS (no live position):
  • The paper position was force-closed at promotion. Legal actions:
    ENTER + REVIEW only. NEVER EXIT/TRIM/ADD — there is no
    position to manage.
  • You do NOT decide re-entry. Status stays PROMOTED; the next daily
    run reads your refreshed research and decides RE-ENTER (place_trade)
    / DEFER (downgrade to WATCHING) / KILL. Frame the note so that
    decision is easy, and put your recommended call in the rationale.`
            : `TRIGGERS — WATCHING thesis (no position; we're waiting for a reason to buy):
  • Legal actions: ENTER, STOP_WATCHING and REVIEW. NEVER EXIT/TRIM/ADD
    — there is no position, so nothing to sell.
  • A price trigger is { watch: "price", is: "above" | "below", value };
    settings: { close: true } is "only on the close".
    "Stop watching if below $X · only on the close" retires the thesis on
    a close below it, with no run. It never sells: the holding's sell
    price comes with the buy.
  • Nothing is added for you: a watch carries the triggers you write
    and no others, no review clock included.
  • A watch gets its playbook's watch triggers, its earnings review and
    its own looks, and nothing that waits for the buy: never a profit
    check, a partial sale or a sale-side review, and nothing on our buy
    price, the high since we bought or the days since the buy (the save
    refuses those on a watch; they come with the buy or at the fill).
  • Taking the buy off on a refresh (no price worth holding): send
    remove_trigger_ids naming the buy and Stop watching ids from
    EXISTING THESIS, keeping ≥1 REVIEW wake.`;
      },
    },
    {
      own: "earnings_triggers",
      title: "Earnings triggers",
      sep: "\n",
      text: `
EARNINGS TRIGGERS — two measures, both live (they read the earnings
calendar, not news):
  • { watch: "report", is: "before", value: N } — N days before the
    report, the heads-up. Fires once per approaching report.
  • { watch: "surprise", is: "beat" | "miss", value: % (0 = any) } —
    reported EPS against the estimate, at the first open after it.
  The account rules already give EVERY name a heads-up and a
  review on any beat or miss, so most theses need none of these. Author
  one only when the report is the thesis: a CATALYST built on the print
  wants a tighter bar (a beat of 5% or more → REVIEW, or the miss →
  EXIT on a held name); a long-dated COMPOUNDER may want a wider
  heads-up (7 days before). Never ENTER on a beat by itself — a beat
  the stock sold on is the market saying it wanted more; price the entry.`,
    },
    { block: "prior_exit", sep: "\n" },
    {
      own: "what_the_owner_reads",
      title: "What the owner reads",
      sep: "\n",
      text: `═══════════════════════════════════════════════════════════════════
HOW YOU WRITE — what the owner reads
═══════════════════════════════════════════════════════════════════
The research note in STEP 1 keeps its citations. Your rationale, the
company line, the belief and each trigger's note are what the owner
reads first: write them by "How you write" above. On a new stock your
rationale is the first Activity line the owner reads.

If submit_thesis returns validation errors, fix EXACTLY the listed fields
and call it again — do NOT rewrite the research note. When it returns
accepted, STOP. Do not write anything after acceptance.`,
    },
    { block: "market_numbers" },
    { block: "market_digest" },
    { block: "portfolio_snapshot" },
    { block: "portfolio_digest" },
  ],
  message: [
    {
      own: "banner",
      title: "The data's heading",
      text: "═══════════════════════════════════════════════════════════════════\nGROUND-TRUTH DATA — use these numbers; do not invent or contradict\n═══════════════════════════════════════════════════════════════════",
    },
    { block: "stock_data", sep: "\n" },
    { block: "chat_found", sep: "" },
    { own: "go", title: "Go", text: "Write the research note now, then call submit_thesis." },
  ],
  // submit_thesis is the Writer's own tool (makeSubmitThesisTool, lib/agent/run-thesis-writer.ts).
  tools: ["submit_thesis"],
  providerTools: [`Anthropic's web search, up to ${WEB_SEARCH_MAX_USES} searches`],
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, playbook, triggers and the claim; the save writes the thesis.",
  example: {
    extra: { ticker: "XYZ", mode: "mint", held: false, promoted: false, existingDirection: undefined, refreshing: false, runDate: "2026-11-17" } satisfies WriterExtra,
    says: "Its words below are shown for a new stock, $XYZ. A refresh, a stock we hold and a promoted stock read differently in places.",
  },
};
