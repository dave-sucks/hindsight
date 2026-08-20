/**
 * write_thesis_research — the V1 meta-tool that produced a deep-research
 * equity thesis for the two-model thesis-writer relay.
 *
 * THESIS_WRITER_V2 (2026-08): the writer pipeline no longer calls this
 * tool — the V2 writer (lib/agent/run-thesis-writer.ts) runs the pulls
 * as its own phase (lib/agent/thesis-research/pull-data.ts), does research
 * + decision in ONE model call, and parses/persists server-side
 * (lib/agent/thesis-research/parse-sections.ts). The tool remains
 * registered for the dev bake-off page and any legacy call path; its
 * internals now delegate to the same shared modules the V2 pipeline uses,
 * so parser/pull behavior can't drift between the two.
 *
 * See docs/plans/THESIS_WRITER_V2.md.
 */

import { z } from "zod";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { defineTool } from "@/lib/agent/define-tool";
import {
  buildSynthesisPrompt,
  type SynthesisPromotionContext,
} from "@/lib/agent/thesis-research/build-synthesis-prompt";
import { pullThesisData } from "@/lib/agent/thesis-research/pull-data";
import {
  parseCitations,
  citationsFromRaw,
  parseIntoSections,
} from "@/lib/agent/thesis-research/parse-sections";

// Re-export the parser types from their new home so existing importers
// of this module keep compiling.
export type {
  ParsedTextSection,
  ParsedBullet,
  ParsedBulletSection,
  ParsedSection,
  ParsedSections,
  ResearchCitation,
} from "@/lib/agent/thesis-research/parse-sections";

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
    promotion_context: z
      .object({
        paperTenureDays: z.number().nullable(),
        paperRealizedPnl: z.number().nullable(),
        paperReviewCount: z.number().nullable(),
        promotedAt: z.string().nullable(),
      })
      .optional()
      .describe(
        "PAPER→LIVE promotion framing. When present, the synthesis prompt prepends a " +
          "PROMOTION CONTEXT block that frames the Decision Fields around the three legal " +
          "first-live-run outcomes (RE-ENTER / DOWNGRADE / INVALIDATE) instead of a generic " +
          "LONG / SHORT / PASS decision. Auto-populated by dispatch_thesis_research for " +
          "refresh-mode dispatches on PROMOTED theses; do not pass manually.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-research",

  progressLabel: ({ ticker }) => `Researching $${ticker.toUpperCase()} deep`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();

    // ── Phase 1+2: parallel structured pulls + data-block format ─────────
    const pull = await pullThesisData(T, ctx);
    const { rawDataBlock, pullErrors } = pull;

    // ── Phase 3: deep-research model synthesis ───────────────────────────
    const synthesisPrompt = buildSynthesisPrompt({
      ticker: T,
      analystContext: args.analyst_context,
      mode: args.mode,
      existingThesisSummary: args.existing_thesis_summary,
      dataBlock: rawDataBlock,
      promotionContext: args.promotion_context as
        | SynthesisPromotionContext
        | undefined,
      runDate: new Date().toISOString().slice(0, 10),
    });

    // Synthesis call — Claude Sonnet 4.6 + Anthropic native web_search.
    // maxUses 3 (Tier-1 rate-limit pressure — see git history 2026-05-18).
    let synthesizedText = "";
    let synthesisError: string | null = null;
    try {
      const result = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        messages: [{ role: "user", content: synthesisPrompt }],
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

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];
    items.push({
      kind: "ticker",
      ticker: T,
      tag: "data pulled",
      text: `7 parallel pulls${pullErrors.length ? ` (${pullErrors.length} failed: ${pullErrors.join(", ")})` : ""}`,
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
        pulledAt: pull.pulledAt,
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
