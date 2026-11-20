/**
 * The situations a stock is in, as codes, read off the work-flag list
 * (needs-action.ts) and the row's other fields; and `listsTheStock`, which
 * stocks get a full row on the morning read. Pure. A stock can be in several
 * (MU, 2026-10-07: a fired review, and 75% of the way to its upside level).
 */
import type { NeedsAction, NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";
import { isGroup, measureOf, shapeOf, type MeasureDef, type When } from "@/lib/agent/triggers/condition";

/**
 * Why a stock is in front of its analyst now. A trigger written in advance
 * fired (a sale or trim, a buy, an add); something happened (a report, a
 * filing, news); it is time to look again (a review, a floor to fix, a stock
 * just sold). Promoted and a note to answer are as they were.
 */
export type SituationCode =
  | "PROMOTED_AWAITING" | "PROTECTIVE_SALE" | "BUY_ARRIVES" | "ADD_OR_WINNER"
  | "REPORT" | "FILING" | "NEWS"
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

/** A fire or a match: by what its trigger watches when that is a report or a filing, and by its action on this stock; any other is a review. */
function fireCodes(s: SituationSources, triggerId: string, action: string): SituationCode[] {
  const held = s.status === "HOLDING";
  const codes: SituationCode[] = [];
  if ((action === "EXIT" || action === "TRIM") && held) codes.push("PROTECTIVE_SALE");
  else if (action === "ENTER" && !held) codes.push("BUY_ARRIVES");
  else if (action === "ADD" && held) codes.push("ADD_OR_WINNER");
  const watched = measuresOf(s.triggers.find((t) => t.id === triggerId)?.predicate);
  if (watched.some((m) => m.type === "earnings")) codes.push("REPORT");
  if (watched.some((m) => m.id === "filing")) codes.push("FILING");
  if (codes.length === 0) codes.push("REVIEW_DUE");
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
 * Each situation once, in the rank its text prints in: its name in a few plain
 * words (the thesis sheet's flag line), and where its text is. Nine have a
 * skill file (lib/agent/engine/skills/, read by lib/agent/situation-skills.ts):
 * what to find out, what can follow and what done looks like, with a part for
 * a stock we hold and a part for a stock we watch. Nothing here or anywhere
 * else writes a word of a skill. Promoted and a note to answer keep their
 * text here as it was.
 */
export const SITUATIONS: Record<SituationCode, { name: string; skill?: string; guidance?: string }> = {
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
  PROTECTIVE_SALE: { name: "sale signal", skill: "sale-fired.md" },
  BUY_ARRIVES: { name: "buy price reached", skill: "buy-fired.md" },
  ADD_OR_WINNER: { name: "add", skill: "add-fired.md" },
  REPORT: { name: "a report", skill: "report.md" },
  FILING: { name: "a filing", skill: "filing.md" },
  // Nothing puts a stock in it yet: a high note starts it once news is something a trigger can watch.
  NEWS: { name: "news", skill: "news.md" },
  PROTECTION: { name: "floor to fix", skill: "floor-to-fix.md" },
  REVIEW_DUE: { name: "review due", skill: "review.md" },
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

If a note is pinned: an Agent note (the 7:30 Market Reviewer's) or the principal's, on this stock alone or with others. It is in \`said\` under PINNED, above the Activity lines, with the stocks it covers and their share of the account, and it names news that could change a decision here: a market date, a story moving a group, the company's own news, how much of the account rides on it. What does it say is coming, and when? Does it reach why we own or watch this stock? Check its claim and the stock's own news against the data (the Market numbers too). Do its triggers still fit what is coming: the floor and the size on a holding, the buy and the research on a watch? Then one of these. Act on it: on a holding, an add on good news (add sizes it), a trim or a sale proposal, or a floor moved up with edit_triggers; on a watch, a buy at today's price on good news (the buy trigger moved to at or near the current price, edit_triggers by its id), a buy price moved, the research refreshed through the writer (dispatch_thesis_research), or let it go. Or keep its triggers, saying in one sentence why the note doesn't change them for this stock. It is a read on the market, not an order: the stock's own case still decides, and a floor is never moved down or loosened because of it (only the principal lowers a floor). Your write_note names the pinned note and says what it means here; the stock leaves this situation once you have written, and the note stays pinned for the others it covers. The note: what the pinned note says is coming, what it means for this stock and why, then what you did, in one sentence.`,
  },
  SOLD_ONE_REVIEW: { name: "just sold", skill: "just-sold.md" },
};

/** Situations the trigger run can't answer, so the morning run does: a sold stock is put back on watch, and the trigger run can't change a stock's status. */
const NOT_FOR_THE_TRIGGER_RUN: ReadonlySet<SituationCode> = new Set(["SOLD_ONE_REVIEW"]);

/** The codes whose text a stock calls for: on a promoted stock, only the promotion's; in a trigger run, none it can't answer. */
export function guidanceCodes(status: string, codes: readonly SituationCode[], runMode?: string): SituationCode[] {
  if (status === "PROMOTED") return ["PROMOTED_AWAITING"];
  return runMode === "INTRADAY_TACTICAL" ? codes.filter((c) => !NOT_FOR_THE_TRIGGER_RUN.has(c)) : [...codes];
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
