/**
 * The situations a stock is in, as one list.
 *
 * Each situation is one definition (its own file): a code, where it sits on
 * the list, which stocks it can be on, the rule that sets it (today's
 * computation, moved), its guidance and the entry a read gives it.
 *
 * The lead. Today the screen and complete_run show one reason per stock,
 * picked by needs-action.ts's precedence. That precedence is not a fixed
 * order of kinds: a floor too far outranks a fired review, a fired review
 * outranks a sale true now, and a sale true now outranks a floor too far;
 * among triggers true now the first in ladder order wins. So the lead is
 * still picked by that code (`computeNeedsAction`, unchanged), and
 * situations[0] is the situation holding it. The rest follow by `order`,
 * and `order` alone decides when nothing today flags the stock.
 */
import { stockFacts, type StockFacts } from "./facts";
import type { BookInput, Situation, SituationCode, SituationDefinition, StockInput } from "./types";
import { promotedAwaiting } from "./promoted-awaiting";
import { protectiveSale } from "./protective-sale";
import { buyArrives } from "./buy-arrives";
import { buyBlockedFull } from "./buy-blocked-full";
import { addOrWinner } from "./add-or-winner";
import { earnings } from "./earnings";
import { filing } from "./filing";
import { quietWatchWoke } from "./quiet-watch-woke";
import { protection } from "./protection";
import { firstResearch } from "./first-research";
import { reviewDue } from "./review-due";
import { staleResearch } from "./stale-research";
import { planProblem } from "./plan-problem";
import { yourWordUnanswered } from "./your-word-unanswered";
import { soldOneReview } from "./sold-one-review";
import { noSetupNamed } from "./no-setup-named";

export type * from "./types";

/** Every situation, in `order`. */
export const SITUATIONS: readonly SituationDefinition[] = (
  [
    promotedAwaiting,
    protectiveSale,
    buyArrives,
    buyBlockedFull,
    addOrWinner,
    earnings,
    filing,
    quietWatchWoke,
    protection,
    firstResearch,
    reviewDue,
    staleResearch,
    planProblem,
    yourWordUnanswered,
    soldOneReview,
    noSetupNamed,
  ] as SituationDefinition[]
).sort((a, b) => a.order - b.order);

/**
 * The situation holding today's lead: the one the old flag's kind belongs
 * to, and for a fire or a match, the first situation (by order) carrying that
 * trigger. Null when nothing today flags the stock.
 */
export function leadCode(facts: StockFacts, list: Situation[]): SituationCode | null {
  const lead = facts.lead;
  if (!lead) return null;
  switch (lead.kind) {
    case "PROMOTED_AWAITING_RESOLUTION":
      return "PROMOTED_AWAITING";
    case "SALE_DECLINED":
      return "PROTECTIVE_SALE";
    case "FLOOR_TOO_FAR":
    case "UNPROTECTED_GAIN":
      return "PROTECTION";
    case "REVIEW_DUE":
      return lead.pendingFirstReview ? "FIRST_RESEARCH" : "REVIEW_DUE";
    case "RESEARCH_STALE":
      return "STALE_RESEARCH";
    case "TRIGGER_FIRED":
    case "TRIGGER_MATCHING_NOW": {
      const holder = list.find((s) => {
        const fires = (s.data as { fires?: Array<{ source: string; triggerId: string }> }).fires;
        return fires?.some((f) => f.source === lead.kind && f.triggerId === lead.triggerId);
      });
      return holder?.code ?? null;
    }
  }
}

/** What a recorder is handed: one call's inputs and the list it returned. */
export interface SituationsCall {
  stock: StockInput;
  book: BookInput;
  now: Date;
  list: Situation[];
}
let recorder: ((call: SituationsCall) => void) | null = null;

/**
 * Hand every situationsFor call to `fn` (null stops). For the measuring
 * script (scripts/measure-situations.ts), which runs the real get_theses and
 * keeps each stock's inputs; nothing in the app sets it.
 */
export function recordSituations(fn: ((call: SituationsCall) => void) | null): void {
  recorder = fn;
}

/** The situations a stock is in: the one holding today's lead first, then by order. */
export function situationsFor(stock: StockInput, book: BookInput, now: Date): Situation[] {
  const list = ordered(stock, book, now);
  recorder?.({ stock, book, now, list });
  return list;
}

function ordered(stock: StockInput, book: BookInput, now: Date): Situation[] {
  const list: Situation[] = [];
  for (const def of SITUATIONS) {
    const r = def.rule(stock, book, now);
    if (r.active && r.data) list.push({ code: def.code, order: def.order, entry: def.entry, data: r.data } as Situation);
  }
  const facts = stockFacts(stock, book, now);
  const code = leadCode(facts, list);
  const i = code == null ? -1 : list.findIndex((s) => s.code === code);
  if (facts.lead && i < 0) {
    // Cannot happen by construction; said loudly, never thrown, so a read survives it.
    console.warn(`[situations] ${stock.ticker}: no situation holds today's lead (${facts.lead.kind})`);
  }
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}
