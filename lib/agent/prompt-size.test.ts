/**
 * prompt-size.test.ts — a prompt can't get longer by accident
 * (docs/plans/AGENT_KNOWLEDGE_PLAN.md, "How we check it").
 *
 * Each of the five agent prompts is built from one fixed sample input and its
 * length is compared with the number recorded here. Any change to a prompt
 * changes its number, so the change shows in the PR:
 *   - a PR that deletes lowers the number;
 *   - a PR that makes a prompt longer raises it by hand and says why in the PR.
 * A lesson rarely belongs in a prompt: one setup → the setup list; one stock
 * or action → the tool's reply; every agent → the shared file; must never
 * happen → a check in the code.
 *
 * Characters, not tokens (about 4 characters to a token).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";

const RECORDED: Record<keyof typeof SAMPLE_PROMPTS, number> = {
  // 2026-11-04: +1,311 each, the voice rules' podcaster length, the view a note takes, the neighbor test and the desk words they ban (lib/agent/voice.ts).
  // 2026-11-06: tactical −32, the sample row carries its situation's fields, not every field (ROW_FIELDS in lib/agent/row-for-model.ts).
  // 2026-11-12: +223 / +239 each, the house rules' sentence on the Market and portfolio block (the snapshot wins over the digest and an account lookup); the daily run's cash line points to the snapshot (lib/agent/portfolio-block.ts).
  // 2026-11-16: +10 / −8, a stock has triggers and nothing else: the situation texts say the buy, the floor and an upside level, edited by id, with no plan.
  // 2026-11-18: −193, the morning run's instructions are one fixed text and the analyst, the market and portfolio and the book's week are blocks of the first message (now counted here, its start of the day included): the ═══ banners go.
  // 2026-11-18: +168, an agent is instructions, context and tools: the date line opens the first message, the house rules carry the line on weighing the Market and portfolio context again, the analyst carries its fence, and the regime's rules are its own text (no cash line that changes by run).
  // 2026-11-18: +59, the cash comes back in the kickoff when the snapshot couldn't be read (the sample has no snapshot).
  // 2026-11-18: −61, the analyst's fence prints only where it narrows (the three lines for an unfenced analyst changed three of six morning decisions).
  // 2026-11-18: +45, context read by subject: the book is in the first message (the analyst's get_theses read), so the first step reads it there and calls get_portfolio_context alone.
  // 2026-11-18: −3, the action tools one job each: the instructions name write_note where they named update_thesis.
  // 2026-11-19: +712, situations are skills: what an analyst may do on a holding, a watch and a stock just sold is said once, in the morning run's own instructions.
  // 2026-11-20: +1,313 each, how a look ends: the verdict, and when conviction and outlook change, imported by the morning run and the trigger run.
  // 2026-11-20: +32, step 2 names the `stocks` table in place of the quiet lines (lib/agent/stock-table.ts).
  daily: 11_433,
  // 2026-11-17: −54, the re-set duty no longer points at the deleted Manage line, and the row's playbook_checks is named by its new name.
  // 2026-11-17: +112, the sale's answer says it stays on the morning list while the price is past the line, and fires again only after a close back on the other side.
  // 2026-11-17: +65, step 4 names the triggers written at the fill and a sale's price, and a watch's buy and Stop watching triggers come off by id.
  // 2026-11-18: −422, the trigger run's instructions are one fixed text and its stock, trigger and fire are blocks of the first message (now counted here, its ask included): the ═══ banners, the PATH block, the hard wraps and the decline line (the buy and add situations carry it) go.
  // 2026-11-18: −1, the analyst opens the instructions (the morning run's measurement, #1021) and the situations line says where they are: at the end of the instructions, not the first message.
  // 2026-11-18: −1,023, the tool-call discipline section goes (the ask says it once), three sentences that pointed at a belief field, a type field and a price-only fire are corrected, and the rule on weighing the snapshot and the digests leaves with them.
  // 2026-11-18: −90, the trigger run is no longer told to pass trigger_id: its save is handed the trigger that fired.
  // 2026-11-18: +297, the same three moves (the date line, the house rule, the fence), and the fire said once in the message from the trigger check.
  // 2026-11-18: +23, the fire names its declared action, which the instructions act on.
  // 2026-11-18: −61, the same.
  // 2026-11-18: +99, when the run sells or trims, it makes that call first and its note after (the note becomes the proposal's reason).
  // 2026-11-18: −145, the same: the trigger run's text and its situations name write_note, edit_triggers, sell and add.
  // 2026-11-19: +10, the same section in the trigger run's instructions (+934), and the sample's sale text is its skill, the part for a holding (−924).
  // 2026-11-19: −253, the trigger run can stop watching a stock: the two passages on taking its triggers off for the morning run go.
  // 2026-11-20: +24, the sample stock's line says its outlook is not rated yet.
  // 2026-11-20: +37, the re-set after a blown-through price is a holding's sale and gain triggers'; a fired buy is its skill's.
  // 2026-11-23: tactical -10, the sample row is the one row every opened stock gets: no line on how to get the full row, and its assumptions with it (ROW_FIELDS).
  tactical: 14_744,
  // 2026-11-05: +487, the setup prices a view and never decides one; a view you'd look at again is a watch with its review, not a pass; the floor's note says what a close below it means.
  // 2026-11-13: +177, what would prove it wrong is the business, never a stock price, an average, a high or low, or a gap; the belief has no stock price.
  // 2026-11-13: +99, when the first message has what the chat already found, research only what that leaves open.
  // 2026-11-16: +90, the writer writes the buy and the floor as triggers (no entry / target / stop fields), and a watch's floor stops watching it.
  // 2026-11-16: +301, a watch's floor is a STOP_WATCHING trigger on the close that never sells; a watch carries no EXIT.
  // 2026-11-16: +8, the Stop watching line is where the setup is over, with no floor and no distance from the buy; the run that buys names the sale.
  // 2026-11-16: −181, the writer is no longer told the setup rules the save used to check: a buy names a setup, the setup is on the seat's list, a closed window sends the stock to the next setup, a buy stays within the chase limit.
  // 2026-11-17: −1,126, YOUR PLAYBOOKS shows each playbook's watch triggers (the sentence, the trigger as written, its reason) instead of the entry, stop, target, trail and time prose, and the trigger rules point at them.
  // 2026-11-17: −200, the writer is no longer told to write a buy that is true today a few cents above today's price (a buy fires when it is true).
  // 2026-11-17: +114, each price comes from the chart today and a trigger whose price it doesn't have yet is left out; "a view with no buy names no playbook" goes; the Street is its own rule.
  // 2026-11-17: +356, a watch gets its watch triggers, its earnings review and its own looks, nothing that waits for the buy; the pre-catalyst buys carry "within 70 days before the event date".
  // 2026-11-18: +1,240, the Writer's request measured whole (its first message's date, reason and ask now counted), and its instructions one fixed text: the rules for a recent sale, someone's idea and a promotion are always there, where they printed only when they applied; a stock we own goes to the Holding refresh, whose instructions carry none of a watch's rules.
  // 2026-11-18: +116, the same three moves; its five rule texts are one, its own text one, and its brief its message (the "## Today" line goes).
  // 2026-11-18: −61, the same.
  // 2026-11-18: −2, an analyst with no playbooks gets no playbooks part (it was an empty one, a stray blank line).
  // 2026-11-19: +21, T1: the save writes the playbook's watch triggers and the Writer tailors them after it with edit_triggers; each playbook trigger is one line with its reference, and no JSON.
  // 2026-11-19: +44, the same: a price in the Writer's own trigger is a chart key or a line, and the held refresh moves its sale to a key.
  // 2026-11-19: +40, the same: a view with no buy yet carries its look-again on the save (a report or a day), a price one through edit_triggers.
  // 2026-11-19: +48, the look-again's day is the day after the stock's event date in catalyst_date.
  writer: 17_973,
  // 2026-11-05: +377, discovery's dispatch step sends the chat's notes and, for someone's thesis, the post itself (research_notes, idea_source).
  // 2026-11-06: +76, "(PASS with status WATCHING is for a stock you haven't formed a view on yet)" in discovery's watch step.
  // 2026-11-14: +156, the approval schema: a trigger's proposal has no expiresAt, stays open or is WITHDRAWN on the close, and keeps its proposedPrice.
  // 2026-11-16: +1, the same situation texts.
  // 2026-11-18: −331, the chat's instructions are one fixed text for both scopes and the pinned analyst's id, fence and watchlist are a block that ends them (its scope): the ═══ banners go; the whole-book paragraph, once only at the portfolio level, is in every run's text.
  // 2026-11-18: −67, the house rule and the analyst's fence; the scope block, the money block and the book leave the instructions (the book rides on your newest message).
  // 2026-11-18: −61, the same.
  // 2026-11-18: +68, the pinned analyst's name and id open its analyst text, as the scope block's first line did.
  // 2026-11-18: −283, the same, and pass_on_stock and read_database off the chat (#1047's chat lines).
  // 2026-11-19: −850, the send's own fields: a brief (why this stock, what was found, whose idea, its own view) and a source link; the mode, thesis id, reason, notes, setup and screen row examples go.
  // 2026-11-19: −181, a soft watch is watch_stock with its look-again, and record_thesis leaves the text with the menu.
  // 2026-11-19: −51, #1060: a pass no longer needs the chat pinned (not recorded then; main measured 34,173).
  // 2026-11-19: +26, watch_stock's look-again is the price, the next report or the event's date.
  // 2026-11-20: +104, set_conviction changes the outlook too.
  // 2026-11-23: +1, the Daily Run is at 10 AM.
  chat: 34_304,
};

/**
 * The tool definitions each agent sends, by size: every tool on its list,
 * description plus the JSON schema the SDK builds from it. They are bigger
 * than the texts (docs/plans/AGENT_ARCHITECTURE.md, 2.4), and they change
 * by accident just as easily.
 */
const RECORDED_TOOLS: Record<string, number> = {
  // 2026-11-03, on main + #909 + #911 + #912: +100 each from #911's get_theses text, +513 from update_thesis's verdict fields.
  // 2026-11-04: −107 / −96 / −480, the first-sentence rule restated in five note fields now lives in the voice rules alone.
  // 2026-11-05: +136 / +136 / +450, stop_basis says what a close below the floor means for the belief, and a PASS is not a view you'd look at again (thesis-fields.ts; the chat also has dispatch's setup line).
  // 2026-11-05: +1,078 each for dispatch's research_notes and idea_source; the chat's net −493 also drops twitter_search (−1,571), which never returned anything.
  // 2026-11-06: +77 on the chat, the same clause on record_thesis's status field; +214 each, get_theses says the row's fields follow the situation.
  // 2026-11-12: −23 each, get_portfolio_context no longer carries the digest (the Market and portfolio block does).
  // 2026-11-12: +34 each, get_market_context names the Nasdaq 100 (QQQ) beside the S&P 500 (lib/market-data/market-numbers.ts).
  // 2026-11-14: +87 each, get_portfolio_context names the day's move, the value, day and lifetime, and that they are the portfolio snapshot's.
  // 2026-11-16: +69 each, update_thesis says an empty level stays as it is and a level is removed by id in remove_trigger_ids.
  // 2026-11-16: −1,332 / −1,219, the entry / target / stop fields and their reasons leave update_thesis; a level is a trigger edit by id.
  // 2026-11-16: +669 each, place_trade takes sell_if_below and sell_reason (the holding's sale comes with the buy), and the trigger action says EXIT is a holding's and STOP_WATCHING a watch's.
  // 2026-11-16: +17, a watch's lines are its buy and its Stop watching line (update_thesis's ARCHIVED words); the triggers, not a floor, hold the price.
  // 2026-11-17: +6,201 each, place_trade's triggers_with_buy takes the playbook's other triggers that come with the buy, in the trigger shape (+5,667), and a trigger may say it is one of the playbook's watch triggers (playbook, on record_thesis and update_thesis).
  // 2026-11-17: +8 each, place_trade names the row's playbook_checks (was setup_lines).
  // 2026-11-17: −576 each, the trigger shape has no "any" and no group inside a group (one "all" level), on record_thesis, update_thesis and triggers_with_buy.
  // 2026-11-17: +239 / +224, triggers_with_buy takes a trim's size and a wait, and the field and library texts say playbook.
  // 2026-11-17: −114 each, triggers_with_buy takes no wait: there are no waits.
  // 2026-11-17: +14 each, an edit's "close" is for a typed price or an average.
  // 2026-11-18: −377 each, get_theses no longer offers include_research (the read stopped sending the research sections).
  // 2026-11-18: −432 each, place_trade takes no company, exchange or price: the tool reads the live quote, and the other two it never read.
  // 2026-11-18: −5,706 each, place_trade takes no triggers_with_buy: the fill writes the playbook's triggers that come with the buy, from the chart and the buy.
  // 2026-11-18: −869, the action tools one job each: update_thesis, manage_position and close_position become write_note, edit_triggers, set_conviction, set_catalyst_date, stop_watching, watch_again, sell and add; the trigger shape is sent once, on edit_triggers, each removal with its reason; a note has no length cap.
  // 2026-11-19: +585 each, T1: edit_triggers takes one of the stock's playbook triggers by its reference, and a chart key in a price or a move; its own trigger has no playbook mark.
  // 2026-11-19: +78 each, T2: place_trade's sell price is optional; left out, code prices the playbook's floor from the chart.
  // 2026-11-19: −2,157 each, send to the Writer takes the stock, a brief and a source link: code finds the thesis by the stock, and the Writer picks the playbook (−2,231 on the trigger run, whose stock is code's).
  // 2026-11-19: +1,230 each, edit_triggers says what each direction of `is` fires on, from the measure catalog.
  // 2026-11-19: +72 each, get_theses says the morning run's own list carries the situations' texts and every other read their names.
  // 2026-11-19: +168 each, edit_triggers takes the news note measure (watch "note": the Market Reviewer's high note on the stock).
  // 2026-11-20: −5 each, get_theses says a row's `said` is the last 3 reviews, 3 news notes, 3 of the owner's notes and the last decline.
  // 2026-11-20: +61 on each, get_theses says every stock is a line of the `stocks` table.
  // 2026-11-23: -151 on each, get_theses's description says one row, with include_research for the bull and bear cases.
  "research-run": 30_692,
  // 2026-11-18: −497, get_market_context leaves the trigger run: the market numbers block carries the same numbers.
  // 2026-11-18: −987 on the trigger run, its stock (the ticker, the thesis id, the trigger id) leaves place_trade, close_position, manage_position and update_thesis: tactical-run.ts hands it to the tools.
  // 2026-11-18: −450, the same: write_note, edit_triggers, sell and add.
  // 2026-11-19: +585, the same edit_triggers.
  // 2026-11-19: +78, the same place_trade.
  // 2026-11-19: −2,231, the same send, its stock code's.
  // 2026-11-19: +1,230, the same `is` words.
  // 2026-11-19: +72, the same get_theses.
  // 2026-11-19: +168, the same measure.
  // 2026-11-19: +508, stop_watching (its reason; code fills the stock).
  tactical: 27_244,
  // 2026-11-07: +810, write_note can address one note to several stocks, one analyst or the whole account, pinned until a date (lib/agent/shared-notes.ts).
  // 2026-11-13: +372, the same two field texts on record_thesis and update_thesis.
  // 2026-11-14: +87, the same get_portfolio_context description.
  // 2026-11-16: +69, the same update_thesis description.
  // 2026-11-16: −2,509, the same fields leave update_thesis and record_thesis.
  // 2026-11-16: +822, the same place_trade fields and trigger action text.
  // 2026-11-16: +21, the same field words.
  // 2026-11-17: +6,511, the same triggers_with_buy and playbook fields.
  // 2026-11-17: +8, the same field name.
  // 2026-11-17: −864, the same trigger shape.
  // 2026-11-17: +258, the same.
  // 2026-11-17: −114, the same.
  // 2026-11-17: +14, the same.
  // 2026-11-18: −377, the same get_theses description and fields.
  // 2026-11-18: −432, the same place_trade fields.
  // 2026-11-18: −5,706, the same place_trade field.
  // 2026-11-18: −4,946, the same tools, pass_on_stock on and read_database off; the belief, direction and horizon leave the chat's thesis edit.
  // 2026-11-19: +585, the same edit_triggers.
  // 2026-11-19: −401, the chat's add is #1050's own trigger (its playbook mark kept, no playbook references: it doesn't tailor playbooks) with a key allowed for a price.
  // 2026-11-19: −184, the chat's edit_triggers is #1050's as it was (no chart keys): back to a672's size.
  // 2026-11-19: +78, T2: place_trade's sell price is optional.
  // 2026-11-19: −2,159, the same send, and run_screen puts a row's numbers in its brief.
  // 2026-11-19: −11,010, record_thesis (and its copy of the trigger shape) off the chat, watch_stock (the stock, the reason, a look-again price or day) on it.
  // 2026-11-19: +1,230, the same `is` words.
  // 2026-11-19: +283, watch_stock's look-again is a price, the next report or the event's date.
  // 2026-11-19: +310, the same get_theses, and read_knowledge_library lists the situations (topic "situation").
  // 2026-11-19: +147, the same measure (+168), and write_note's pinned_until says a pinned note is read above the Activity lines, not that it lists the stock (−21).
  principal: 46_563,
};
const RUN_MODE: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", principal: "PRINCIPAL_CHAT" };

function toolDefinitionChars(mode: string): number {
  const all = createResearchTools({ runId: "size", userId: "u", accountId: "a", analystId: "an", runMode: RUN_MODE[mode], runEnvironment: "PAPER" } as never) as Record<string, { description?: string; inputSchema: unknown }>;
  const allow = (MODES[mode as keyof typeof MODES] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? Object.keys(all);
  return allow.filter((n) => all[n]).reduce((sum, n) => sum + (all[n].description ?? "").length + JSON.stringify(zodSchema(all[n].inputSchema as never).jsonSchema).length, 0);
}

describe("the five agent prompts, by size", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") }));
  afterAll(() => jest.useRealTimers());

  for (const name of Object.keys(RECORDED) as Array<keyof typeof RECORDED>) {
    it(`${name}: ${RECORDED[name].toLocaleString("en-US")} characters`, () => {
      expect(SAMPLE_PROMPTS[name]().length).toBe(RECORDED[name]);
    });
  }
});

describe("the four agents' tool definitions, by size", () => {
  for (const mode of Object.keys(RECORDED_TOOLS)) {
    it(`${mode}: ${RECORDED_TOOLS[mode].toLocaleString("en-US")} characters`, () => {
      expect(toolDefinitionChars(mode)).toBe(RECORDED_TOOLS[mode]);
    });
  }
});
