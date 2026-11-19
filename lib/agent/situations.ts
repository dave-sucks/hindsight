/**
 * The situations a stock is in, as codes, one per paragraph of the morning
 * prompt's walk (system-prompt.ts, step 2), read off the work-flag list
 * (needs-action.ts) and the row's other fields; and `listsTheStock`, which
 * stocks get a full row on the morning read. Pure. A stock can be in several
 * (MU, 2026-10-07: a fired review, and 75% of the way to its upside level).
 */
import type { NeedsAction, NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";
import { isGroup, measureOf, shapeOf, type MeasureDef, type When } from "@/lib/agent/triggers/condition";

/** One per trigger action (sale, buy, add, review), and four the code finds with no trigger. */
export type SituationCode =
  | "PROMOTED_AWAITING" | "PROTECTIVE_SALE" | "BUY_ARRIVES" | "ADD_OR_WINNER"
  | "PROTECTION" | "REVIEW_DUE" | "NOTE_TO_ANSWER" | "SOLD_ONE_REVIEW";

/** What a stock's situations are read from: the work-flag list and the row's other fields. */
export interface SituationSources {
  /** computeNeedsAction's list, lead first. */
  needs: NeedsAction[];
  /** The ladder the list was read from, for each fire's measures. */
  triggers: Trigger[];
  status: string;
  /** The resolver's label (ENTER_NOW, PROMOTED_DECIDE_TODAY …). */
  actionability: string | null;
  buyBlockedByFull: boolean;
  unansweredDecision: boolean;
  /** A note pinned on the stock and a group it belongs to, that no run has written after (lib/agent/shared-notes.ts). */
  pinnedNote?: boolean;
  soldReview?: boolean;
}

/** The measures a condition watches, groups walked. */
export function measuresOf(predicate: unknown): MeasureDef[] {
  const out: MeasureDef[] = [];
  const walk = (w: When): void => {
    if (isGroup(w)) return w.conditions.forEach(walk);
    const m = measureOf(w);
    if (m) out.push(m); // a removed kind has no measure
  };
  const w = shapeOf(predicate);
  if (w) walk(w);
  return out;
}

/** A fire or a match, by its trigger's action on this stock; one on a report or a filing is a review too. */
function fireCodes(s: SituationSources, triggerId: string, action: string): SituationCode[] {
  const held = s.status === "HOLDING";
  const codes: SituationCode[] = [];
  if ((action === "EXIT" || action === "TRIM") && held) codes.push("PROTECTIVE_SALE");
  else if (action === "ENTER" && !held) codes.push("BUY_ARRIVES");
  else if (action === "ADD" && held) codes.push("ADD_OR_WINNER");
  const event = measuresOf(s.triggers.find((t) => t.id === triggerId)?.predicate).some((m) => m.type === "earnings" || m.id === "filing");
  if (codes.length === 0 || event) codes.push("REVIEW_DUE");
  return codes;
}

function flagCodes(s: SituationSources, f: NeedsAction): SituationCode[] {
  switch (f.kind) {
    case "PROMOTED_AWAITING_RESOLUTION":
      return ["PROMOTED_AWAITING"];
    case "SALE_DECLINED":
      return ["PROTECTIVE_SALE"];
    case "TRIGGER_FIRED":
      return [f, ...(f.alsoFired ?? [])].flatMap((x) => fireCodes(s, x.triggerId, x.action));
    case "TRIGGER_MATCHING_NOW":
      return fireCodes(s, f.triggerId, f.action);
    case "FLOOR_TOO_FAR":
    case "UNPROTECTED_GAIN":
      return ["PROTECTION"];
    case "REVIEW_DUE":
      return ["REVIEW_DUE"];
  }
}

/** The situations a stock is in, in the list's order, then the row's other sources; each code once. */
export function situationsFor(s: SituationSources): SituationCode[] {
  const codes = s.needs.flatMap((f) => flagCodes(s, f));
  if (s.actionability === "PROMOTED_DECIDE_TODAY") codes.push("PROMOTED_AWAITING");
  if (s.buyBlockedByFull || s.actionability === "ENTER_NOW") codes.push("BUY_ARRIVES");
  if (s.unansweredDecision || s.pinnedNote) codes.push("NOTE_TO_ANSWER");
  if (s.soldReview) codes.push("SOLD_ONE_REVIEW");
  return [...new Set(codes)];
}

/**
 * What every text that can end in a sale says when a sale card already waits
 * for the principal (`proposal_waiting` on the row): that sale is theirs to
 * answer, so the run answers with a note or an edit. A waiting sale silences
 * only that sale (needs-action.ts); the stock's other situations still list it.
 */
const SALE_WAITS = "- Proposing a sale when `proposal_waiting` already shows a sell or trim: that card is the principal's to answer, and a second call lands on the same card. Answer with a note or an edit.";

/**
 * Each situation once: its name in a few plain words (the thesis sheet's flag
 * line) and its guidance, what an agent is told when a stock is in it. The
 * key order is the rank the guidance prints in. get_theses sends the texts
 * for the codes on its work list once per read; the trigger run prints the
 * texts for its stock's codes. A rule sentence lives here and nowhere else in
 * lib/ (situations.test.ts caps each text: 2,200 characters, or just above
 * its length for the three that end in a paragraph per case they took in).
 */
export const SITUATIONS: Record<SituationCode, { name: string; guidance: string }> = {
  PROMOTED_AWAITING: {
    name: "promoted to live",
    guidance: `When: this stock was promoted to live money and its paper position was closed at promotion. It needs a decision this run. The row's \`paper_record\` line carries the paper record: days held, realized P&L, reviews.

Answer, in order:
1. What has happened with the company and the stock since the paper buy: its news, its sector, the market (get_stock_data, web_search)?
2. Does the case still hold at today's price, against the thesis and its triggers?

What you can do (one of these):
- Re-enter live: place_trade.
- Defer: watch_again. The next run looks at it again.

Answered: place_trade, or that watch_again.

The note: what the company and the stock have done since the paper buy, and whether the case holds at today's price; then, in one sentence, bought with live money or why it waits.

Mistakes:
- A note in place of the decision: the stock stays promoted and is asked again on the next run.`,
  },
  PROTECTIVE_SALE: {
    name: "sale signal",
    guidance: `When: a sale or trim trigger fired or is true now on a stock we hold, or the principal declined that sale or let it lapse, the price still past its trigger's price.

Answer, in order:
1. Why is it down? Its own news, its sector, the market (get_stock_data, one web_search; the Market numbers when the whole market fell).
2. Does that touch why we own it? Go down \`would_prove_it_wrong\`: has any of it happened? In the note, name only what has.
3. Is the price past the trigger's price now? A give-back counts from the tracked high, kept over the whole holding, not from a high read off a chart window.
4. Declined, or left to lapse? \`heldThroughFloor\` counts each, with the sale's price, the recent low and their note; their words are in \`said\` too.

What you can do:
- Sell: sell, answering belief_survived as its description says, or trim with sell and a percent; then one write_note.
- After a decline or lapse: if you still would sell, propose it again with today's reasons; if you would hold, say why. Quote their note, and offer the recent low as the sale's new price.
- Or tighten the sale: edit_triggers on the fired trigger's id (the \`triggers\` lines give each id).
- Two sales fired together: one decision covers both (all, some or none).

Answered: a sale or trim, the sale tightened, or a note saying why you hold. While the price stays past it the stock is on this list every morning; the trigger itself fires again, with a new card, only after a close back on the other side.

The note: why the stock fell, from what you found, and whether that changes why we own it; then the sale, the trim or why you hold, in one sentence. Not which day of the drop it is, nor a recount of the trigger.

Mistakes:
- Calling the fire false with a different high; declining a sale takes new evidence about the business.
- Going quiet after a decline.
- Removing or loosening a protective trigger: the save refuses it.`,
  },
  BUY_ARRIVES: {
    name: "buy price reached",
    guidance: `When: a buy trigger fired or is true now on a stock we watch. If the analyst is full, its paragraph at the end comes in place of a buy.

Answer, in order:
1. What is the story right now: the company's news, its sector, the market (get_stock_data, one web_search)? Does it support buying today? A buy into bad news is a fade. Where the average target sits against the price (\`street\`).
2. Does the price still hold? If it touched and slipped back, say so.
3. Did the playbook's buy confirm? By the playbook (the row's \`setup\` and \`playbook_checks\`): a breakout needs a close above the buy price on volume (technicals.today.volumeVsAvg20); a pullback needs the touch to hold (a close above the prior day's high); an earnings gap needs the gap to hold; a compounder needs the thesis intact; a pre-catalyst buy is never the day before the event. With no playbook, the price holding is the confirmation. Outside market hours, leave volume out.
4. Did the principal decline this buy (\`said\`), with nothing they named changed since? Then say so and pass.
5. Does the view still hold? At LOW conviction, skip unless another signal confirms it; at STRONG or HIGH, defer if today's evidence breaks the variant view (\`variant_view\`).

What you can do:
- Buy, only when every check above holds: place_trade (it sizes the buy) with its "Sell if below" as \`sell_if_below\` and \`sell_reason\`. No playbook: the sell price, under structure on the chart. Then one write_note. The stock's "Stop watching if below" ends the watch and is not the sell price.
- Re-price: edit_triggers on the buy's id, at a price from the chart's structure. A pullback buy that touched its average without the reversal is re-priced to a close above today's high, which is the reversal.
- Take the buy off: edit_triggers with remove, keeping a review.

Answered: one of those. A note does answer a buy whose price slipped back. A buy you pass on and leave as it is fires again only after a close finds it false: re-price it or take it off when today's no would stay no.

The note: what is going on with the company and why now is the time to buy or not; then the buy, the new buy price, or the buy taken off, in one sentence.

Mistakes:
- place_trade after a check failed.
- Volume as the reason on a pullback, a compounder or a pre-catalyst buy, or before mid-session.
- Moving the buy above the price to dodge it.

If the analyst is full: every slot is held or awaiting approval (\`buyBlockedByFull\` names the holdings), so place_trade will refuse the buy; don't call it, and don't treat it as a quiet day. Is this stock a better use of a slot than the weakest one we hold? Weigh the thesis, the playbook, the reward left to the Street's average target, and where we differ from the Street (\`variant_view\`). On this stock's one write_note, name which holding it would replace and why it is the better use of the slot, or say it waits for a free slot, and why. Say it once in the run summary too ("$ETN wants in; the analyst is full"). Replacing a holding is the principal's decision; your job is to put the comparison in front of them. The note: what is going on with the company and why it wants in now, against the holding it would replace; then the swap you'd make, or that it waits for a free slot, in one sentence.`,
  },
  ADD_OR_WINNER: {
    name: "add",
    guidance: `When: an add trigger fired or is true now on a stock we hold (what we paid is in the \`position\` line, its triggers in the \`triggers\` lines). It is a decision point, not a hold by default.

Answer, in order:
1. Why did it move: its news, its sector, the market (get_stock_data, one web_search; the Market numbers for a drop)? A rise counts only if it confirms the thesis: the catalyst playing out, estimates rising, healthy structure, not an exhaustion chase. A drop counts only if it is market- or sector-wide, the thesis intact and support holding.
2. Does the live price still confirm, with no headline against it, and does the reward left still beat the risk? The Street's average target (\`street\`) is one reading of what is left.
3. Did the principal decline this add (\`said\`), with nothing they named changed since? Then say so and pass.

What you can do (one of these):
- Press: add (it sizes the add), then edit_triggers raising the upside trigger and the floor under the bigger position, by id.
- Hold: raise the floor to lock a real share of the gain, under structure: edit_triggers on the floor's id; a review trigger above the floor moves up too, never down. What the floor locks in is its price in the \`triggers\` lines against what we paid in the \`position\` line. Breakeven only guards against a loss.
- Take: sell, part or all.
Then one write_note. A trade may wait for the principal's approval.

Answered: one of the three, made with its tool, and that write_note.

The note: why the stock moved and whether that confirms why we own it; then the add, the floor raised and what it now locks in, or the trim, in one sentence.

Mistakes:
- Adding into company-specific weakness: that is averaging into a loser.
- Adding into an exhaustion spike.
- Holding a winner by default when it asks to be re-underwritten.
${SALE_WAITS}`,
  },
  PROTECTION: {
    name: "floor to fix",
    guidance: `When: a holding's floor locks in far less than its gain, so the gain can round-trip with no signal on the way down (the floor in the \`triggers\` lines against the gain in the \`position\` line); or its floor would lose more than 1.5% of the account from what we paid (the \`floor_risk\` line). A normal buy is sized to risk 1% of the account unless the analyst sets otherwise.

Answer, in order:
1. What has carried the stock here, and is it still going: its news, its results, its sector (get_stock_data)?
2. What does the floor lock in, and what would it lose? Read those numbers.
3. Where is real structure? The \`floor_risk\` line names it when the floor is too far; otherwise the 20-day low, a swing low, the breakout price, an average (the \`chart\` line, or get_stock_data).

What you can do:
- Raise the floor under that structure: edit_triggers on the floor's id; a review trigger above the floor moves up too, never down. Tightening is always allowed. A compounder breathes wider than a trade.
- Or protect by taking: sell part so the loss at the floor fits, or all when the structure is breaking or the reward is gone.
- Or say in one sentence why this floor stands and why the risk is worth it (a binary event this week that any trail would shake out).

Answered: the floor raised, a trim or a sale, or that sentence. "The business is intact" says whether to own it, not how much it can lose.

The note: how the stock got here and what is driving it now; then the new floor and what it locks in, the trim, or why the floor stays, in one sentence.

Mistakes:
- A round number, or a floor set at the buy price by reflex.
${SALE_WAITS}`,
  },
  REVIEW_DUE: {
    name: "review due",
    guidance: `When: the review clock came due, a review trigger fired or is true now, or a trigger on a report or a filing fired. A review on a report, one on a filing, and a watch with no view yet each have a paragraph at the end (the \`triggers\` lines say what fired; the \`stock\` line says "no view"). A watch with no view: go straight to its paragraph.

Answer, in order:
1. Anything from the principal not yet answered (\`said\`)? Answer it first.
2. What has happened with the company and the stock since your last note: its news, its sector, the market (get_stock_data, web_search), and the Street (\`street\`)?
3. Has the belief broken? On a stock you hold, go down \`would_prove_it_wrong\`: has any of it happened? In the note, name only what has. A falling price is not on the list unless you wrote it there.
4. Is the playbook still working? The row's \`setup\`: its failure signs, the manage rule, the time limit.
5. Did the world move past the triggers' prices? An add's price blown through, a floor lagging the gain (its price against what we paid), a fired checkpoint never replaced, an upside trigger the Street re-rated past.

What you can do:
- Patch the triggers: edit_triggers on the ones that moved, by id.
- They stand: write_note only (trigger_id only when several fired).
- Retune the clock: edit_triggers on the review clock's id (slower for a quiet name, faster into a catalyst), or remove it, keeping one wake that can still fire, and say what would bring the stock back.
- A condition that happened is an exit: sell with belief_survived false.
- No longer applicable: stop_watching on a stock we watch; a stock we hold is sold with sell, which retires the thesis.

Answered: one write_note on the stock. "They stand" is honest only when neither the story nor the prices moved.

The note: what has happened with the company and the stock since your last note, and what it means for why we own or watch it; then what you did, in one sentence. If nothing happened, say so and name what would change it. Never a list of what you checked.

Mistakes:
- The same answer to a review that fired again (the \`repeat\` line says how often): change a trigger, or say what differs from last time.
- Deleting a trigger you still believe in to look at the name less.
${SALE_WAITS}

If it watches a report: read it before anything else. Before the report: what is expected, and what has the stock done into it? Within days of it, it is sizing, not a trade: is a holding sized for a 10% move either way? Trim, hold through, or set the floor where a bad print breaks the story; a watch holds its buy until the report. Your note sets the bar: the number or the \`assumptions\` line the report has to clear, and what a miss would do to the verdict. After it: what did they report against what was expected, what did management say about what comes next, and how did the stock take it? The reaction is the information. The figures are in a trigger run's kickoff, or get_earnings_data in the morning read; read the call before trusting a number (web_search). A surprise on an estimate under $0.05 is left blank; judge it in dollars. Beat on both lines, guidance up: raise the upside trigger and the floor; consider adding. EPS beat, revenue missed: the beat came from cost; raise nothing on it. A beat the stock is down on: the market wanted more; tighten the floor. A miss: a broken assumption is a sale (sell, belief_survived false); an intact story that is early stays, floored under structure; say what would change your mind. Your note then answers the bar (answers_update_id with its [id …], the verdict, and verdict_line naming the number against the bar) and gives those three answers. Never buy on a beat alone or sell on a miss alone, and never add into the print.

If it watches a filing: read the document first (get_sec_filings with \`read\` on its link; a trigger run's kickoff names the event and the link). The item code names the class; the document says which way it cuts, so never act on the class without reading it. On a holding: a restatement (4.02) means the numbers may be false, so sell unless it is clearly small and off-thesis, and say which; bankruptcy or a delisting notice is a sale; on a late report, find the stated reason, tighten the floor, and add nothing until it is filed; an officer leaving (5.02) is noise in a planned succession and a warning in a sudden CFO exit, so tighten the floor; an acquisition target we hold is capped at the deal price, so move the upside trigger to it and consider selling; dilution (3.02, 424B5, S-3) gets no add, and check the use of proceeds. On a watch: take the buy off on a restatement, stop watching on bankruptcy, buy nothing into a late report or an offering. It is answered by a write_note citing the filing you read, or by the trade; the note says what the company filed and what it says, in plain words, not the item code.

If it is a playbook's way in on a stock we watch (its note says the run writes the triggers): write that playbook's watch triggers with edit_triggers' add and name it (setup_id), each with "playbook": "WATCH", exactly as listed, every {chart number} replaced by its price from this stock's chart today; one whose price the chart doesn't have yet is left out. A trigger run has the lists under YOUR PLAYBOOKS; the morning run reads them with read_knowledge_library (topic "setup" and the playbook's id).

If it is a watch with no view yet: there are no triggers to review, and its claim is the writer's: the save carries no belief fields and refuses a call on a stock with no direction, so never write the claim yourself.
- With a review clock of its own it is a seed, due its first research on that clock (the \`research\` line says "No write-up yet", and names the date when the last write-up failed). Have it researched: dispatch_thesis_research with mode "refresh" and existing_thesis_id set to this stock's id, then wait_for_thesis_refresh on the child run. The writer reads the stock, writes the claim (the belief, the assumptions, what would prove it wrong), writes its triggers and commits the view, LONG, SHORT or PASS; the wait tool's reply says what landed, or why it failed. That write-up is the stock's first note and answers it; your edit_triggers after it comes only when you change something (a trigger moved or a review clock), saying what and why in a sentence or two. A failed write-up is dispatched again; the seed stays, asked again on its clock.
- With no clock, it comes back only when one of its wakes fires: one did, and it asks one question, do you want this stock back? What has happened with the company and the stock since you set the wake? Bring it back through the writer the same way, then one write_note for what you still owe it, if anything. Or re-arm it: edit_triggers moving the wakes to the prices that matter now, adding a review clock (add, watching "repeat") only if the stock has earned one, and saying why. Or let it go: stop_watching. One of the three answers it. If you leave the wake as it is, it fires again only after a close finds it false, so when your answer won't change, move it to the price that matters now or let the stock go. The note: what has happened with the company and the stock since you set the wake; then brought back for research, watched for a new price, or let go, in one sentence.`,
  },
  NOTE_TO_ANSWER: {
    name: "a note to answer",
    guidance: `When: the principal made a decision on this stock that no run has answered, or left a note since your last answer; or a note is pinned on this stock and no run has written on it since, which has its paragraph at the end. Their words are in \`said\`, with the price then and now.

Answer, in order:
1. Which is it: an instruction, a question, a decline, a resized approval, a note?
2. What has happened with the company and the stock since they said it (get_stock_data, web_search)?

What you can do:
- An instruction ("add on a close above $74"): carry it out with the tools, usually as a trigger via edit_triggers.
- A question: do the work it asks for and answer in your note. Answering the question is the action.
- A decline with no reason: do not propose the same buy or add again unless its circumstances have changed. "Not this week" lapses after the week; "never this name" does not.
- An approval with a different size, or a price they set: honor their numbers, never revert them. A cut size is caution, a raised one is conviction.

Answered: your one write_note on the stock, quoting them and saying what you decided on each.

The note: their words, quoted, then your answer: what you found about the company and the stock, and what you did about each thing they asked.

Mistakes:
- Taking an expired proposal for a decision: it may be proposed again if the playbook holds.
${SALE_WAITS}

If a note is pinned: an Agent note (the 7:30 Market Reviewer's) or the principal's, on this stock alone or with others. It is in \`said\` under PINNED, above the Activity lines, with the stocks it covers and their share of the account, and it names news that could change a decision here: a market date, a story moving a group, the company's own news, how much of the account rides on it. What does it say is coming, and when? Does it reach why we own or watch this stock? Check its claim and the stock's own news against the data (the Market numbers too). Do its triggers still fit what is coming: the floor and the size on a holding, the buy and the research on a watch? Then one of these. Act on it: on a holding, an add on good news (add sizes it), a trim or a sale proposal, or a floor moved up with edit_triggers; on a watch, a buy at today's price on good news (the buy trigger moved to at or near the current price, edit_triggers by its id), a buy price moved, the research refreshed through the writer (dispatch_thesis_research, mode "refresh"), or let it go. Or keep its triggers, saying in one sentence why the note doesn't change them for this stock. It is a read on the market, not an order: the stock's own case still decides, and a floor is never moved down or loosened because of it (only the principal lowers a floor). Your write_note names the pinned note and says what it means here; the stock leaves this situation once you have written, and the note stays pinned for the others it covers. The note: what the pinned note says is coming, what it means for this stock and why, then what you did, in one sentence.`,
  },
  SOLD_ONE_REVIEW: {
    name: "just sold",
    guidance: `When: this analyst sold the stock in the last two weeks and no run has answered for it yet. It is listed under \`sold_to_review\`, not as a row: \`ask\` carries the exit price, the date, why it sold, whether the belief survived, and any catalyst still ahead. This is the one look a sold stock gets.

Answer, in order:
1. What has the company and the stock done since we sold (get_stock_data)?
2. Is it worth watching again? A catalyst still ahead, a belief that survived the exit.

What you can do (one of these):
- Keep watching with a buy priced off today's chart.
- Keep watching on a review cadence.
- Keep watching with nothing set (legal, and it costs nothing).
- Let it go.
Put it back on watch with watch_again on its thesis_id, then whatever wakes it with edit_triggers; to let it go, write the one-line reason with write_note and it clears.

Answered: one write_note saying which you chose and why.

The note: what the stock has done since the sale, and whether the reason we owned it survived; then whether you keep watching it and for what, or let it go, in one sentence.

Mistakes:
- Never looking at it again: a sold stock you never look at again is a thesis you already paid for and threw away.`,
  },
};

/**
 * Situations whose answer needs fields the trigger run's save lacks, so the
 * morning run answers them: putting a sold stock back on watch (watch_again,
 * which the trigger run has not had since #825; a sold stock is never a
 * trigger run's stock anyway). A seed's first research is a line below.
 */
const NOT_FOR_THE_TRIGGER_RUN: ReadonlySet<SituationCode> = new Set(["SOLD_ONE_REVIEW"]);

/**
 * The trigger run's words where a text names a status change (step 12, part
 * 2): it has no status tool (#825), so where the morning run and the
 * chat retire, drop or defer a stock, the trigger run takes its triggers off
 * by id and says so in its note, and the morning run decides. Each pair is a
 * line of the text above, word for word, and the line the trigger run reads
 * in its place; situations.test.ts holds every line to its text.
 */
export const TRIGGER_RUN_LINES: Partial<Record<SituationCode, ReadonlyArray<readonly [string, string]>>> = {
  PROMOTED_AWAITING: [
    [
      `- Defer: watch_again. The next run looks at it again.`,
      `- Defer: one write_note saying why. This run has no status tool: the stock stays promoted and the morning run decides.`,
    ],
    [
      `- A note in place of the decision: the stock stays promoted and is asked again on the next run.`,
      `- Deferring without a reason: the morning run decides on what your note says.`,
    ],
  ],
  REVIEW_DUE: [
    // The trigger run's save is handed the trigger that fired (ToolContext.runStock).
    [`- They stand: write_note only (trigger_id only when several fired).`, `- They stand: write_note only.`],
    [
      `Or let it go: stop_watching.`,
      `Or let it go: edit_triggers with remove naming its wakes, and say in the note that it can go. It stays on the watchlist with nothing to wake it; dropping it for good is the morning run's call.`,
    ],
    // A seed's first research is the morning run's, as when it had its own situation (#811).
    [
      `- With a review clock of its own it is a seed, due its first research on that clock (the \`research\` line says "No write-up yet", and names the date when the last write-up failed). Have it researched: dispatch_thesis_research with mode "refresh" and existing_thesis_id set to this stock's id, then wait_for_thesis_refresh on the child run. The writer reads the stock, writes the claim (the belief, the assumptions, what would prove it wrong), writes its triggers and commits the view, LONG, SHORT or PASS; the wait tool's reply says what landed, or why it failed. That write-up is the stock's first note and answers it; your edit_triggers after it comes only when you change something (a trigger moved or a review clock), saying what and why in a sentence or two. A failed write-up is dispatched again; the seed stays, asked again on its clock.`,
      `- With a review clock of its own it is a seed, due its first research on that clock, and the morning run answers it: this run leaves it as it is.`,
    ],
    [
      `- No longer applicable: stop_watching on a stock we watch; a stock we hold is sold with sell, which retires the thesis.`,
      `- No longer applicable: on a stock we watch, take its buy and its Stop watching line off by id (edit_triggers with remove) and say so in the note; the morning run decides whether it stays on the book. A stock we hold is sold with sell, which retires the thesis.`,
    ],
  ],
};

/** A situation's text as this run reads it: the trigger run's lines in place of the status verbs its save lacks. */
function guidanceText(code: SituationCode, runMode?: string): string {
  const text = SITUATIONS[code].guidance;
  if (runMode !== "INTRADAY_TACTICAL") return text;
  return (TRIGGER_RUN_LINES[code] ?? []).reduce((t, [line, theirs]) => t.replace(line, theirs), text);
}

/** The codes whose guidance a stock calls for: on a promoted stock, only the promotion's; in a trigger run, none it can't answer. */
export function guidanceCodes(status: string, codes: readonly SituationCode[], runMode?: string): SituationCode[] {
  if (status === "PROMOTED") return ["PROMOTED_AWAITING"];
  return runMode === "INTRADAY_TACTICAL" ? codes.filter((c) => !NOT_FOR_THE_TRIGGER_RUN.has(c)) : [...codes];
}

/** The guidance for these codes, each text once, in rank order, worded for the run that reads it. */
export function guidanceFor(codes: Iterable<SituationCode>, runMode?: string): Partial<Record<SituationCode, string>> {
  const wanted = new Set(codes);
  const out: Partial<Record<SituationCode, string>> = {};
  for (const code of Object.keys(SITUATIONS) as SituationCode[]) if (wanted.has(code)) out[code] = guidanceText(code, runMode);
  return out;
}

/** The situations for a person, lead first: each code, its name, and whether the lead flag is what put the stock in it. */
export function situationLabels(s: SituationSources): Array<{ code: SituationCode; name: string; lead: boolean }> {
  const lead = new Set(s.needs[0] ? flagCodes(s, s.needs[0]) : []);
  return situationsFor(s).map((code) => ({ code, name: SITUATIONS[code].name, lead: lead.has(code) }));
}

const LABELS_THAT_LIST = new Set(["ENTER_NOW", "PROMOTED_DECIDE_TODAY"]);

/**
 * Whether a stock gets a full row on the morning read, as get_theses decided
 * it before: any work flag (a floor too far is one, even under a fired sale),
 * a buy into a full analyst, the principal's word unanswered, a pinned note, a
 * reached buy level, or a promoted stock. A sale waiting for the principal
 * silences only that sale (computeNeedsAction): the other flags, a note and the
 * rest still list the stock. The read adds book mode and failed prices itself.
 */
export function listsTheStock(s: SituationSources): boolean {
  return (
    s.needs.length > 0 ||
    s.buyBlockedByFull ||
    s.unansweredDecision ||
    !!s.pinnedNote ||
    LABELS_THAT_LIST.has(s.actionability ?? "") ||
    s.status === "PROMOTED"
  );
}

/**
 * The measuring script's tap (scripts/measure-situations.ts): each stock's
 * work-flag input and sources, as get_theses built them. Nothing in the app
 * sets it.
 */
export const situationsTap: {
  record: ((stock: { thesisId: string; ticker: string; needsInput: NeedsActionInput | null; sources: SituationSources }) => void) | null;
} = { record: null };
