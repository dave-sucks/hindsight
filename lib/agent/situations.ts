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

/** Each situation in a few plain words, for a person: the thesis sheet's flag line. */
export const SITUATION_NAMES: Record<SituationCode, string> = {
  PROMOTED_AWAITING: "promoted to live",
  PROTECTIVE_SALE: "sale signal",
  BUY_ARRIVES: "buy level reached",
  BUY_BLOCKED_FULL: "buy blocked, full",
  ADD_OR_WINNER: "add or near target",
  EARNINGS: "earnings",
  FILING: "new filing",
  QUIET_WATCH_WOKE: "watch woke up",
  PROTECTION: "floor to fix",
  FIRST_RESEARCH: "first research due",
  REVIEW_DUE: "review due",
  STALE_RESEARCH: "research stale",
  PLAN_PROBLEM: "plan check",
  YOUR_WORD_UNANSWERED: "your word unanswered",
  SOLD_ONE_REVIEW: "sold, one look",
  NO_SETUP_NAMED: "no setup named",
};

/** The situations for a person, lead first: each code, its name, and whether the lead flag is what put the stock in it. */
export function situationLabels(s: SituationSources): Array<{ code: SituationCode; name: string; lead: boolean }> {
  const lead = new Set(s.needs[0] ? flagCodes(s, s.needs[0]) : []);
  return situationsFor(s).map((code) => ({ code, name: SITUATION_NAMES[code], lead: lead.has(code) }));
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
