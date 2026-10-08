/**
 * What every situation reads about one stock, computed once per call: the
 * lead (today's precedence, `leadFlag` in ./work-flag.ts), the fires and
 * matches each with the situations they belong to, and each work-flag kind
 * on its own from the same functions leadFlag is built from.
 *
 * Where a fire belongs (QB rulings, 2026-10-07):
 *  - a trigger watching a report or a surprise belongs to EARNINGS, one
 *    watching a filing to FILING, whatever its action;
 *  - a sale or trim on a holding to PROTECTIVE_SALE; a buy on a stock we
 *    don't hold to BUY_ARRIVES, or BUY_BLOCKED_FULL while the analyst is full
 *    and the buy wants in; an add on a holding to ADD_OR_WINNER;
 *  - a review not claimed by EARNINGS or FILING to QUIET_WATCH_WOKE on a
 *    watch with no direction and no review clock of its own, else
 *    REVIEW_DUE;
 *  - a fire nothing above claims (a sale on a stock we don't hold, a buy on
 *    a holding, an add on a watch) to REVIEW_DUE, so no fire leaves the list.
 */
import {
  leadFlag,
  firedFlag,
  floorTooFarFlag,
  heldLadder,
  matchingFlag,
  matchingWork,
  openFireWork,
  promotedFlag,
  researchStaleFlag,
  reviewDueFlag,
  saleDeclinedFlag,
  unprotectedGainFlag,
  type FireWork,
  type MatchWork,
  type WorkFlag,
} from "@/lib/agent/situations/work-flag";
import { floorTooFar, type FloorRisk } from "@/lib/agent/floor-risk";
import { buyBlockedByFull, type BuyBlockedByFull } from "./buy-blocked-full";
import type { Trigger } from "@/lib/agent/triggers/types";
import { measuresOf } from "./measures";
import type { BookInput, FireRef, SituationCode, StockInput } from "./types";

/** A fire or a match, with its old flag and the situations it belongs to. */
export interface FireItem {
  ref: FireRef;
  /** What needsAction would carry if this fire or match led. */
  flag: WorkFlag;
  homes: SituationCode[];
}

export interface StockFacts {
  held: boolean;
  /** Today's lead: leadFlag on the caller's own input. */
  lead: WorkFlag | null;
  promoted: WorkFlag | null;
  declined: WorkFlag | null;
  floorTooFar: WorkFlag | null;
  /**
   * The same floor's risk with the stock named in its sentence, as the
   * resolver gave it (moved from resolved-thesis.ts): it lists a stock even
   * when a fired sale holds the lead.
   */
  floorRisk: FloorRisk | null;
  unprotectedGain: WorkFlag | null;
  clock: WorkFlag | null;
  stale: WorkFlag | null;
  /** The fires first (newest first), then the matches (ladder order). */
  items: FireItem[];
  blocked: BuyBlockedByFull | null;
}

const EARNINGS_MEASURES = ["report", "surprise"];
const FILING_MEASURES = ["filing"];

/** A trigger the stock carries of its own, not inherited from its analyst or the account (resolved-thesis.ts reads it the same way). */
function isOwn(t: Trigger): boolean {
  return ((t as { level?: string }).level ?? "THESIS") === "THESIS";
}

/** A watch with no direction and no review clock of its own: it comes back only when a wake fires (9e323ec9 quiet-watch). */
export function isQuietWatch(stock: StockInput): boolean {
  const t = stock.work.thesis;
  if (t.status !== "WATCHING" || t.direction != null) return false;
  return !t.triggers.filter(isOwn).some((x) => measuresOf(x.predicate).includes("repeat"));
}

function homesOf(stock: StockInput, held: boolean, blocked: boolean, action: string, measures: string[]): SituationCode[] {
  const homes: SituationCode[] = [];
  if (measures.some((m) => EARNINGS_MEASURES.includes(m))) homes.push("EARNINGS");
  if (measures.some((m) => FILING_MEASURES.includes(m))) homes.push("FILING");
  if ((action === "EXIT" || action === "TRIM") && held) homes.push("PROTECTIVE_SALE");
  else if (action === "ENTER" && !held) homes.push(blocked ? "BUY_BLOCKED_FULL" : "BUY_ARRIVES");
  else if (action === "ADD" && held) homes.push("ADD_OR_WINNER");
  else if (action === "REVIEW" && homes.length === 0) homes.push(isQuietWatch(stock) ? "QUIET_WATCH_WOKE" : "REVIEW_DUE");
  if (homes.length === 0) homes.push("REVIEW_DUE");
  return homes;
}

const cache = new WeakMap<StockInput, { book: BookInput; now: number; facts: StockFacts }>();

export function stockFacts(stock: StockInput, book: BookInput, now: Date): StockFacts {
  const hit = cache.get(stock);
  if (hit && hit.book === book && hit.now === now.getTime()) return hit.facts;

  const input = stock.work;
  const held = input.thesis.status === "HOLDING";
  const lead = leadFlag(input);
  const ladder = heldLadder(input);

  // A buy that fired (or is true now) while the analyst is full, as
  // get_theses computes it: the buy's own last fire, and whether the lead is
  // a buy true right now.
  const own = Array.isArray(stock.ownTriggers)
    ? (stock.ownTriggers as Array<{ action?: string; lastFiredAt?: string }>)
    : [];
  const blocked = buyBlockedByFull(
    {
      ticker: stock.ticker,
      status: input.thesis.status ?? null,
      enterLastFiredAt: own.find((x) => x.action === "ENTER")?.lastFiredAt ?? null,
      enterLiveNow: lead?.kind === "TRIGGER_MATCHING_NOW" && lead.action === "ENTER",
    },
    book.capacity ?? null,
    now,
  );

  const measuresFor = (triggerId: string) => {
    const t = input.thesis.triggers.find((x) => x.id === triggerId);
    return t ? measuresOf(t.predicate) : [];
  };
  const fired: FireWork[] = openFireWork(input);
  const matches: MatchWork[] = matchingWork(input);
  const items: FireItem[] = [
    ...fired.map((w) => {
      const measures = measuresFor(w.f.triggerId);
      return {
        ref: { source: "TRIGGER_FIRED" as const, triggerId: w.f.triggerId, action: w.action, summary: w.summary, measures, count: w.f.count, lastAt: w.f.lastAt.toISOString() },
        flag: firedFlag(input, w, fired),
        homes: homesOf(stock, held, blocked != null, w.action, measures),
      };
    }),
    ...matches.map((m) => {
      const measures = measuresOf(m.trigger.predicate);
      const flag = matchingFlag(input, m);
      return {
        ref: { source: "TRIGGER_MATCHING_NOW" as const, triggerId: m.trigger.id, action: m.action, summary: flag.kind === "TRIGGER_MATCHING_NOW" ? flag.predicateSummary : "", measures, livePrice: input.latestQuote?.price ?? null },
        flag,
        homes: homesOf(stock, held, blocked != null, m.action, measures),
      };
    }),
  ];

  const facts: StockFacts = {
    held,
    lead,
    promoted: promotedFlag(input),
    declined: saleDeclinedFlag(input),
    floorTooFar: floorTooFarFlag(input, ladder),
    floorRisk: ladder
      ? floorTooFar({
          ticker: stock.ticker,
          direction: input.thesis.direction ?? null,
          avgCost: input.thesis.avgCost ?? null,
          quantity: input.thesis.quantity ?? null,
          floorPrice: ladder.floor?.price ?? null,
          equity: input.equity ?? null,
          currentPrice: input.latestQuote?.price ?? null,
          structure: input.thesis.structure ?? null,
        })
      : null,
    unprotectedGain: unprotectedGainFlag(input, ladder),
    clock: reviewDueFlag(input),
    stale: researchStaleFlag(input),
    items,
    blocked,
  };
  cache.set(stock, { book, now: now.getTime(), facts });
  return facts;
}

/** The fires and matches that belong to one situation. */
export function itemsFor(facts: StockFacts, code: SituationCode): FireItem[] {
  return facts.items.filter((i) => i.homes.includes(code));
}

/**
 * A situation's first source among its fires and matches, by today's
 * precedence: a fire before a match; among fires, the one that moves money
 * before a review, else the newest; among matches, the first in ladder order.
 */
export function firstFlag(items: FireItem[]): WorkFlag | undefined {
  const fires = items.filter((i) => i.ref.source === "TRIGGER_FIRED");
  const lead = fires.find((i) => i.ref.action !== "REVIEW") ?? fires[0] ?? items[0];
  return lead?.flag;
}
