/**
 * The action tools, one job each (2026-11-18): every sentence of an agent's
 * instructions that named update_thesis, close_position or manage_position, as
 * it reads now, and the chat's two lines from #1047 (pass_on_stock, and
 * read_database off its menu). The engine tests apply it to the old
 * builder's text as a documented move; nothing else in an instruction changed.
 */
import { T1_TEXT } from "./t1-text";
import { BUY_FIRED_BEFORE, SALE_FIRED_BEFORE } from "./situation-texts-before";
import { situationText } from "@/lib/agent/situation-skills";
export const TOOL_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["then write your review with update_thesis.", "then write your review with write_note."],
  ["then write your note with update_thesis.", "then write your note with write_note."],
  ["correct the call and make it, or record in `update_thesis` why it stands.", "correct the call and make it, or record in `write_note` why it stands."],
  ["How: place_trade buys a stock we watch, manage_position trims or adds to one we own, close_position sells one. Code sizes every buy and add. Right after each, write your note on that stock with update_thesis:", "How: place_trade buys a stock we watch, add buys more of one we own, sell sells all or part of one. Code sizes every buy and add. Right after each, write your note on that stock with write_note:"],
  ["- You write a note only on a stock you proposed a trade on or sent to research this run; the tool refuses any other. A note is all your update_thesis writes: a stock's triggers, status and conviction are its analyst's.", "- You write a note only on a stock you proposed a trade on or sent to research this run; the tool refuses any other. A stock's status and conviction are its analyst's."],
  ["one `update_thesis` on a stock answers all of its situations", "one `write_note` on a stock answers all of its situations"],
  ["3. Exactly one update_thesis. Its rationale is your note: the principal reads it on the trade.", "3. Exactly one write_note. It is your note: the principal reads it on the trade."],
  ["the next turn is the update_thesis call with your note", "the next turn is the write_note call with your note"],
  ["- Write the one update_thesis: your note, which the principal reads on the trade.", "- Write the one write_note: your note, which the principal reads on the trade."],
  ["don't free-think a different opinion in your rationale.", "don't free-think a different opinion in your note."],
  ["REVIEW means research-only \u2014 write the update_thesis row and pass on trades. EXIT means close_position. ENTER means place_trade once the buy's checks hold. ADD means manage_position (scale up). TRIM means manage_position (partial close).", "REVIEW means research-only \u2014 write the note and pass on trades. EXIT means sell. ENTER means place_trade once the buy's checks hold. ADD means add (scale up). TRIM means sell (partial close)."],
  ["   - Pass. Write update_thesis with a note on what is happening", "   - Pass. Write write_note with a note on what is happening"],
  ["take its buy and Stop watching triggers off by id (remove_trigger_ids) so nothing fires on it; the morning run decides whether it stays on the book. A stock we hold is sold first with close_position, which retires the thesis itself.", "take its buy and Stop watching triggers off by id (edit_triggers with remove) so nothing fires on it; the morning run decides whether it stays on the book. A stock we hold is sold first with sell, which retires the thesis itself."],
  ["At most ONE trade tool call (place_trade / manage_position / close_position).", "At most ONE trade tool call (place_trade / add / sell)."],
  ["Always EXACTLY one update_thesis call documenting what you did and why;", "Always EXACTLY one write_note call documenting what you did and why;"],
  ["Every write tool (place_trade, close_position, manage_position, record_thesis, update_thesis) executes AGAINST this analyst;", "Every write tool (place_trade, sell, add, watch_stock, pass_on_stock, edit_triggers, set_conviction, set_catalyst_date, stop_watching, watch_again) executes AGAINST this analyst;"],
  ["Every trade and thesis edit (place_trade, close_position, manage_position, update_thesis) acts for the stock's own analyst,", "Every trade and thesis edit (place_trade, sell, add, edit_triggers, set_conviction, set_catalyst_date, stop_watching, watch_again) acts for the stock's own analyst,"],
  ["The rows are kept \u2014 the /intelligence page shows them read-only, and `read_database` can reach them \u2014 but nothing adds to them,", "The rows are kept \u2014 the /intelligence page shows them read-only \u2014 but nothing adds to them,"],
  ["`rejectionMessage`. **Order has no `accountId` column** \u2014 it scopes through `position`, so a `read_database` query on `order` filters via `{ position: { ... } }`. Prefer `list_proposals`; reach for `read_database` only for order history the tool doesn't cover.", "`rejectionMessage`."],
  ["\"what sells are staged?\" \u2192 `list_proposals`. Do NOT reach for `read_database` on `order` for this.", "\"what sells are staged?\" \u2192 `list_proposals`."],
  ["executing the trade yourself via `close_position` / `place_trade`", "executing the trade yourself via `sell` / `place_trade`"],
  ["it is a trigger or an edit on the stock (`update_thesis`, or the trade itself)", "it is a trigger or an edit on the stock (`edit_triggers`, or the trade itself)"],
  ["Then write the note with `write_note(thesis_id, text)`", "Then write the note with `write_note(thesis_id, note)`"],
  ["   \u2022 Not worth one AND you would not want the name back \u2192 `record_thesis(direction:\"PASS\", reasoning_summary:\"...\", invalidation_conditions:[...])`. Terminal:", "   \u2022 Not worth one AND you would not want the name back \u2192 `pass_on_stock(ticker, reason)`: the way to record \"we looked, and we pass\". Terminal:"],
  ["(\"close my $NVDA position right now\" \u2192 just call close_position)", "(\"close my $NVDA position right now\" \u2192 just call sell)"],
  ["For read-only and small edits (watchlist add, update_thesis with new target), just do it.", "For read-only and small edits (watchlist add, a trigger edit), just do it."],  // How a look ends (2026-11-20): the chat's line on its tool, the write-up's note, and the Portfolio Manager reading an analyst's rating.
  [
    "acts for the stock's own analyst, under its rules and the approval screen.",
    "acts for the stock's own analyst, under its rules and the approval screen. `set_conviction` changes a stock's conviction or its outlook at the owner's word, each with its reason.",
  ],
  [
    "and whether you agree, and if not, what you would do instead.",
    "and whether you agree, and if not, what you would do instead. Your note is the reason on a trade already made, so it carries no verdict and changes no conviction or outlook: the analyst's next look does that.",
  ],
  [
    "What we paid is not part of the answer.",
    "What we paid is not part of the answer. Each stock's outlook and conviction are its analyst's rating. A holding its own analyst rates neutral or bearish is the first place to look for a sale or a trim. Where you disagree with a rating, send the stock to research and say why.",
  ],
];

/** The same renames in the situation texts (lib/agent/situations.ts), the trigger run's lines among them. */
export const SITUATION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["- Defer: update_thesis with change_status \"WATCHING\". The next run looks at it again.", "- Defer: watch_again. The next run looks at it again."],
  ["Answered: place_trade, or that update_thesis.", "Answered: place_trade, or that watch_again."],
  ["- Sell: close_position with reason STOP, answering belief_survived as its description says, or trim with manage_position partial_close; then one update_thesis.", "- Sell: sell, answering belief_survived as its description says, or trim with sell and a percent; then one write_note."],
  ["- Or tighten the sale: update_thesis with edit_triggers on the fired trigger's id", "- Or tighten the sale: edit_triggers on the fired trigger's id"],
  ["Then one update_thesis. The stock's \"Stop watching if below\"", "Then one write_note. The stock's \"Stop watching if below\""],
  ["- Take the buy off: update_thesis with remove_trigger_ids, keeping a review.", "- Take the buy off: edit_triggers with remove, keeping a review."],
  ["- Press: manage_position add_to_position (it sizes the add), then update_thesis raising the upside trigger and the floor under the bigger position (edit_triggers, by id).", "- Press: add (it sizes the add), then edit_triggers raising the upside trigger and the floor under the bigger position, by id."],
  ["- Hold: raise the floor to lock a real share of the gain, under structure: update_thesis edit_triggers on the floor's id;", "- Hold: raise the floor to lock a real share of the gain, under structure: edit_triggers on the floor's id;"],
  ["- Take: manage_position partial_close, or close_position.\nThen one update_thesis. A trade may wait", "- Take: sell, part or all.\nThen one write_note. A trade may wait"],
  ["Answered: one of the three, made with its tool, and that update_thesis.", "Answered: one of the three, made with its tool, and that write_note."],
  ["- Raise the floor under that structure: update_thesis edit_triggers on the floor's id;", "- Raise the floor under that structure: edit_triggers on the floor's id;"],
  ["- Or protect by taking: manage_position partial_close so the loss at the floor fits, or close_position when the structure is breaking or the reward is gone.", "- Or protect by taking: sell part so the loss at the floor fits, or all when the structure is breaking or the reward is gone."],
  ["- They stand: update_thesis with a rationale only (trigger_id only when several fired).", "- They stand: write_note only (trigger_id only when several fired)."],
  ["`- They stand: update_thesis with a rationale only.`", "`- They stand: write_note only.`"],
  ["- A condition that happened is an exit: close_position with belief_survived false.", "- A condition that happened is an exit: sell with belief_survived false."],
  ["- No longer applicable: change_status INVALIDATED on a stock we watch; a stock we hold is sold with close_position, which retires the thesis.", "- No longer applicable: stop_watching on a stock we watch; a stock we hold is sold with sell, which retires the thesis."],
  ["Answered: one update_thesis on the stock. \"They stand\"", "Answered: one write_note on the stock. \"They stand\""],
  ["write that playbook's watch triggers with update_thesis add_triggers and name it (setup_id)", "write that playbook's watch triggers with edit_triggers' add and name it (setup_id)"],
  ["That write-up is the stock's first note and answers it; your update_thesis after it comes only when you change something (a trigger moved or a review clock), saying what and why in a sentence or two.", "That write-up is the stock's first note and answers it; your edit_triggers after it comes only when you change something (a trigger moved or a review clock), saying what and why in a sentence or two."],
  ["then one update_thesis for what you still owe it, if anything. Or re-arm it: update_thesis with edit_triggers moving the wakes to the prices that matter now, adding a review clock (add_triggers watching \"repeat\") only if the stock has earned one, and saying why. Or let it go: update_thesis with change_status ARCHIVED.", "then one write_note for what you still owe it, if anything. Or re-arm it: edit_triggers moving the wakes to the prices that matter now, adding a review clock (add, watching \"repeat\") only if the stock has earned one, and saying why. Or let it go: stop_watching."],
  ["`Or let it go: update_thesis with change_status ARCHIVED.`", "`Or let it go: stop_watching.`"],
  ["`Or let it go: update_thesis with remove_trigger_ids naming its wakes, and say in the note that it can go.", "`Or let it go: edit_triggers with remove naming its wakes, and say in the note that it can go."],
  ["carry it out with the tools, usually as a trigger via update_thesis.", "carry it out with the tools, usually as a trigger via edit_triggers."],
  ["- A question: do the work it asks for and answer in your rationale.", "- A question: do the work it asks for and answer in your note."],
  ["Answered: your one update_thesis on the stock, quoting them", "Answered: your one write_note on the stock, quoting them"],
  ["an add on good news (manage_position add_to_position sizes it), a trim or a sale proposal, or a floor moved up with update_thesis;", "an add on good news (add sizes it), a trim or a sale proposal, or a floor moved up with edit_triggers;"],
  ["Your update_thesis names the pinned note and says what it means here;", "Your write_note names the pinned note and says what it means here;"],
  ["Put it back on watch with update_thesis on its thesis_id, change_status \"WATCHING\", plus whatever wakes it; to let it go, write the one-line reason on an update_thesis and it clears.", "Put it back on watch with watch_again on its thesis_id, then whatever wakes it with edit_triggers; to let it go, write the one-line reason with write_note and it clears."],
  ["Answered: one update_thesis saying which you chose and why.", "Answered: one write_note saying which you chose and why."],
  ["`- Defer: one update_thesis saying why. This run's save has no status change: the stock stays promoted and the morning run decides.`", "`- Defer: one write_note saying why. This run has no status tool: the stock stays promoted and the morning run decides.`"],
  ["take its buy and its Stop watching line off by id (remove_trigger_ids) and say so in the note; the morning run decides whether it stays on the book. A stock we hold is sold with close_position, which retires the thesis.`", "take its buy and its Stop watching line off by id (edit_triggers with remove) and say so in the note; the morning run decides whether it stays on the book. A stock we hold is sold with sell, which retires the thesis.`"],
  ["On this stock's one update_thesis, name which holding", "On this stock's one write_note, name which holding"],
  ["A miss: a broken assumption is a sale (close_position, belief_survived false);", "A miss: a broken assumption is a sale (sell, belief_survived false);"],
  ["It is answered by an update_thesis citing the filing you read, or by the trade;", "It is answered by a write_note citing the filing you read, or by the trade;"],
];

/** The unpinned chat's pass_on_stock (2026-11-19): it names its analyst, so the line saying a pass needs the chat pinned goes. */
export const CHAT_PASS_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["Only a pass (pass_on_stock) needs the chat pinned; for new coverage,", "For new coverage,"],
];

/** A look-again is the next report or the stock's event date (2026-11-19): a day was a review clock that every note restarted. */
export const LOOK_AGAIN_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["look_again on the save (the day after the next report, or a day), or a review", "look_again on the save (the day after the next report, or the day after the stock's event date in catalyst_date), or a review"],
  ["`watch_stock` with its look-again, the price or the day.", "`watch_stock` with its look-again: the price, the next report or the event's date."],
];

/** Situations as skills (2026-11-19): what an analyst may do on a holding and on a watch is said once, in the morning run's and the trigger run's own instructions. */
export const WHAT_YOU_CAN_DO: ReadonlyArray<readonly [string, string]> = [
  ["## How tools work\n\nTools enforce", "## What you can do\n\nA situation's text says what to find out and what can follow. What you may do is the same every time, and every trade is a proposal that waits for the owner.\n\n- On a stock we hold: propose a sale or a trim (`sell`), propose an add (`add`), change its triggers (`edit_triggers`), or leave it. You can raise a floor. Only the owner lowers one.\n- On a stock we watch: propose the buy (`place_trade`), change its triggers, put on one of its playbook's triggers by its reference, send it to the Writer for new research (`dispatch_thesis_research`), stop watching it (`stop_watching`), or leave it.\n- On a stock just sold: watch it again (`watch_again`) and set what brings it back, or let it go.\n\n## How tools work\n\nTools enforce"],
  ["   - Then complete_run.\n\n## Hard constraints\n", "   - Then complete_run.\n\n## What you can do\n\nA situation's text says what to find out and what can follow. What you may do is the same every time, and every trade is a proposal that waits for the owner.\n\n- On a stock we hold: propose a sale or a trim (`sell`), propose an add (`add`), change its triggers (`edit_triggers`), or leave it. You can raise a floor. Only the owner lowers one.\n- On a stock we watch: propose the buy (`place_trade`), change its triggers, put on one of its playbook's triggers by its reference, send it to the Writer for new research (`dispatch_thesis_research`), stop watching it (`stop_watching`), or leave it.\n\n## Hard constraints\n"],
  // The trigger run can stop watching a stock (the owner's call, 2026-11-19).
  ["say so in the note, and on a stock we watch take its buy and Stop watching triggers off by id (edit_triggers with remove) so nothing fires on it; the morning run decides whether it stays on the book. A stock we hold is sold first with sell, which retires the thesis itself.", "on a stock we watch, stop watching it (`stop_watching`), and its reason is your note. A stock we hold is sold first with sell, which retires the thesis itself."],
  // The two situations on the fixtures: each text is its skill, the part for its kind of stock.
  [BUY_FIRED_BEFORE, situationText("BUY_ARRIVES", false)],
  [SALE_FIRED_BEFORE, situationText("PROTECTIVE_SALE", true)],
];

/** A fired buy is left as it is once proposed (2026-11-20): the trigger run's re-set after a blown-through price is a holding's sale and gain triggers'. */
export const PASSED_BUY_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["After a move that blew through a trigger's price, re-set it", "On a stock we hold, after a move that blew through a sale's or a gain trigger's price, re-set it"],
];

/** An old instruction or situation text with the tool renames applied, then T1's text (./t1-text.ts); a trigger run's promoted stock is answered by its note. */
export function withNewToolNames(text: string, runMode?: string): string {
  const out = [...TOOL_RENAMES, ...SITUATION_RENAMES, ...T1_TEXT, ...CHAT_PASS_TEXT, ...LOOK_AGAIN_TEXT, ...WHAT_YOU_CAN_DO, ...PASSED_BUY_TEXT].reduce((t, [was, is]) => t.split(was).join(is), text);
  return runMode === "INTRADAY_TACTICAL" ? out.split("Answered: place_trade, or that watch_again.").join("Answered: place_trade, or that write_note.") : out;
}

/** The other way: today's text with T1's text and the renames undone, to hash against what main sent before them. */
export function withOldToolNames(text: string): string {
  const back = text.split("Answered: place_trade, or that write_note.").join("Answered: place_trade, or that update_thesis.");
  return [...TOOL_RENAMES, ...SITUATION_RENAMES, ...T1_TEXT, ...CHAT_PASS_TEXT, ...LOOK_AGAIN_TEXT, ...WHAT_YOU_CAN_DO, ...PASSED_BUY_TEXT].reduceRight((t, [was, is]) => t.split(is).join(was), back);
}
