/**
 * write_thesis_research — the meta-tool that produces a deep-research
 * equity thesis. Single tool call from the thesis-writer agent's
 * perspective:
 *
 *   1. Parallel-pull all structured data (Finnhub / FMP / SEC EDGAR)
 *      via the existing data-layer tools (Promise.allSettled, partial
 *      tolerated).
 *   2. Format the results into the markdown data block via
 *      formatDataBlock() — that's the model's ground-truth context.
 *   3. Wrap in the synthesis prompt and hand to a deep-research model
 *      (Claude Sonnet 4.6 placeholder; bake-off will pick the final).
 *   4. Parse the response into the canonical 9-section structure and
 *      extract citations.
 *
 * Returns { sections, citations, rawDataBlock }. The thesis-writer agent
 * then layers direction / horizon / target / stop / belief on top via
 * record_thesis or update_thesis. Data block + sections persist on
 * Thesis.researchData and Thesis.researchSections.
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §4.
 */

import { z } from "zod";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { defineTool } from "@/lib/agent/define-tool";
import {
  formatDataBlock,
  type DataBlockInputs,
} from "@/lib/agent/thesis-research/format-data-block";
import { buildSynthesisPrompt } from "@/lib/agent/thesis-research/build-synthesis-prompt";
// Import each data tool's factory directly so we don't pull
// createResearchTools (which would create a circular import via the
// barrel). At call time we instantiate each with the meta-tool's ctx.
import { getStockData } from "./get-stock-data";
import { getFinancialsDeep } from "./get-financials-deep";
import { getAnalystCoverage } from "./get-analyst-coverage";
import { getInsiderActivity } from "./get-insider-activity";
import { getEarningsHistory } from "./get-earnings-history";
import { getPeersWithMetrics } from "./get-peers-with-metrics";
import { getSecFilings } from "./get-sec-filings";

// Match the loose tool-runtime shape the bake-off route uses. The AI SDK's
// strict tool-runtime opts are over-specified for our internal sub-call.
type RunnableTool = {
  execute: (
    args: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;
};

const SUB_TOOL_OPTS = {
  toolCallId: "write-thesis-research-sub",
  messages: [] as never[],
};

interface ToolEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function unwrap<T>(result: unknown): T | null {
  const env = result as ToolEnvelope<T>;
  if (!env || typeof env !== "object" || env.ok === false) return null;
  return (env.data ?? null) as T | null;
}

// ── Section parser ─────────────────────────────────────────────────────────

const SECTION_HEADERS: Array<{ key: string; pattern: RegExp }> = [
  { key: "snapshot", pattern: /^##\s+Snapshot\b/im },
  { key: "recentCatalysts", pattern: /^##\s+Recent Catalysts\b/im },
  { key: "fundamentals", pattern: /^##\s+Fundamentals\b/im },
  { key: "latestEarnings", pattern: /^##\s+Latest Earnings\b/im },
  { key: "catalystsAndEvents", pattern: /^##\s+Catalysts (?:&|and) Events\b/im },
  { key: "bullCase", pattern: /^##\s+Bull Case\b/im },
  { key: "bearCase", pattern: /^##\s+Bear Case\b/im },
  { key: "analystConsensus", pattern: /^##\s+Analyst Consensus\b/im },
  { key: "insiderTechnical", pattern: /^##\s+Insider (?:&|and) Technical\b/im },
];

export interface ParsedSection {
  text: string;
  citations: string[];
}

export interface ParsedSections {
  snapshot?: ParsedSection;
  recentCatalysts?: ParsedSection;
  fundamentals?: ParsedSection;
  latestEarnings?: ParsedSection;
  catalystsAndEvents?: ParsedSection;
  bullCase?: ParsedSection;
  bearCase?: ParsedSection;
  analystConsensus?: ParsedSection;
  insiderTechnical?: ParsedSection;
}

export interface ResearchCitation {
  /** "STRUCTURED:revenue_2025" or "WEB:https://..." */
  raw: string;
  kind: "structured" | "web";
  /** For STRUCTURED: the field key. For WEB: the URL. */
  ref: string;
  /** For WEB: best-effort domain from URL. */
  domain?: string;
}

function parseCitations(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[(STRUCTURED|WEB):([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = `${match[1]}:${match[2]}`;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

function citationsFromRaw(rawList: string[]): ResearchCitation[] {
  return rawList.map((raw): ResearchCitation => {
    const colon = raw.indexOf(":");
    const kindStr = raw.slice(0, colon).toUpperCase();
    const ref = raw.slice(colon + 1);
    if (kindStr === "WEB") {
      let domain: string | undefined;
      try {
        domain = new URL(ref).hostname;
      } catch {
        /* malformed url — leave domain undefined */
      }
      return { raw, kind: "web", ref, domain };
    }
    return { raw, kind: "structured", ref };
  });
}

function parseIntoSections(text: string): ParsedSections {
  // Find each section header's index, then slice text between consecutive
  // headers. Headers not present in the model output simply stay undefined.
  const positions: { key: string; start: number }[] = [];
  for (const { key, pattern } of SECTION_HEADERS) {
    const match = pattern.exec(text);
    if (match) positions.push({ key, start: match.index });
  }
  positions.sort((a, b) => a.start - b.start);

  const sections: ParsedSections = {};
  for (let i = 0; i < positions.length; i++) {
    const { key, start } = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    // Strip the header line itself.
    const block = text.slice(start, end);
    const newline = block.indexOf("\n");
    const body = newline >= 0 ? block.slice(newline + 1).trim() : "";
    if (!body) continue;
    (sections as Record<string, ParsedSection>)[key] = {
      text: body,
      citations: parseCitations(body),
    };
  }
  return sections;
}

// ── Tool ───────────────────────────────────────────────────────────────────

export const writeThesisResearch = defineTool({
  description:
    "Generate a complete deep-research thesis on one ticker. Pulls structured data from " +
    "Finnhub/FMP/SEC EDGAR in parallel (financials, analyst coverage, insider activity, " +
    "earnings history, peer set, recent filings, quote + technicals + news), formats it as " +
    "ground-truth context, then synthesizes a multi-section thesis via a deep-research model. " +
    "Returns sections (snapshot / fundamentals / latest earnings / catalysts / bull case / " +
    "bear case / analyst consensus / insider+technical) plus citations and the raw data block. " +
    "Call ONCE per thesis-write — this is the meta-tool that does the entire data-pull + " +
    "synthesis pipeline. Do not call individual data tools alongside it.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. NVDA"),
    analyst_context: z
      .string()
      .min(50)
      .describe(
        "The analyst's strategy in 2-3 sentences so the synthesis is framed in their voice " +
          "(e.g. 'Tech momentum analyst trading semiconductor leaders on multi-week breakouts.').",
      ),
    mode: z
      .enum(["mint", "refresh"])
      .describe(
        "mint = net-new coverage; refresh = update an existing thesis with new evidence.",
      ),
    existing_thesis_summary: z
      .string()
      .optional()
      .describe(
        "Required when mode='refresh' — short summary of what the current thesis says so " +
          "the model can flag changes vs supersede the prior view.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-research",

  progressLabel: ({ ticker }) => `Researching $${ticker.toUpperCase()} deep`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();
    const pulledAt = new Date();

    // Instantiate each data tool with the meta-tool's ctx so universe and
    // analyst scope flow through. Direct imports avoid the circular pull
    // through the tools/index.ts barrel.
    const stockTool = getStockData(ctx) as unknown as RunnableTool;
    const financialsTool = getFinancialsDeep(ctx) as unknown as RunnableTool;
    const analystCovTool = getAnalystCoverage(ctx) as unknown as RunnableTool;
    const insiderTool = getInsiderActivity(ctx) as unknown as RunnableTool;
    const earningsHistTool = getEarningsHistory(ctx) as unknown as RunnableTool;
    const peersTool = getPeersWithMetrics(ctx) as unknown as RunnableTool;
    const filingsTool = getSecFilings(ctx) as unknown as RunnableTool;

    // ── Phase 1: parallel structured data pulls ──────────────────────────
    const [
      stockRes,
      financialsRes,
      analystCovRes,
      insiderRes,
      earningsHistRes,
      peersRes,
      filingsRes,
    ] = await Promise.allSettled([
      stockTool.execute({ ticker: T, include_technicals: true }, SUB_TOOL_OPTS),
      financialsTool.execute({ ticker: T }, SUB_TOOL_OPTS),
      analystCovTool.execute({ ticker: T, window_days: 90 }, SUB_TOOL_OPTS),
      insiderTool.execute({ ticker: T, window_days: 90 }, SUB_TOOL_OPTS),
      earningsHistTool.execute({ ticker: T, quarters: 8 }, SUB_TOOL_OPTS),
      // peer_count dropped 5 → 3 on 2026-05-18 to trim the data block.
      // 3 peers is still enough for a "ranks X of N" comparison in the
      // Insider & Technical Setup section without bloating the synthesis
      // prompt by ~600 tokens for two extra peer rows.
      peersTool.execute({ ticker: T, peer_count: 3 }, SUB_TOOL_OPTS),
      filingsTool.execute({ symbol: T }, SUB_TOOL_OPTS),
    ]);

    const stockData = stockRes.status === "fulfilled"
      ? unwrap<{
          quote?: {
            price: number;
            change: number;
            changePct: number;
            high: number;
            low: number;
            open: number;
            prevClose: number;
          } | null;
          company?: {
            name: string;
            sector: string;
            marketCap: number | null;
            exchange: string;
            country: string;
          } | null;
          financials?: {
            peRatio: number | null;
            pbRatio: number | null;
            high52w: number | null;
            low52w: number | null;
            avgVolume10d: number | null;
            beta: number | null;
          } | null;
          technicals?: {
            currentPrice: number;
            rsi14: number | null;
            sma20: number | null;
            sma50: number | null;
            priceVsSma20: string | null;
            priceVsSma50: string | null;
            positionIn52wRange: string;
            volumeRatio: string | null;
            trend: string;
          } | null;
          news?: { headline: string; source: string; date: string; url: string }[];
          priceTargets?: {
            consensus?: number;
            high?: number;
            low?: number;
            median?: number;
            numAnalysts?: number;
          } | null;
        }>(stockRes.value)
      : null;

    const financials =
      financialsRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["financials"]>(financialsRes.value)
        : null;
    const analystCoverage =
      analystCovRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["analystCoverage"]>(analystCovRes.value)
        : null;
    const insider =
      insiderRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["insider"]>(insiderRes.value)
        : null;
    const earningsHistory =
      earningsHistRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["earningsHistory"]>(earningsHistRes.value)
        : null;
    const peers =
      peersRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["peers"]>(peersRes.value)
        : null;
    const filings =
      filingsRes.status === "fulfilled"
        ? unwrap<DataBlockInputs["filings"]>(filingsRes.value)
        : null;

    // Map get_stock_data's snapshot shape into the formatter's StockDataInput.
    const sd = stockData;
    const stockBlockInput: DataBlockInputs["stockData"] = {
      ticker: T,
      companyName: sd?.company?.name ?? null,
      exchange: sd?.company?.exchange ?? null,
      sector: sd?.company?.sector ?? null,
      industry: null,
      description: null,
      quote: sd?.quote
        ? {
            current: sd.quote.price ?? null,
            changePercent: sd.quote.changePct ?? null,
            open: sd.quote.open ?? null,
            dayHigh: sd.quote.high ?? null,
            dayLow: sd.quote.low ?? null,
            week52High: sd?.financials?.high52w ?? null,
            week52Low: sd?.financials?.low52w ?? null,
            marketCap: sd?.company?.marketCap ?? null,
            volume: sd?.financials?.avgVolume10d ?? null,
            beta: sd?.financials?.beta ?? null,
            pe: sd?.financials?.peRatio ?? null,
          }
        : undefined,
      technicals: sd?.technicals
        ? {
            rsi14: sd.technicals.rsi14,
            sma20: sd.technicals.sma20,
            sma50: sd.technicals.sma50,
            priceVsSma20: sd.technicals.priceVsSma20,
            priceVsSma50: sd.technicals.priceVsSma50,
            positionIn52wRange: sd.technicals.positionIn52wRange,
            volumeRatio: sd.technicals.volumeRatio,
            trend: sd.technicals.trend,
          }
        : undefined,
      recentNews: sd?.news ?? [],
      analystTargets: sd?.priceTargets ?? null,
    };

    const rawDataBlock = formatDataBlock({
      ticker: T,
      pulledAt,
      stockData: stockBlockInput,
      financials,
      analystCoverage,
      insider,
      earningsHistory,
      peers,
      filings,
    });

    // ── Phase 3: deep-research model synthesis ───────────────────────────
    // claude-sonnet-4-6 is a placeholder per the plan — the bake-off
    // (Phase 0) will pick the winner and we swap the model string here.
    // Single LLM call; the data block is the model's grounding context.
    const synthesisPrompt = buildSynthesisPrompt({
      ticker: T,
      analystContext: args.analyst_context,
      mode: args.mode,
      existingThesisSummary: args.existing_thesis_summary,
      dataBlock: rawDataBlock,
    });

    // Synthesis call — Claude Sonnet 4.6 + Anthropic native web_search.
    // This IS the bake-off winner pipeline (2026-05-16): the structured
    // data block grounds every number/date/name, and web_search fills the
    // narrative gaps the synthesis prompt asks for (recent analyst color,
    // transcript quotes, dated catalysts, sentiment). Web search is what
    // separates a Goldman-depth note from a structured-data-only summary
    // — keep it wired here.
    //
    // stepCountIs(6) caps the search loop. Empirically synthesis runs 2-4
    // searches; 6 leaves headroom. The 180s abort accounts for web search
    // RTTs — a 90s ceiling that worked for non-grounded synthesis is
    // tight once the model is hopping through 3-4 search round-trips.
    let synthesizedText = "";
    let synthesisError: string | null = null;
    try {
      const result = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        messages: [{ role: "user", content: synthesisPrompt }],
        // The AI SDK's generic Tool type doesn't unify with the provider-
        // tool factory output without a cast. Same friction as the agent
        // loop in run-thesis-writer.ts. Runtime is fine — the provider
        // wires its server-side tool execution end-to-end.
        //
        // maxUses dropped 6 → 3 on 2026-05-18 after live test surfaced
        // Anthropic Tier-1 rate-limit pressure (30k input tokens/min).
        // Each web_search result is fed back as input on the NEXT step
        // (~2k tokens per result), so 6 searches stack to ~12k of input
        // before the model writes the final note. Combined with the
        // 5KB data block and the parent agent's tokens against the same
        // org bucket, runs were hitting 30k/min in a 60-90s window. The
        // bake-off measured 2-4 searches per synthesis as typical; 3
        // covers the common case and the worker can still produce a
        // multi-section note from the structured data alone if the cap
        // hits early. If we move to Anthropic Tier 2 (80k/min) the cap
        // can move back up.
        tools: {
          web_search: anthropic.tools.webSearch_20260209({
            maxUses: 3,
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        stopWhen: stepCountIs(6),
        abortSignal: AbortSignal.timeout(180_000),
      });
      synthesizedText = result.text;
    } catch (err) {
      synthesisError = err instanceof Error ? err.message : String(err);
      console.error(
        `[write_thesis_research] synthesis failed for ${T}:`,
        synthesisError,
      );
    }

    // ── Phase 4: parse sections + citations ──────────────────────────────
    const sections = parseIntoSections(synthesizedText);
    const rawCitations = parseCitations(synthesizedText);
    const citations = citationsFromRaw(rawCitations);

    const sectionCount = Object.keys(sections).length;
    const errors: string[] = [];
    if (stockRes.status === "rejected") errors.push("stock_data");
    if (financialsRes.status === "rejected") errors.push("financials");
    if (analystCovRes.status === "rejected") errors.push("analyst_coverage");
    if (insiderRes.status === "rejected") errors.push("insider");
    if (earningsHistRes.status === "rejected") errors.push("earnings_history");
    if (peersRes.status === "rejected") errors.push("peers");
    if (filingsRes.status === "rejected") errors.push("filings");

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];
    items.push({
      kind: "ticker",
      ticker: T,
      tag: "data pulled",
      text: `7 parallel pulls${errors.length ? ` (${errors.length} failed: ${errors.join(", ")})` : ""}`,
    });
    if (synthesisError) {
      items.push({
        kind: "generic",
        text: `Synthesis failed: ${synthesisError}`,
      });
    } else {
      items.push({
        kind: "generic",
        text: `${sectionCount} sections written, ${citations.length} citation${citations.length === 1 ? "" : "s"} (${citations.filter((c) => c.kind === "web").length} web / ${citations.filter((c) => c.kind === "structured").length} structured)`,
      });
    }

    return {
      summary: synthesisError
        ? `Deep research for $${T} — synthesis failed (${synthesisError.slice(0, 80)})`
        : `Deep research for $${T} — ${sectionCount} sections, ${citations.length} citations`,
      data: {
        ticker: T,
        sections,
        citations,
        rawDataBlock,
        synthesizedText,
        synthesisError,
        pulledAt: pulledAt.toISOString(),
        items,
      },
      sources: citations
        .filter((c) => c.kind === "web")
        .slice(0, 20)
        .map((c) => ({
          provider: c.domain ?? "web",
          title: c.domain ?? c.ref,
          url: c.ref,
        })),
    };
  },
});
