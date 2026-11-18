/**
 * The trigger run's record (docs/plans/AGENT_ENGINE.md): one stock, one
 * fired trigger, one decision, or the write-up of an Auto trade
 * (lib/inngest/functions/tactical-run.ts runs it). Its text moved here
 * unchanged from its old builder; its request is the same, character for
 * character, in every shape it takes (lib/agent/engine/trigger-run.engine.test.ts,
 * ../__fixtures__/trigger-run-cases.ts).
 *
 * Its own words that change with the run (the stock, the trigger, Auto or
 * not) read `TriggerRunExtra`; the stock's row, what fired, its situations
 * and the fire's facts come as blocks the run reads.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentInput, AgentRecord } from "../types";

/** What the write-up of an Auto trade asks: the trade is made (or tried), and this run says what it thinks of it. */
export const AUTO_WRITEUP = `When: a trigger set to Auto made or tried a trade on this stock with no analyst deciding: a buy, an add, a trim or a sale, proposed to the principal, already sent, or refused (the run's opening line says which). This run writes it up. It cannot trade.

Answer, in order:
1. What is going on with the company and the stock, and why: its news, its sector, the market (get_stock_data, one web_search)? If the trigger watched a report or a filing, read it first.
2. Does that touch why we own it, or why we wanted it? Go down \`would_prove_it_wrong\`: has any of it happened? In the note, name only what has.
3. Do you agree with the trade? If they passed on it before (\`heldThroughFloor\`, \`said\`), what is different today?

What you can do:
- Write one update_thesis with trigger_id: your note, which the principal reads on the trade.
- If you would do something different, say so plainly in the note and why: hold instead of sell, wait instead of buy, a smaller trim. The principal decides on the approval, or on a trade that already went through.
- Change a trigger only if the trade left one plainly stale.

Answered: that one update_thesis.

The note: what is going on with the company and the stock and why, and what it means for why we own it; then the trade in one sentence ("your Auto-sell at $196 was hit, so the sale is waiting for you", or why it was refused) and whether you agree, and if not, what you would do instead.

Mistakes:
- Explaining the trigger instead of the company: the principal knows it fired.
- Calling a trade tool: this run has none.`;

/** What the trigger run's own words need from the run. */
export interface TriggerRunExtra {
  ticker: string;
  /** The trigger was set to Auto and the trade is made: this run writes it up. */
  auto: boolean;
  /** The Auto trade, in one sentence. */
  autoLine: string;
  /** The fired trigger's condition, as a sentence. */
  predicateSummary: string;
  action: string;
  triggerId: string;
  /** The price it fired at, when the check had one. */
  firedPrice: number | null;
  /** A review on a stock we only watch is shown the analyst's playbooks. */
  hasPlaybooks: boolean;
  /** A buy or an add, not an Auto trade: a decline they made stands until what they named changes. */
  declineLine: boolean;
}

const tr = (i: AgentInput) => i.extra as TriggerRunExtra;

export const TRIGGER_RUN: AgentRecord = {
  id: "trigger_run",
  name: "Trigger run",
  does: "Decides on one stock when one of its triggers fires: a trade (it waits for you), a trigger moved, or a note on why nothing; or writes up a trade an Auto trigger made.",
  runsWhen: "Every 5 minutes in market hours and at the 4:20 PM close check, when a trigger set to Send to Agent or Auto fires.",
  model: MODES["tactical"].model,
  maxSteps: MODES["tactical"].maxSteps,
  instructions: [
    { block: "analyst_brief" },
    {
      own: "intro",
      title: "What happened",
      text: (i) => {
        const t = tr(i);
        return t.auto ? `Your $${t.ticker} trigger "${t.predicateSummary}" fired. It is set to Auto, so no analyst decided: ${t.autoLine} Find out what is going on with the company and the stock today and write the note the principal reads with this trade.` : `A trigger on your $${t.ticker} thesis just fired. Find out what is going on with the company and the stock today, decide what to do, and write the review the principal reads: one decision.`;
      },
    },
    {
      own: "discipline",
      title: "Tool-call discipline",
      text: (i) => {
        const t = tr(i);
        return `═══════════════════════════════════════════════════════════════════
TOOL-CALL DISCIPLINE — read first
═══════════════════════════════════════════════════════════════════

Every assistant turn between this prompt and complete_run MUST include
at least one tool call. Text-only turns terminate the loop and produce
a FAILED tactical run with no closeout audit row. Act, don't summarize.

After get_stock_data returns, the next turn is ${t.auto ? "the update_thesis call with your note." : `the action call (or
the update_thesis closeout if the check failed).`} NOT a markdown
"now I'll evaluate this" paragraph. ${t.auto ? "The write-up" : "The decision framework"} below is
short — read once, then execute.

Forbidden assistant-turn endings (each = run failure):
  - "Next, I'll proceed to..."
  - "Let me now focus on..."
  - "Now I'll decide..."
  - Any turn that ends without a tool call.`;
      },
    },
    { block: "market_numbers" },
    { block: "market_digest" },
    { block: "portfolio_snapshot" },
    { block: "portfolio_digest" },
    { block: "stock_row" },
    { block: "playbooks" },
    {
      own: "belief",
      title: "The belief",
      sep: (i) => (tr(i).hasPlaybooks ? "\n" : "\n\n"),
      text: (i) => {
        const t = tr(i);
        return `**The row's \`belief\` IS your analyst's standing opinion on this name.** It's why we own the company and what has to stay true; every downstream decision (including this one) reads it as the claim of record. Verify whether the belief is still operative against the fresh data the trigger surfaced — ${t.auto ? "and say in the note whether the trade fits it." : "and act through the trigger's declared action."} If material new evidence contradicts the belief, call \`update_thesis\` to refresh the belief; don't free-think a different opinion in your rationale.`;
      },
    },
    { own: "anchor", title: "What would prove it wrong", text: `**Anchor your decision to the row's \`would_prove_it_wrong\`, not the price level alone.** The trigger fired on price — that's necessary but not sufficient. The \`would_prove_it_wrong\` lines are what would invalidate the trade; check whether any of them have come true since the research was written.` },
    { own: "declined", title: "A declined buy", text: (i) => (tr(i).declineLine ? "If they declined this same buy and nothing they named has changed, say so and pass." : null) },
    { block: "house_rules", sep: (i) => (tr(i).declineLine ? "\n" : "\n\n") },
    { block: "how_you_write" },
    { block: "fired_trigger" },
    {
      own: "path",
      title: "The path",
      sep: "\n",
      text: (i) => {
        const t = tr(i);
        return `
PATH: the predicate fired on the 5-minute check.${
    t.firedPrice != null ? `\n  It fired at $${t.firedPrice.toFixed(2)}.` : ""
  }
  Check the latest quote and any recent news on $${t.ticker} via get_stock_data.
  If get_stock_data comes back with no live quote (its \`quote\` is null, or
  \`technicals.priceIsLive\` is false), the price in its chart block is the
  LAST CLOSE, not now — act on the fired price above, never on yesterday's
  close.
`;
      },
    },
    {
      own: "writeup",
      title: "The write-up",
      sep: "\n",
      text: (i) => {
        const t = tr(i);
        return t.auto ? `═══════════════════════════════════════════════════════════════════
THE WRITE-UP
═══════════════════════════════════════════════════════════════════

1. Find out what is going on.
   - get_stock_data($${t.ticker}): the live price and the company's news.
   - One web_search: why $${t.ticker} is moving and the latest on the
     company.

2. Write EXACTLY one update_thesis call with trigger_id="${t.triggerId}".
   Its rationale is your note: the principal reads it on the trade.
   - What the write-up asks:

${AUTO_WRITEUP}

   - This run has no trade tools. If you would do something different,
     say so in the note and why.

3. Then complete_run.

` : null;
      },
    },
    {
      own: "framework",
      title: "Decision framework",
      sep: "\n",
      text: (i) => {
        const t = tr(i);
        return t.auto ? null : `═══════════════════════════════════════════════════════════════════
DECISION FRAMEWORK
═══════════════════════════════════════════════════════════════════

1. Find out what is going on.
   - get_stock_data($${t.ticker}): the live price and the company's news.
   - One web_search: why $${t.ticker} is moving and the latest on the
     company.
   - Confirm the condition still holds now, not just when the check sampled it.

2. If it still holds:
   - Default: execute the declared action (${t.action}). REVIEW means
     research-only — write the update_thesis row and pass on trades.
     EXIT means close_position. ENTER means place_trade once the buy's
     checks hold. ADD means manage_position (scale up). TRIM means
     manage_position (partial close).
`;
      },
    },
    { block: "situations", sep: "" },
    {
      own: "framework_rest",
      title: "Decision framework, continued",
      sep: "",
      text: (i) => {
        const t = tr(i);
        return t.auto ? null : `   - Override is allowed when you have a specific reason (e.g. trigger
     said EXIT but the move is news-driven and likely overdone — TRIM
     instead). Say in the note what you did and why.

3. If it no longer holds:
   - Pass. Write update_thesis with type implicit (REVIEWED via empty
     patch) and a note on what is happening to the stock and why you are
     not acting.
   - If the check reveals the thesis itself is no longer applicable
     (ticker fell outside this analyst's edge/universe, the original
     premise has broken structurally, the name is no longer worth
     tracking): say so in the note, and on a stock we watch take its buy
     and Stop watching triggers off by id (remove_trigger_ids) so nothing fires on it; the
     morning run decides whether it stays on the book. A stock we
     hold is sold first with close_position, which retires the thesis itself.

4. KEEP THE TRIGGERS CURRENT — your decision is not complete until the
   stock's triggers reflect it. After an add, raise the "Sell if below"
   price (a bigger position must never round-trip into a loss). After a
   fired gain checkpoint, replace it with the next one. After a move that
   blew through a trigger's price, re-set it off the NEW structure the
   chart gives (the swing low, the breakout price, the average), not a
   round number. The triggers that came with the buy and the playbook's
   fill triggers were written at the fill; your analyst's and the
   account's rules apply on their own.
   The trigger ids are on the row's triggers lines. If nothing went stale,
   leave them. On a stock we hold you can raise a sale's price, never
   lower it; if you think it is wrong, say so in the note and name the price.

5. Output discipline:
   - At most ONE trade tool call (place_trade / manage_position / close_position).
   - Always EXACTLY one update_thesis call documenting what you did and why;
     after a trade you proposed, that note is the proposal's reason the
     principal reads. Pass trigger_id="${t.triggerId}" so the timeline carries the link.
   - When the row's \`said\` lists the principal's decisions or other triggers
     fired since the last answer, your note answers what each asks (an
     earnings date coming, a gain to reassess, a drop to explain) inside the
     story of the stock, not as a list of the triggers.
   - Then complete_run.

`;
      },
    },
    {
      own: "constraints",
      title: "Hard constraints",
      sep: "",
      text: (i) => {
        const t = tr(i);
        return `═══════════════════════════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════════════════════════

  - 15 step max. Be ruthlessly concise.
  - You are NOT reviewing your other theses. Only $${t.ticker} matters
    on this run.
`;
      },
    },
  ],
  message: [
    { block: "fire_facts" },
    {
      own: "kickoff",
      title: "The ask",
      sep: " ",
      text: (i) =>
        tr(i).auto
          ? `Find out what is going on with the company and the stock, then write your note with update_thesis. You can't trade on this run. ` +
            `You are running unattended — no human will respond. Every turn must call a tool; ` +
            `text-only turns terminate the run as FAILED.`
          : `Find out what is going on with the company and the stock, decide, act if warranted, then write your review with update_thesis. ` +
            `You are running unattended — no human will respond. Every turn must call a tool; ` +
            `text-only turns terminate the run as FAILED.`,
    },
  ],
  tools: MODES["tactical"].toolAllowlist ?? [],
  output: "One update_thesis note on the stock (the reason on any trade it proposed), at most one trade proposal, then complete_run. On an Auto trade's write-up, the note alone.",
  example: {
    extra: { ticker: "XYZ", auto: false, autoLine: "", predicateSummary: "below $101", action: "EXIT", triggerId: "trg_sale", firedPrice: 100.6, hasPlaybooks: false, declineLine: false } satisfies TriggerRunExtra,
    says: "Its words below are shown for a sale that fired on $XYZ at $100.60. A buy, a review on a watch and an Auto trade's write-up read differently in places.",
  },
};
