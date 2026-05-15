/**
 * build-synthesis-prompt.ts — wraps the structured data block in the
 * synthesis instructions sent to the deep-research model (Sonar / Claude /
 * Gemini / OpenAI deep research).
 *
 * Used by the bake-off dev page (Phase 0) and will be used by the
 * write_thesis_research meta-tool (Phase 1).
 */

export interface SynthesisPromptArgs {
  ticker: string;
  analystContext: string;
  mode: "mint" | "refresh";
  existingThesisSummary?: string;
  dataBlock: string;
}

export function buildSynthesisPrompt(args: SynthesisPromptArgs): string {
  const { ticker, analystContext, mode, existingThesisSummary, dataBlock } = args;
  const T = ticker.toUpperCase();

  const modeNote =
    mode === "refresh" && existingThesisSummary
      ? `MODE: REFRESH. The existing thesis on $${T} is:

${existingThesisSummary}

Update the thesis based on new evidence since it was written. Where the
data above contradicts or supersedes the existing thesis, flag the change
explicitly.`
      : `MODE: MINT (net-new coverage).`;

  return `You are writing a deep-research equity thesis on $${T}.

═══════════════════════════════════════════════════════════════════
ANALYST CONTEXT — whose voice you're writing in
═══════════════════════════════════════════════════════════════════
${analystContext}

${modeNote}

═══════════════════════════════════════════════════════════════════
GROUND-TRUTH DATA — use these numbers; do not invent or contradict
═══════════════════════════════════════════════════════════════════
${dataBlock}

═══════════════════════════════════════════════════════════════════
YOUR JOB
═══════════════════════════════════════════════════════════════════

1. Use the structured data above as ground truth for any financial
   figures, dates, ratings, transcript metadata, insider transactions,
   peer comparisons, and consensus. NEVER invent or contradict a
   number in the ground-truth data.

2. Use web research to fill narrative gaps the structured data
   doesn't cover:
   - Earnings-call transcript highlights — top 5 with specific quotes
     when available (guidance language, segment commentary, strategic
     announcements)
   - Recent (last 14 days) analyst commentary and rationale beyond the
     rating actions in the table above (what's the THESIS behind a
     specific firm's call, not just the rating itself)
   - Specific dated catalysts in the next 1-3 months (product launches,
     regulatory decisions, scheduled events, expected announcements)
   - Sentiment narrative — what's the market story THIS WEEK on this name

3. Synthesize into this exact structure. Every paragraph and bullet
   needs specific numbers, dates, or names. "Recently" without a date
   is forbidden. "Strong fundamentals" without a metric is forbidden.

   ## Snapshot
   One paragraph framing where the stock is today.

   ## Recent Catalysts (last 1-2 weeks)
   One paragraph explaining what's moved the stock and why. Cite
   specific events/news.

   ## Fundamentals
   One paragraph + segment breakdown if available. Specific revenue
   trajectory, margin trend, FCF, EBITDA, EPS with multi-year context.

   ## Latest Earnings (5 bullets)
   Top 5 takeaways from the most recent earnings call. Each bullet
   should have a specific number, quote, or commitment.

   ## Catalysts & Events (3-5 dated bullets)
   Specific dated events in the next 1-3 months. Each has a date or
   approximate timing.

   ## Bull Case (3-5 cited claims)
   3-5 specific reasons to be long. Each bullet has at least one
   data point or recent event tied to it.

   ## Bear Case (3-5 cited claims) — MANDATORY EVEN ON A LONG THESIS
   3-5 specific risks. Each bullet has at least one data point.
   Generic risks like "market volatility" or "competition" are
   forbidden — be specific.

   ## Analyst Consensus
   One paragraph synthesizing Wall Street's view. Name specific firms
   and analysts with their actions. Don't just say "consensus is Hold."

   ## Insider & Technical Setup
   One paragraph on what insiders are doing (with specific names if
   available) and what the chart looks like (with specific levels, RSI,
   trend).

═══════════════════════════════════════════════════════════════════
CITATION FORMAT
═══════════════════════════════════════════════════════════════════
- For claims sourced from the ground-truth data above:
  [STRUCTURED:<field>], e.g. [STRUCTURED:revenue_2025],
  [STRUCTURED:rating_2026-05-13_morgan_stanley]
- For claims sourced from web research:
  [WEB:<url>]
- Every paragraph and every bullet must have at least one citation.

═══════════════════════════════════════════════════════════════════
QUALITY BAR
═══════════════════════════════════════════════════════════════════
- Match the depth of a Goldman Sachs initiation note, not a Reddit post.
- Bear case is mandatory and substantive, even if the overall thesis
  is bullish.
- Specific dates, names, dollar figures throughout.
- No throat-clearing, no "in this report I will explore..." preamble.
  Open directly with the Snapshot section.

Begin.`;
}
