/**
 * The situations a stock is in, as codes, read off the work-flag list
 * (needs-action.ts) and the row's other fields; and `listsTheStock`, which
 * stocks get a full row on the morning read. Pure. A stock can be in several
 * (MU, 2026-10-07: a fired review, and 75% of the way to its upside level).
 */
import type { NeedsAction, NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";
import { isGroup, measureOf, reviewClockDays, shapeOf, type MeasureDef, type When } from "@/lib/agent/triggers/condition";
import { actionLabel, conditionSentence } from "@/lib/agent/triggers/condition/describe";
import { needsActionFlag } from "@/lib/agent/needs-action-line";

/**
 * Why a stock is in front of its analyst now. A trigger written in advance
 * fired (a sale or trim, a buy, an add); something happened (a report, a
 * filing, news); it is time to look again (a review, a floor to fix, a stock
 * just sold). Promoted to live is its own case.
 */
export type SituationCode =
  | "PROMOTED_AWAITING" | "PROTECTIVE_SALE" | "BUY_ARRIVES" | "ADD_OR_WINNER"
  | "REPORT" | "FILING" | "NEWS"
  | "PROTECTION" | "REVIEW_DUE" | "SOLD_ONE_REVIEW";

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

/** A fire or a match: by what its trigger watches when that is a report, a filing or a news note, and by its action on this stock; any other is a review. */
function fireCodes(s: SituationSources, triggerId: string, action: string): SituationCode[] {
  const held = s.status === "HOLDING";
  const codes: SituationCode[] = [];
  if ((action === "EXIT" || action === "TRIM") && held) codes.push("PROTECTIVE_SALE");
  else if (action === "ENTER" && !held) codes.push("BUY_ARRIVES");
  else if (action === "ADD" && held) codes.push("ADD_OR_WINNER");
  const watched = measuresOf(s.triggers.find((t) => t.id === triggerId)?.predicate);
  if (watched.some((m) => m.type === "earnings")) codes.push("REPORT");
  if (watched.some((m) => m.id === "filing")) codes.push("FILING");
  if (watched.some((m) => m.id === "note")) codes.push("NEWS");
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
  if (s.soldReview) codes.push("SOLD_ONE_REVIEW");
  return [...new Set(codes)];
}

/**
 * Each situation once, in the rank its text prints in: its name in a few plain
 * words (the thesis sheet's flag line), and where its text is. Nine have a
 * skill file (lib/agent/engine/skills/, read by lib/agent/situation-skills.ts):
 * what to find out, what can follow and what done looks like, with a part for
 * a stock we hold and a part for a stock we watch. Nothing here or anywhere
 * else writes a word of a skill. Promoted to live keeps its text here as it was.
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
  PROTECTIVE_SALE: { name: "possible sale", skill: "sale-fired.md" },
  BUY_ARRIVES: { name: "possible buy", skill: "buy-fired.md" },
  ADD_OR_WINNER: { name: "possible add", skill: "add-fired.md" },
  REPORT: { name: "earnings report", skill: "report.md" },
  FILING: { name: "SEC filing", skill: "filing.md" },
  // A trigger that watches the Market Reviewer's notes fired: a high note landed on the stock.
  NEWS: { name: "news", skill: "news.md" },
  PROTECTION: { name: "floor to fix", skill: "floor-to-fix.md" },
  REVIEW_DUE: { name: "review", skill: "review.md" },
  SOLD_ONE_REVIEW: { name: "just sold", skill: "just-sold.md" },
};

/** Situations the trigger run can't answer, so the morning run does: a sold stock is put back on watch, and the trigger run can't change a stock's status. */
const NOT_FOR_THE_TRIGGER_RUN: ReadonlySet<SituationCode> = new Set(["SOLD_ONE_REVIEW"]);

/** The codes whose text a stock calls for: on a promoted stock, only the promotion's; in a trigger run, none it can't answer. */
export function guidanceCodes(status: string, codes: readonly SituationCode[], runMode?: string): SituationCode[] {
  if (status === "PROMOTED") return ["PROMOTED_AWAITING"];
  return runMode === "INTRADAY_TACTICAL" ? codes.filter((c) => !NOT_FOR_THE_TRIGGER_RUN.has(c)) : [...codes];
}

/** A situation on one stock, in the one wording every place uses. */
export interface SituationLabel {
  code: SituationCode;
  name: string;
  /** What raised it on this stock: the trigger's condition, or the one fact a code check has. Null when there is nothing to add. */
  detail: string | null;
  /**
   * The tag every place prints: the decision on the table, then why. A trigger's action is the decision
   * and its condition the why ("Possible sell · below $804", "Review · every 30 days"); a check in the code
   * is its name, then its fact ("Floor to fix · 2.1% of the account below here").
   */
  text: string;
  /** Whether today's lead flag is what put the stock in it. */
  lead: boolean;
}

/** The decision a trigger puts on the table, by its action. A review names no direction: the look decides. */
const DECISION: Record<string, string> = { EXIT: "Possible sell", TRIM: "Possible trim", ENTER: "Possible buy", ADD: "Possible add", REVIEW: "Review" };
const decisionOf = (action: string) => DECISION[action] ?? actionLabel(action);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const tag = (decision: string, why: string | null) => (why ? `${decision} · ${why}` : decision);

type Raised = { codes: SituationCode[]; detail: string | null; decision?: string };

/** What raised a flag: a trigger (its action is the decision, its condition the why), or the one fact a code check carries. */
function flagDetail(s: SituationSources, f: NeedsAction): Raised[] {
  const why = (id: string, fallback: string) => {
    const t = s.triggers.find((x) => x.id === id);
    return t ? conditionSentence(t.predicate) : fallback;
  };
  switch (f.kind) {
    case "TRIGGER_FIRED":
      return [f, ...(f.alsoFired ?? [])].map((x) => ({ codes: fireCodes(s, x.triggerId, x.action), detail: why(x.triggerId, x.summary), decision: decisionOf(x.action) }));
    case "TRIGGER_MATCHING_NOW":
      return [{ codes: fireCodes(s, f.triggerId, f.action), detail: why(f.triggerId, f.predicateSummary), decision: decisionOf(f.action) }];
    case "SALE_DECLINED": {
      const flag = needsActionFlag(f);
      return [{ codes: flagCodes(s, f), detail: `${flag.name.toLowerCase()}${flag.detail ? `, ${flag.detail}` : ""}`, decision: DECISION.EXIT }];
    }
    case "REVIEW_DUE": {
      // The review clock is a trigger ("Review every 30 days"): the first one on the stock, as reviewDue reads it.
      const clock = s.triggers.find((t) => { const w = shapeOf(t.predicate); return w != null && reviewClockDays(w) != null; });
      const late = needsActionFlag(f).detail;
      return [{ codes: flagCodes(s, f), detail: clock ? `${conditionSentence(clock.predicate)}${late ? `, ${late}` : ""}` : late, decision: DECISION.REVIEW }];
    }
    default:
      return [{ codes: flagCodes(s, f), detail: needsActionFlag(f).detail }];
  }
}

/** Every situation the stock is in, lead first, each in the one wording the stock table, the stock's page and an agent's row all print. */
export function situationLabels(s: SituationSources): SituationLabel[] {
  const lead = new Set(s.needs[0] ? flagCodes(s, s.needs[0]) : []);
  const raised = new Map<SituationCode, Raised>();
  for (const f of s.needs) for (const d of flagDetail(s, f)) for (const code of d.codes) if (!raised.has(code)) raised.set(code, d);
  if (s.buyBlockedByFull && !raised.has("BUY_ARRIVES")) raised.set("BUY_ARRIVES", { codes: ["BUY_ARRIVES"], detail: "its analyst holds its limit of stocks", decision: DECISION.ENTER });
  return situationsFor(s).map((code) => {
    const name = SITUATIONS[code].name;
    const r = raised.get(code);
    const detail = r?.detail ?? null;
    return { code, name, detail, text: tag(r?.decision ?? cap(name), detail), lead: lead.has(code) };
  });
}

/** The tags of a stock's situations, each once: one trigger can raise two situations (a sale on earnings is a sale and a report). */
export function situationTags(s: SituationSources): string[] {
  return [...new Set(situationLabels(s).map((x) => x.text))];
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
