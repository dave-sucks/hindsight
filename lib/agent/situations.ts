/**
 * The situations a stock is in, as codes, one per paragraph of the morning
 * prompt's walk (system-prompt.ts, step 2), read off the work-flag list
 * (needs-action.ts) and the row's other fields; and `listsTheStock`, which
 * stocks get a full row on the morning read. Pure. A stock can be in several
 * (MU, 2026-10-07: a fired review, and 75% of the way to its target).
 */
import type { NeedsAction, NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";
import { isGroup, measureOf, shapeOf, type MeasureDef, type When } from "@/lib/agent/triggers/condition";

export type SituationCode =
  | "PROMOTED_AWAITING" | "PROTECTIVE_SALE" | "BUY_ARRIVES" | "BUY_BLOCKED_FULL"
  | "ADD_OR_WINNER" | "EARNINGS" | "FILING" | "QUIET_WATCH_WOKE"
  | "PROTECTION" | "FIRST_RESEARCH" | "REVIEW_DUE" | "STALE_RESEARCH"
  | "PLAN_PROBLEM" | "YOUR_WORD_UNANSWERED" | "SOLD_ONE_REVIEW" | "NO_SETUP_NAMED";

/** What a stock's situations are read from: the work-flag list and the row's other fields. */
export interface SituationSources {
  /** computeNeedsAction's list, lead first. */
  needs: NeedsAction[];
  /** The ladder the list was read from, for each fire's measures. */
  triggers: Trigger[];
  status: string;
  direction: string | null;
  planSanity: ReadonlyArray<{ kind: string }> | null;
  /** The resolver's label (ENTER_NOW, STALE_PAST_CATALYST, PROMOTED_DECIDE_TODAY …). */
  actionability: string | null;
  progressToTarget: number | null;
  buyBlockedByFull: boolean;
  nameTheSetup: boolean;
  unansweredDecision: boolean;
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

const own = (t: Trigger) => ((t as { level?: string }).level ?? "THESIS") === "THESIS";

/** A fire or a match, by its trigger's action and measures, on this stock. */
function fireCodes(s: SituationSources, triggerId: string, action: string): SituationCode[] {
  const held = s.status === "HOLDING";
  const measures = measuresOf(s.triggers.find((t) => t.id === triggerId)?.predicate);
  const earnings = measures.some((m) => m.type === "earnings");
  const filing = measures.some((m) => m.id === "filing");
  const codes: SituationCode[] = [];
  if ((action === "EXIT" || action === "TRIM") && held) codes.push("PROTECTIVE_SALE");
  else if (action === "ENTER" && !held) codes.push(s.buyBlockedByFull ? "BUY_BLOCKED_FULL" : "BUY_ARRIVES");
  else if (action === "ADD" && held) codes.push("ADD_OR_WINNER");
  if (earnings) codes.push("EARNINGS");
  if (filing) codes.push("FILING");
  if (codes.length === 0) {
    // A watch with no direction and no review clock of its own comes back only when a wake fires.
    const quiet =
      s.status === "WATCHING" &&
      s.direction == null &&
      !s.triggers.some((t) => own(t) && measuresOf(t.predicate).some((m) => m.id === "repeat"));
    codes.push(action === "REVIEW" && quiet ? "QUIET_WATCH_WOKE" : "REVIEW_DUE");
  }
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
      return [f.pendingFirstReview ? "FIRST_RESEARCH" : "REVIEW_DUE"];
    case "RESEARCH_STALE":
      return ["STALE_RESEARCH"];
  }
}

/** The situations a stock is in, in the list's order, then the row's other sources; each code once. */
export function situationsFor(s: SituationSources): SituationCode[] {
  const codes = s.needs.flatMap((f) => flagCodes(s, f));
  if (s.actionability === "PROMOTED_DECIDE_TODAY") codes.push("PROMOTED_AWAITING");
  if (s.buyBlockedByFull) codes.push("BUY_BLOCKED_FULL");
  else if (s.actionability === "ENTER_NOW") codes.push("BUY_ARRIVES");
  if (s.status === "HOLDING" && (s.progressToTarget ?? 0) >= 0.75) codes.push("ADD_OR_WINNER");
  if ((s.planSanity?.length ?? 0) > 0 || s.actionability === "STALE_PAST_CATALYST") codes.push("PLAN_PROBLEM");
  if (s.unansweredDecision) codes.push("YOUR_WORD_UNANSWERED");
  if (s.soldReview) codes.push("SOLD_ONE_REVIEW");
  if (s.nameTheSetup) codes.push("NO_SETUP_NAMED");
  return [...new Set(codes)];
}

/**
 * Each situation once: its name in a few plain words (the thesis sheet's flag
 * line) and its guidance, what an agent is told when a stock is in it. The
 * key order is the rank the guidance prints in. get_theses sends the texts
 * for the codes on its work list once per read; the trigger run prints the
 * texts for its stock's codes. A rule sentence lives here and nowhere else in
 * lib/ (situations.test.ts holds each text to 2,200 characters).
 */
export const SITUATIONS: Record<SituationCode, { name: string; guidance: string }> = {
  PROMOTED_AWAITING: {
    name: "promoted to live",
    guidance: `When: this stock was promoted to live money and its paper position was closed at promotion. It needs a decision this run. The row's \`paper_record\` line carries the paper record: days held, realized P&L, reviews.

Answer, in order:
1. Does the case still hold at today's price? Check with get_stock_data against the thesis and its triggers.

What you can do (one of these):
- Re-enter live: place_trade.
- Defer: update_thesis with change_status "WATCHING". The next run looks at it again.

Answered: place_trade, or that update_thesis.

Mistakes:
- A note in place of the decision: the stock stays promoted and is asked again on the next run.`,
  },
  PROTECTIVE_SALE: {
    name: "sale signal",
    guidance: `When: a sale or trim trigger fired or is true now on a stock we hold, or the principal declined that sale and the price is still past the line.

Answer, in order:
1. Is the price past the line now (get_stock_data)? A give-back counts from the tracked high, kept over the whole holding, not from a high read off a chart window.
2. Did the principal decline it? \`heldThroughFloor\` has the count, the floor, the recent low and their note; their words are in \`said\` too.

What you can do:
- Sell: close_position with reason STOP, answering belief_survived as its description says, or trim with manage_position partial_close; then one update_thesis saying why.
- After a decline, propose the sale again with today's reasons: a sale asks every day its condition holds. Say which day of the breach it is, quote their note, and offer the recent low as a level for the line.
- Or re-draw the line: update_thesis with edit_triggers on the fired trigger's id (the \`triggers\` lines give each id beside its words), as a price under structure you name, and say when you will look again. After a decline the line may come down at most 15%; nothing else may be loosened.
- Two sales fired together: one decision covers both (all, some or none); name the rule you followed.

Answered: a sale or trim, or the line re-drawn. A note that changes nothing leaves the sale asking again tomorrow; after a decline, complete_run does not take a note at all.

Mistakes:
- Calling the fire false with a different high; declining a sale takes new evidence about the business.
- Going quiet after a decline.
- Removing or loosening a protective trigger: the save refuses it.`,
  },
  BUY_ARRIVES: {
    name: "buy level reached",
    guidance: `When: a buy trigger fired or is true now on a stock we watch and the analyst has room, or the price sits at the plan's buy level.

Answer, in order:
1. Does the price still hold the level (get_stock_data)? If it touched and slipped back, say so.
2. Did the setup's confirmation happen? By the setup (the row's \`setup\` line, or its \`setup_lines\` when present): a breakout needs a close above the level on volume (get_stock_data: technicals.today.volumeVsAvg20); a pullback needs the touch to hold (a close above the prior day's high); an earnings gap needs the gap to hold; a compounder needs the thesis intact; a pre-catalyst buy is never the day before the event. With no setup, the price holding is the confirmation. Outside market hours, leave volume out.
3. Is it chased? A buy that fired unanswered shows in \`plan_checks\`, with the setup's chase limit and how far past it the stock is.
4. Does a headline from the last hour contradict it (get_stock_data's news)? A buy into bad news is a fade.
5. Did the principal decline this buy (\`said\`), with nothing they named changed since? Then say so and pass.
6. Does the view still hold? At LOW conviction, skip unless another signal confirms it; at STRONG or HIGH, defer if today's evidence breaks the variant view (full row, by ticker).

What you can do:
- Buy, only when every check above holds: place_trade (it sizes the buy), then one update_thesis saying why.
- Re-price: update_thesis with edit_triggers on the buy's id, at a level from the chart's structure, named in the rationale.
- Set the plan down: update_thesis with remove_trigger_ids naming the buy, floor and target, keeping a review, and one sentence on why this was not the entry.
- Stop watching: change_status ARCHIVED; INVALIDATED only when the thesis should not exist at all.

Answered: one of those. A buy left as a note comes back on the next morning run as a plan check or a live match; a note does answer a buy whose price slipped back.

Mistakes:
- place_trade after a check failed.
- Volume as the reason on a pullback, a compounder or a pre-catalyst buy, or before mid-session.
- Moving the buy above the price to dodge it: it comes back as a plan check, with the count.`,
  },
  BUY_BLOCKED_FULL: {
    name: "buy blocked, full",
    guidance: `When: a buy fired or is true now on a stock we watch, and this analyst is full: every slot is held or awaiting approval. \`buyBlockedByFull\` names the holdings. place_trade will refuse the buy.

Answer, in order:
1. Is this stock a better use of a slot than one we hold? Weigh it against the weakest holding: the thesis, the setup, the reward left to its target.

What you can do:
- On this stock's update_thesis, name which held stock it would replace and why it is the better use of the slot.
- Or write "full — waiting" there, with the reason.
Say it once in the run summary too ("$ETN wants in; the analyst is full"). Replacing a holding is the principal's decision; your job is to put the comparison in front of them.

Answered: that one update_thesis on the stock.

Mistakes:
- Calling place_trade for it while the analyst is full.
- Treating it as a quiet day.`,
  },
  ADD_OR_WINNER: {
    name: "add or near target",
    guidance: `When: an add trigger fired or is true now on a stock we hold, or the holding has come three quarters of the way to its target or more (the \`plan\` line: 75% of the way or above). It is a decision point, not a hold by default.

Answer, in order:
1. Why did it move (get_stock_data; get_market_context for a drop)? A rise counts only if it confirms the thesis: the catalyst playing out, estimates rising, healthy structure, not an exhaustion chase. A drop counts only if it is market- or sector-wide, the thesis intact and support holding.
2. Does the live price still confirm, with no headline against it, and does the reward to a justified target still beat the risk?
3. Did the principal decline this add (\`said\`), with nothing they named changed since? Then say so and pass.

What you can do (one of these):
- Press: manage_position add_to_position (it sizes the add), then update_thesis raising the target, and the floor (stop_loss) under the bigger position.
- Hold: raise the floor to lock a real share of the gain, under structure, with update_thesis stop_loss. The \`protection\` line shows what the floor locks in now. Breakeven only guards against a loss.
- Take: manage_position partial_close, or close_position.
Then one update_thesis saying which and why. A trade may wait for the principal's approval.

Answered: one of the three, made with its tool, and that update_thesis.

Mistakes:
- Adding into company-specific weakness: that is averaging into a loser.
- Adding into an exhaustion spike.
- Holding a winner by default when it asks to be re-underwritten.`,
  },
  EARNINGS: {
    name: "earnings",
    guidance: `When: an earnings trigger fired or is true now: a report is near or came in.

Answer, in order:
1. What do the figures say? A trigger run's kickoff carries them; in the morning read, get_earnings_data. A surprise on an estimate under $0.05 is left blank; judge it in dollars.
2. How did the stock take it? The reaction is the information. Read the call before trusting a number (get_earnings_data, web_search).

What you can do:
- Reports within days: sizing, not a trade. Held: sized for a 10% move either way? Trim, hold through, or set the floor where a bad print breaks the story. Watched: hold the buy until the report.
- Beat on both lines, guidance up: raise the target and floor; consider adding.
- EPS beat, revenue missed: the beat came from cost; raise nothing on it.
- A beat the stock is down on: the market wanted more; tighten the floor.
- A miss: a broken assumption is a sale (close_position, belief_survived false); an intact story that is early stays, floored under structure; say what would change your mind.

Answered: update_thesis naming the figures and what you did, or a trade.

Mistakes:
- Buying on a beat alone, or selling on a miss alone.
- Adding into the print.`,
  },
  FILING: {
    name: "new filing",
    guidance: `When: a filing trigger fired or is true now. A trigger run's kickoff names the event and the link; in the morning read, get_sec_filings lists it. The item code names the class; the document says which way it cuts.

Answer, in order:
1. What does the filing say? Read it first: get_sec_filings with \`read\` on its link.
2. Do we hold the stock, or watch it?

What you can do, held:
- A restatement (4.02) means the numbers may be false: sell unless it is clearly small and off-thesis, and say which.
- Bankruptcy or a delisting notice: sell.
- A late report: find the stated reason, tighten the floor, add nothing until it is filed.
- An officer leaving (5.02): a planned succession is noise; a sudden CFO exit is a warning, so tighten the floor.
- We hold an acquisition target: the price is capped at the deal price; move the target to it and consider selling.
- Dilution (3.02, 424B5, S-3): add nothing into it; check the use of proceeds.
Watched: set the plan down on a restatement, stop watching on bankruptcy, buy nothing into a late report or an offering.

Answered: update_thesis citing the filing you read, or the trade.

Mistakes:
- Acting on the class without reading the document.`,
  },
  QUIET_WATCH_WOKE: {
    name: "watch woke up",
    guidance: `When: a review fired or is true now on a watch with no direction and no clock of its own: no plan, no review schedule, only wakes you set. It asks one question: do you want this stock back?

Answer, in order:
1. What changed since you set the wake? Check with get_stock_data.

What you can do (one of these):
- Bring it back: update_thesis committing the full view (direction, horizon, prices, belief, assumptions, invalidation conditions, triggers), as a first research does.
- Re-arm it: update_thesis with edit_triggers moving the wakes to the levels that matter now. Add a review clock (add_triggers watching "repeat") only if the stock has earned one, and say why.
- Let it go: update_thesis with change_status ARCHIVED.

Answered: one of the three. A note that changes nothing lets the same wake fire again tomorrow.

Mistakes:
- Deciding the same wake again every day.`,
  },
  PROTECTION: {
    name: "floor to fix",
    guidance: `When: a holding's floor locks in far less than its gain, so the gain can round-trip with no signal on the way down (the \`protection\` line); or its floor would lose more than 1.5% of the account from what we paid (the \`floor_risk\` line). A normal buy is sized to risk 1% of the account unless the analyst sets otherwise.

Answer, in order:
1. What does the floor lock in, and what would it lose? Read those numbers.
2. Where is real structure? The \`floor_risk\` line names it when the floor is too far; otherwise the 20-day low, a swing low, the breakout level, an average (the \`chart\` line, or get_stock_data).

What you can do:
- Raise the floor under that structure: update_thesis with stop_loss. Tightening is always allowed. A compounder breathes wider than a trade.
- Or protect by taking: manage_position partial_close so the loss at the floor fits, or close_position when the structure is breaking or the reward is gone.
- Or say in one sentence why this floor stands and why the risk is worth it (a binary event this week that any trail would shake out).

Answered: the floor raised, a trim or a sale, or that sentence. "The business is intact" says whether to own it, not how much it can lose.

Mistakes:
- A round number, or a floor set at the entry by reflex.`,
  },
  FIRST_RESEARCH: {
    name: "first research due",
    guidance: `When: a seed is due its first research: a stock put on the watchlist with no view yet (the \`stock\` line says "no view"), its review clock due.

Answer, in order:
1. Is there a tradeable view? Pull get_stock_data and what else you need.

What you can do:
- Commit a view: update_thesis with direction LONG or SHORT, horizon, entry_price, target_price, stop_loss, core_belief, key_assumptions (two or more), invalidation_conditions (two or more), triggers, conviction with conviction_rationale, and a rationale. It stays on watch with its buy trigger; the save refuses a commitment missing a structural field.
- Pass: update_thesis with direction PASS, invalidation_conditions (one or more) and a rationale. It leaves the watchlist and stays on the stock's page as a decision.

Answered: one of the two. The save refuses a call on a seed with no direction; the seed stays, asked again tomorrow.

Mistakes:
- Taking a watch with no clock for a seed: a seed comes due on its clock; a watch with no clock comes back only when one of its wakes fires.`,
  },
  REVIEW_DUE: {
    name: "review due",
    guidance: `When: the review clock came due on a LONG or SHORT stock, or a review trigger fired or is true now and no other situation covers it.

Answer, in order:
1. Has the principal said something not yet answered (\`said\`)? Answer it first.
2. Has the belief broken? On a stock you hold, go down \`would_prove_it_wrong\` and say for each whether it has happened. Price being down is not on the list unless you wrote it there.
3. Is the setup still working? The \`setup\` line: its failure signs, the manage rule, the time limit.
4. Did the world move past the levels? An add level blown through, a floor lagging the gain (the \`protection\` line), a fired checkpoint never replaced, a target the street re-rated past.

What you can do:
- Patch the plan: update_thesis with edit_triggers on the levels that moved, by id.
- The plan stands: update_thesis with a rationale only, saying what you checked and why. Pass trigger_id when a review fired.
- Retune the clock: edit_triggers on the review clock's id (slower for a quiet name, faster into a catalyst), or remove it, keeping one level or move that can still fire, and say what would bring the stock back.
- A condition that happened is an exit: close_position with belief_survived false.
- No longer applicable: change_status INVALIDATED on a stock we watch; a stock we hold is sold with close_position, which retires the thesis.

Answered: one update_thesis on the stock. "The plan stands" is honest only when neither the story nor the levels moved.

Mistakes:
- The same answer to a review that fired again (the \`repeat\` line says how often): change the plan, or say what differs from last time.
- Deleting a level you still believe in to look at the name less.`,
  },
  STALE_RESEARCH: {
    name: "research stale",
    guidance: `When: the research behind a committed view is older than its horizon allows, or missing (the \`research\` line says when it was written). On a watched stock the next thing to happen could be a buy on it.

Answer, in order:
1. Does the old work still stand against today's data?

What you can do:
- Refresh it (the default): dispatch_thesis_research with mode "refresh", then wait_for_thesis_refresh, then re-read the stock and change its levels or conviction if the new work changed your view.
- Re-affirm it: update_thesis saying in one concrete sentence why it still stands ("the backlog case is unchanged; Q2 confirmed it").
- Stop paying for it: drop the review clock, and the plan's triggers too if the plan is dead.

Answered: a refresh, or one of the other two. A held stock owes the same, with more at stake.

Mistakes:
- "Looks fine", or a line you could have written without opening the stock.`,
  },
  PLAN_PROBLEM: {
    name: "plan check",
    guidance: `When: a watched stock's plan contradicts the tape or the calendar. The \`plan_checks\` lines list each check with its arithmetic: the buy level on the price or far from it, a buy already spent, a target passed, a floor breached or inside the stock's ordinary daily move, a plan under 2:1, a score under the analyst's minimum, no buy level, nothing that can bring it back. Or a dated event passed with nothing resolved (the \`catalyst\` line's date is behind us).

Answer, in order:
1. What does each check say? Read its numbers.

What you can do, for each check:
- Fix the number: update_thesis with the re-anchored level (edit_triggers on its id) and a rationale.
- Or say in one sentence why the level is deliberately parked where it is ("buy level stays $58: a crash-only entry by design, revisit after earnings").
- Or set the plan down: update_thesis with remove_trigger_ids naming the buy, target and floor triggers, and the review clock too if the stock no longer earns one. It stays on the watchlist costing nothing, with whatever wakes you keep.

Answered: one of the three for every check. A review that does not mention a check leaves it there tomorrow, and every day after.

Mistakes:
- Re-anchoring to a round number instead of structure.`,
  },
  YOUR_WORD_UNANSWERED: {
    name: "your word unanswered",
    guidance: `When: the principal made a decision on this stock that no run has answered, or left a note since your last answer. Their words are in \`said\`, with the price then and now.

Answer, in order:
1. Which is it: an instruction, a question, a decline, a resized approval, a note?

What you can do:
- An instruction ("add on a close above $74"): carry it out with the tools, usually as a trigger via update_thesis.
- A question: do the work it asks for and answer in your rationale. Answering the question is the action.
- A decline with no reason: do not propose the same buy or add again unless its circumstances have changed. "Not this week" lapses after the week; "never this name" does not.
- An approval with a different size, or a level they set: honor their numbers, never revert them. A cut size is caution, a raised one is conviction.

Answered: your one update_thesis on the stock, quoting them and saying what you decided on each.

Mistakes:
- Taking an expired proposal for a decision: it may be proposed again if the setup still holds.`,
  },
  SOLD_ONE_REVIEW: {
    name: "sold, one look",
    guidance: `When: this analyst sold the stock in the last two weeks and no run has answered for it yet. It is listed under \`sold_to_review\`, not as a row: \`ask\` carries the exit price, the date, why it sold, whether the belief survived, and any catalyst still ahead. This is the one look a sold stock gets.

Answer, in order:
1. Is it worth watching again? A catalyst still ahead, a belief that survived the exit.

What you can do (one of these):
- Keep watching with a re-entry level priced off today's chart.
- Keep watching on a review cadence.
- Keep watching with nothing set (legal, and it costs nothing).
- Let it go.
Put it back on watch with update_thesis on its thesis_id, change_status "WATCHING", plus whatever wakes it; to let it go, write the one-line reason on an update_thesis and it clears.

Answered: one update_thesis saying which you chose and why.

Mistakes:
- Never looking at it again: a sold stock you never look at again is a thesis you already paid for and threw away.`,
  },
  NO_SETUP_NAMED: {
    name: "no setup named",
    guidance: `When: a stock we hold, or one we watch with a buy price, has no setup named. Everything setup-aware skips it: the trigger run's confirmation, the exits a buy writes, the held review's checklist.

Answer, in order:
1. Which setup was it bought on, or is its buy price written on? Read the chart and the thesis; \`nameTheSetup.choose\` lists this analyst's setups.

What you can do:
- Name it on this review, in the same update_thesis call: setup_id from those choices. On a held stock that also writes the setup's own exits onto the stock, so do not add those yourself.
- If no setup fits: setup_id "NONE", with the reason in the rationale.

Answered: setup_id on an update_thesis. Named (or NONE), the stock stops asking.

Mistakes:
- Adding the setup's exits by hand on a held stock after naming it: naming it writes them.`,
  },
};

/** Situations whose answer needs fields the trigger run's save lacks (a setup's exits, a full commitment), so the morning run answers them. */
const NOT_FOR_THE_TRIGGER_RUN: ReadonlySet<SituationCode> = new Set(["NO_SETUP_NAMED", "FIRST_RESEARCH"]);

/** The codes whose guidance a stock calls for: on a promoted stock, only the promotion's; in a trigger run, none it can't answer. */
export function guidanceCodes(status: string, codes: readonly SituationCode[], runMode?: string): SituationCode[] {
  if (status === "PROMOTED") return ["PROMOTED_AWAITING"];
  return runMode === "INTRADAY_TACTICAL" ? codes.filter((c) => !NOT_FOR_THE_TRIGGER_RUN.has(c)) : [...codes];
}

/** The guidance for these codes, each text once, in rank order. */
export function guidanceFor(codes: Iterable<SituationCode>): Partial<Record<SituationCode, string>> {
  const wanted = new Set(codes);
  const out: Partial<Record<SituationCode, string>> = {};
  for (const code of Object.keys(SITUATIONS) as SituationCode[]) if (wanted.has(code)) out[code] = SITUATIONS[code].guidance;
  return out;
}

/** The situations for a person, lead first: each code, its name, and whether the lead flag is what put the stock in it. */
export function situationLabels(s: SituationSources): Array<{ code: SituationCode; name: string; lead: boolean }> {
  const lead = new Set(s.needs[0] ? flagCodes(s, s.needs[0]) : []);
  return situationsFor(s).map((code) => ({ code, name: SITUATIONS[code].name, lead: lead.has(code) }));
}

/** Plan checks list a stock by themselves, except these two (decision 4, docs/plans/AGENT_ARCHITECTURE.md). */
const CHECKS_THAT_DO_NOT_LIST = new Set(["NO_BUY_LEVEL", "COMPOSITE_BELOW_MINIMUM"]);
const LABELS_THAT_LIST = new Set(["ENTER_NOW", "STALE_PAST_CATALYST", "PROMOTED_DECIDE_TODAY"]);

/**
 * Whether a stock gets a full row on the morning read, as get_theses decided
 * it before: any work flag (a floor too far is one, even under a fired sale),
 * a plan check that lists, a buy into a full analyst, a setup to name, the
 * principal's word unanswered, a reached buy level or past catalyst, or a
 * promoted stock. The read adds book mode and failed prices itself.
 */
export function listsTheStock(s: SituationSources): boolean {
  return (
    s.needs.length > 0 ||
    (s.planSanity ?? []).some((f) => !CHECKS_THAT_DO_NOT_LIST.has(f.kind)) ||
    s.buyBlockedByFull ||
    s.nameTheSetup ||
    s.unansweredDecision ||
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
