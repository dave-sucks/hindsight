/**
 * Live trigger matching for buildRunInput.
 *
 * Walks every ACTIVE + WATCHING thesis owned by the analyst, batch-fetches
 * latest quotes for the union of tickers, and runs each thesis's
 * price-side predicates through evaluateTrigger. Returns matches the
 * agent should see at run start — independent of the 15-min trigger
 * cron's delivery latency.
 *
 * Why this exists separately from trigger-evaluator.ts: the cron path
 * fires async events that spawn tactical runs. This path is synchronous
 * and just produces a "current state" snapshot for the daily-run prompt.
 * Same evaluator function (`evaluateTrigger`) — different consumer.
 *
 * Signal-side predicates (SIGNAL_TYPE, EARNINGS_*, FILING, GUIDANCE) are
 * NOT evaluated here — those need a signal payload to match against and
 * already get surfaced via triggersFiredSinceLastRun.
 */
import { prisma } from "@/lib/prisma";
import { getLatestPrices, type AlpacaCredentials } from "@/lib/alpaca";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { evaluateTrigger } from "@/lib/agent/triggers/evaluate";
import type {
  Trigger,
  TriggerPredicate,
} from "@/lib/agent/triggers/types";

// Predicate kinds that don't need a signal payload — these can be
// evaluated against a fresh quote alone. Time-based predicates also
// included since they evaluate against thesis.createdAt + now.
const PRICE_OR_TIME_KINDS = new Set([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PRICE_MOVE_PCT",
  "VS_SMA",
  "RSI",
  "TIME_ELAPSED",
  "REVIEW_DATE_HIT",
]);

function isPriceOrTimePredicate(p: TriggerPredicate): boolean {
  if (PRICE_OR_TIME_KINDS.has(p.kind)) return true;
  // AND/OR composites: only descend if every leaf is price/time-side.
  if (p.kind === "AND" || p.kind === "OR") {
    return p.predicates.every(isPriceOrTimePredicate);
  }
  return false;
}

function describePredicate(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return `price < $${p.level}`;
    case "PRICE_ABOVE":
      return `price > $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `${p.direction === "UP" ? "+" : "−"}${p.pct}% over ${p.window}`;
    case "VS_SMA":
      return `${p.direction.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction.toLowerCase()} ${p.threshold}`;
    case "TIME_ELAPSED":
      return `${p.days}d elapsed since thesis creation`;
    case "REVIEW_DATE_HIT":
      return "review date hit";
    case "AND":
      return `(${p.predicates.map(describePredicate).join(" AND ")})`;
    case "OR":
      return `(${p.predicates.map(describePredicate).join(" OR ")})`;
    default:
      return p.kind;
  }
}

export interface LiveMatch {
  thesisId: string;
  ticker: string;
  triggerId: string;
  action: string;
  predicateSummary: string;
  rationale: string;
  matchDetail: string;
}

export async function evaluateLiveTriggerMatches({
  analystId,
  alpacaCreds,
}: {
  analystId: string;
  alpacaCreds?: AlpacaCredentials;
}): Promise<LiveMatch[]> {
  // Pull every active+watching thesis with non-empty triggers.
  const theses = await prisma.thesis.findMany({
    where: {
      researchRun: { agentConfigId: analystId },
      status: { in: ["ACTIVE", "WATCHING"] },
      triggers: { not: [] },
    },
    select: {
      id: true,
      ticker: true,
      status: true,
      triggers: true,
      createdAt: true,
      nextReviewAt: true,
    },
  });

  if (theses.length === 0) return [];

  // P1-14: anchor TIME_ELAPSED to the paired open position's openedAt for
  // ACTIVE (held) theses. One query over this analyst's OPEN positions on
  // the relevant tickers; WATCHING rows keep their createdAt clock.
  const activeTickers = Array.from(
    new Set(
      theses
        .filter((t: { status: string }) => t.status === "ACTIVE")
        .map((t: { ticker: string }) => t.ticker),
    ),
  );
  const openedAtByTicker = new Map<string, Date>();
  if (activeTickers.length > 0) {
    const openPositions = await prisma.position.findMany({
      where: {
        analystId,
        symbol: { in: activeTickers },
        status: "OPEN",
      },
      select: { symbol: true, openedAt: true },
      orderBy: { openedAt: "desc" },
    });
    for (const p of openPositions) {
      if (!openedAtByTicker.has(p.symbol)) openedAtByTicker.set(p.symbol, p.openedAt);
    }
  }

  // Batch quote fetch — one call per unique ticker.
  const tickers: string[] = Array.from(
    new Set(theses.map((t: { ticker: string }) => t.ticker)),
  );
  let prices: Record<string, number> = {};
  try {
    prices = await getLatestPrices(tickers, alpacaCreds);
  } catch (err) {
    console.warn(
      "[live-evaluate] Failed to fetch prices, skipping price-side matches:",
      err,
    );
    return [];
  }

  const matches: LiveMatch[] = [];
  const now = new Date();

  for (const thesis of theses) {
    const parsed = triggersArraySchema.safeParse(thesis.triggers);
    if (!parsed.success) continue;
    const triggers = parsed.data as Trigger[];

    const price = prices[thesis.ticker];
    // changePct from a single quote isn't available without a prior
    // close — we synthesize it as 0 for the evaluator's price-quote
    // shape. The PRICE_MOVE_PCT predicate uses recentPrices instead,
    // which we don't load here; PRICE_MOVE_PCT matches require the
    // full cron path with recent-prices data.
    const latestQuote =
      price != null ? { price, changePct: 0 } : undefined;

    for (const trigger of triggers) {
      if (!isPriceOrTimePredicate(trigger.predicate)) continue;

      const fires = evaluateTrigger(trigger.predicate, {
        latestQuote,
        thesis: {
          createdAt: thesis.createdAt,
          nextReviewAt: thesis.nextReviewAt,
          // P1-14: ACTIVE rows anchor TIME_ELAPSED to the position open time.
          status: thesis.status,
          positionOpenedAt:
            thesis.status === "ACTIVE"
              ? openedAtByTicker.get(thesis.ticker) ?? null
              : null,
        },
        now,
      });

      if (fires) {
        const matchDetail =
          latestQuote != null
            ? `current price $${latestQuote.price.toFixed(2)}`
            : "(time-based)";
        matches.push({
          thesisId: thesis.id,
          ticker: thesis.ticker,
          triggerId: trigger.id,
          action: trigger.action,
          predicateSummary: describePredicate(trigger.predicate),
          rationale: trigger.rationale,
          matchDetail,
        });
      }
    }
  }

  return matches;
}
