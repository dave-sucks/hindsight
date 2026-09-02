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
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
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
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
  "VS_SMA",
  "RSI",
  "TIME_ELAPSED",
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
    case "GAIN_FROM_ENTRY":
      return `${p.direction === "UP" ? "up" : "down"} ${p.pct}% from entry`;
    case "TRAILING_FROM_HIGH":
      return `gives back ${p.pct}% from the high`;
    case "VS_SMA":
      return `${p.direction.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction.toLowerCase()} ${p.threshold}`;
    case "TIME_ELAPSED":
      return `${p.days}d elapsed since thesis creation`;
    case "REVIEW_CADENCE":
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
  // Every active+watching thesis. No `triggers: { not: [] }` filter —
  // since the cascade landed, a thesis with an empty own-array can still
  // carry analyst / account / default rungs, and filtering on the stored
  // column would hide exactly the holdings protected only by inherited
  // minimums.
  const theses = await prisma.thesis.findMany({
    where: {
      researchRun: { agentConfigId: analystId },
      status: { in: ["HOLDING", "WATCHING"] },
    },
    select: {
      id: true,
      ticker: true,
      status: true,
      direction: true,
      triggers: true,
      // Cascade inputs — matching-now must evaluate the RESOLVED ladder,
      // or the daily run never sees an inherited rung sitting live.
      triggerState: true,
      horizon: true,
      createdAt: true,
      lastReviewedAt: true,
    },
  });

  if (theses.length === 0) return [];

  // P1-14: anchor TIME_ELAPSED to the paired open position's openedAt for
  // ACTIVE (held) theses. One query over this analyst's OPEN positions on
  // the relevant tickers; WATCHING rows keep their createdAt clock.
  const activeTickers = Array.from(
    new Set(
      theses
        .filter(
          (t: { status: string }) =>
            t.status === "HOLDING",
        )
        .map((t: { ticker: string }) => t.ticker),
    ),
  );
  const positionInfoByTicker = new Map<
    string,
    { openedAt: Date; avgCost: number | null; peakPrice: number | null }
  >();
  if (activeTickers.length > 0) {
    const openPositions = await prisma.position.findMany({
      where: {
        analystId,
        symbol: { in: activeTickers },
        status: "OPEN",
      },
      select: {
        symbol: true,
        openedAt: true,
        avgCost: true,
        peakPrice: true,
      },
      orderBy: { openedAt: "desc" },
    });
    for (const p of openPositions) {
      if (!positionInfoByTicker.has(p.symbol)) {
        positionInfoByTicker.set(p.symbol, {
          openedAt: p.openedAt,
          avgCost: p.avgCost,
          peakPrice: p.peakPrice,
        });
      }
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

  // ANALYST + ACCOUNT levels once for the batch — this function is
  // already scoped to a single analyst.
  const levelSources = (await loadLevelSources([analystId])).get(analystId);

  for (const thesis of theses) {
    const triggers = resolveThesisLadder(
      thesis,
      levelSources,
      `thesis=${thesis.id}`,
    ) as Trigger[];

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

      const posInfo =
        thesis.status === "HOLDING"
          ? positionInfoByTicker.get(thesis.ticker) ?? null
          : null;
      const fires = evaluateTrigger(trigger.predicate, {
        latestQuote,
        // GAIN_FROM_ENTRY + TRAILING_FROM_HIGH read entry cost + water
        // mark from the open position; WATCHING rows get null → false.
        position: posInfo
          ? { avgCost: posInfo.avgCost, peakPrice: posInfo.peakPrice }
          : null,
        thesis: {
          createdAt: thesis.createdAt,
          lastReviewedAt: thesis.lastReviewedAt ?? null,
          // P1-14: held rows anchor TIME_ELAPSED to the position open time.
          status: thesis.status,
          direction: thesis.direction,
          positionOpenedAt: posInfo?.openedAt ?? null,
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
