/**
 * discover_signals_for_fence — Builder/Editor tool.
 *
 * Given an in-progress Universe fence (sectors / industries / themes, optionally
 * plus a seed ticker list), query the recent Signal table for real, routed
 * intelligence that would land in this analyst's inbox if they existed today.
 *
 * This is how the Builder seeds a real watchlist instead of hallucinating
 * tickers, and how the Editor justifies fence changes with "you'd have gotten
 * X signals last week if you'd added this theme".
 *
 * Match semantics (loose, UI-driven — the router is authoritative for real runs):
 *   - sectors / industries / themes: OR within dimension, AND across.
 *     Each signal must overlap at least one dimension the fence sets.
 *   - empty dimension = no filter (matches everything on that axis).
 *   - tickers (optional seed) = widen with a direct ticker match.
 *   - marketCap bounds are informational only — signals don't carry cap data
 *     and the Builder hasn't paid for a Finnhub round-trip yet.
 *
 * Result: top-N signals scored by overlap count × sourceQuality × recency,
 * plus a ticker-frequency table ranked for watchlist seeding.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { SignalWhereInput } from "@/lib/generated/prisma/models/Signal";

// ── Data shape returned to the renderer ──────────────────────────────────────

interface TickerFreq {
  ticker: string;
  signalCount: number;
  sectors: string[];
  themes: string[];
  lastHeadline: string;
  tag: string;
  summary: string;
}

interface DiscoveredSignal {
  signalId: string;
  type: string;
  headline: string;
  summary: string;
  tickers: string[];
  themes: string[];
  sectors: string[];
  sentiment: string;
  urgency: string;
  sourceQuality: number;
  freshness: string;
  matchedDimensions: string[]; // ["sectors", "themes", "tickers"]
  matchedValues: { sectors: string[]; themes: string[]; tickers: string[] };
  relevanceScore: number; // 0-100
}

interface DiscoverResult {
  count: number;
  fence: {
    sectors: string[];
    industries: string[];
    themes: string[];
    tickers: string[];
    marketCapMin: number | null;
    marketCapMax: number | null;
  };
  lookbackDays: number;
  /** Top signals, ranked by relevanceScore desc */
  signals: DiscoveredSignal[];
  /** Unique ticker frequency table, ranked for watchlist seeding */
  tickerFrequency: TickerFreq[];
  /** Ticker summary rows for the ticker-list renderer */
  tickers: { ticker: string; tag: string; summary: string }[];
  /** Empty-state diagnostic — why we found nothing, if count===0 */
  emptyReason?: string;
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export const discoverSignalsForFence = defineTool({
  description:
    "Discover real recent Signals matching an in-progress Universe fence. Use this during Builder/Editor interviews to ground the analyst's watchlist in actual intelligence — NOT hallucinated tickers. Returns top signals plus a frequency-ranked ticker table suitable for seeding the watchlist. Must pass at least one of sectors, industries, themes, or tickers.",
  schema: z
    .object({
      sectors: z
        .array(z.string())
        .optional()
        .describe(
          "Broad GICS-style sectors from the proposed fence (e.g. 'Technology', 'Energy'). OR within dimension.",
        ),
      industries: z
        .array(z.string())
        .optional()
        .describe(
          "Narrower GICS industries (e.g. 'Semiconductors', 'Biotechnology'). Matched against signal.sectors since Signal has no industry column.",
        ),
      themes: z
        .array(z.string())
        .optional()
        .describe(
          "Analyst-defined themes (e.g. 'AI_CAPEX', 'GLP1', 'EV_TRANSITION'). OR within dimension.",
        ),
      tickers: z
        .array(z.string())
        .optional()
        .describe(
          "Optional seed tickers the analyst is considering. Widens the search — signals mentioning any of these also match.",
        ),
      marketCapMin: z
        .number()
        .nullable()
        .optional()
        .describe("Informational only; recorded on the fence but not filtered."),
      marketCapMax: z
        .number()
        .nullable()
        .optional()
        .describe("Informational only; recorded on the fence but not filtered."),
      lookbackDays: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("How many days back to scan. Default 7, max 30."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("Max signals to return. Default 15."),
    })
    .refine(
      (v) =>
        (v.sectors?.length ?? 0) +
          (v.industries?.length ?? 0) +
          (v.themes?.length ?? 0) +
          (v.tickers?.length ?? 0) >
        0,
      {
        message:
          "Must pass at least one of: sectors, industries, themes, tickers.",
      },
    ),
  ui: "ticker-list" as const,
  groupId: "Discovery",

  progressLabel: (args) => {
    const themes = (args.themes ?? []).filter(Boolean);
    const sectors = (args.sectors ?? []).filter(Boolean);
    const industries = (args.industries ?? []).filter(Boolean);
    const tickers = (args.tickers ?? []).filter(Boolean);
    // Pick the most specific dimension that was set — themes read best,
    // then industries, then sectors, then tickers. Prefer "signals on X"
    // over the internal "fence" metaphor for UI text.
    const lead =
      themes[0] ??
      industries[0] ??
      sectors[0] ??
      (tickers[0] ? `$${tickers[0].toUpperCase()}` : null);
    const extras =
      themes.length + industries.length + sectors.length + tickers.length - (lead ? 1 : 0);
    if (!lead) return "Looking for recent signals";
    const suffix = extras > 0 ? ` (+${extras} more)` : "";
    return `Looking for recent signals on ${lead}${suffix}`;
  },

  execute: async (args) => {
    const sectors = (args.sectors ?? []).filter(Boolean);
    const industries = (args.industries ?? []).filter(Boolean);
    const themes = (args.themes ?? []).filter(Boolean);
    const tickers = (args.tickers ?? []).map((t) => t.toUpperCase()).filter(Boolean);
    const lookbackDays = args.lookbackDays ?? 7;
    const limit = args.limit ?? 15;

    // Build an OR-of-dimensions filter. A signal matches if it overlaps any
    // of the fence's set dimensions. AND-across-dimensions is enforced by
    // scoring downstream (signals matching more dimensions rank higher).
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const sectorNeedles = [...sectors, ...industries]; // Signal has no industry column
    const orClauses: SignalWhereInput[] = [];
    if (sectorNeedles.length) orClauses.push({ sectors: { hasSome: sectorNeedles } });
    if (themes.length) orClauses.push({ themes: { hasSome: themes } });
    if (tickers.length) orClauses.push({ tickers: { hasSome: tickers } });

    const signals = await prisma.signal.findMany({
      where: {
        createdAt: { gte: since },
        OR: orClauses,
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 4, 40), // over-fetch for scoring, then trim
    });

    const baseFence: DiscoverResult["fence"] = {
      sectors,
      industries,
      themes,
      tickers,
      marketCapMin: args.marketCapMin ?? null,
      marketCapMax: args.marketCapMax ?? null,
    };

    if (signals.length === 0) {
      const emptyReason =
        `No signals in the last ${lookbackDays} days matched fence ` +
        `(sectors=${sectors.length}, industries=${industries.length}, ` +
        `themes=${themes.length}, tickers=${tickers.length}). ` +
        `Consider broadening dimensions or extending lookbackDays.`;
      return {
        summary: `0 signals — fence too narrow or intelligence pipeline hasn't covered it yet.`,
        data: {
          count: 0,
          fence: baseFence,
          lookbackDays,
          signals: [],
          tickerFrequency: [],
          tickers: [],
          emptyReason,
        } satisfies DiscoverResult,
        sources: [],
      };
    }

    // Score each signal: +1 per matched dimension, +1 per source quality
    // point, +1 per freshness tier (BREAKING > TODAY > THIS_WEEK > OLDER).
    const freshnessWeight: Record<string, number> = {
      BREAKING: 4,
      TODAY: 3,
      THIS_WEEK: 2,
      OLDER: 1,
    };

    const scored: DiscoveredSignal[] = signals.map((s) => {
      const matchedSectors = s.sectors.filter((v) =>
        sectorNeedles.some((n) => n.toLowerCase() === v.toLowerCase()),
      );
      const matchedThemes = s.themes.filter((v) =>
        themes.some((n) => n.toLowerCase() === v.toLowerCase()),
      );
      const matchedTickers = s.tickers.filter((v) =>
        tickers.includes(v.toUpperCase()),
      );

      const dimensions: string[] = [];
      if (matchedSectors.length) dimensions.push("sectors");
      if (matchedThemes.length) dimensions.push("themes");
      if (matchedTickers.length) dimensions.push("tickers");

      const dimScore = dimensions.length * 25; // 25 per dimension × up to 3 = 75
      const qualityScore = (s.sourceQuality ?? 3) * 3; // 3-15
      const freshScore = freshnessWeight[s.freshness ?? "OLDER"] ?? 1; // 1-4
      const relevanceScore = Math.min(100, dimScore + qualityScore + freshScore);

      return {
        signalId: s.id,
        type: s.type,
        headline: s.headline,
        summary: s.summary ?? "",
        tickers: s.tickers,
        themes: s.themes,
        sectors: s.sectors,
        sentiment: s.sentiment ?? "NEUTRAL",
        urgency: s.urgency ?? "MEDIUM",
        sourceQuality: s.sourceQuality ?? 3,
        freshness: s.freshness ?? "OLDER",
        matchedDimensions: dimensions,
        matchedValues: {
          sectors: matchedSectors,
          themes: matchedThemes,
          tickers: matchedTickers,
        },
        relevanceScore,
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const top = scored.slice(0, limit);

    // Build ticker frequency from the TOP signals (the ones the builder will
    // actually see and reason about). Ranked by count desc, then most recent
    // headline wins for display.
    const tickerMap = new Map<string, TickerFreq>();
    for (const sig of top) {
      for (const rawTicker of sig.tickers) {
        const ticker = rawTicker.toUpperCase();
        if (!ticker || ticker.length > 6) continue; // filter out garbage
        const existing = tickerMap.get(ticker);
        if (existing) {
          existing.signalCount += 1;
          for (const sec of sig.sectors) if (!existing.sectors.includes(sec)) existing.sectors.push(sec);
          for (const th of sig.themes) if (!existing.themes.includes(th)) existing.themes.push(th);
        } else {
          tickerMap.set(ticker, {
            ticker,
            signalCount: 1,
            sectors: [...sig.sectors],
            themes: [...sig.themes],
            lastHeadline: sig.headline,
            tag: "1x",
            summary: sig.headline,
          });
        }
      }
    }
    const tickerFrequency = Array.from(tickerMap.values())
      .map((t) => ({ ...t, tag: `${t.signalCount}x`, summary: t.lastHeadline }))
      .sort((a, b) => b.signalCount - a.signalCount);

    // For the ticker-list renderer row view: top 10 tickers.
    const tickerRows = tickerFrequency.slice(0, 10).map((t) => ({
      ticker: t.ticker,
      tag: t.tag,
      summary: t.summary,
    }));

    const bullish = top.filter((s) => s.sentiment === "BULLISH").length;
    const bearish = top.filter((s) => s.sentiment === "BEARISH").length;
    const urgent = top.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;

    // Build a short fence description for the citation label.
    const fenceDesc = [
      themes.length > 0 ? `themes: ${themes.join(", ")}` : null,
      industries.length > 0 ? `industries: ${industries.join(", ")}` : null,
      sectors.length > 0 ? `sectors: ${sectors.join(", ")}` : null,
      tickers.length > 0 ? `tickers: ${tickers.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "broad discovery";

    return {
      summary:
        `${top.length} signal${top.length !== 1 ? "s" : ""} over ${lookbackDays}d — ` +
        `${tickerFrequency.length} unique ticker${tickerFrequency.length !== 1 ? "s" : ""}, ` +
        `${urgent} urgent, ${bullish} bullish / ${bearish} bearish.`,
      data: {
        count: top.length,
        fence: baseFence,
        lookbackDays,
        signals: top,
        tickerFrequency,
        tickers: tickerRows,
      } satisfies DiscoverResult,
      // One citable source describing the fence + window so the prose's
      // "[N] signals in the pipeline" has an InlineCitationCard to resolve to.
      sources: [
        {
          provider: "Signal Discovery",
          title: `Signals matching ${fenceDesc} (${lookbackDays}d lookback)`,
        },
      ],
    };
  },
});
