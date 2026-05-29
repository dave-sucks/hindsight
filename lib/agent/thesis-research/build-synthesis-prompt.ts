/**
 * build-synthesis-prompt.ts — wraps the structured data block in the
 * synthesis instructions sent to the deep-research model (Sonar / Claude /
 * Gemini / OpenAI deep research).
 *
 * Used by the bake-off dev page (Phase 0) and will be used by the
 * write_thesis_research meta-tool (Phase 1).
 */

/**
 * Promotion context — set only when the synthesis is being run as part of
 * a PAPER→LIVE promotion refresh. Frames the Decision Fields block around
 * the three legal first-live-run outcomes (re-enter / downgrade / invalidate)
 * instead of a generic LONG / SHORT / PASS decision. See
 * `docs/PROD_DEPLOYMENT_PLAN.md` Scenario J.
 */
export interface SynthesisPromotionContext {
  /** Days the position was held in paper before promotion. 0 if never opened. */
  paperTenureDays: number | null;
  /** Cumulative realized P&L across all paper closes on this ticker (USD). */
  paperRealizedPnl: number | null;
  /** Number of UPDATED/REVIEWED audit rows on the thesis pre-promotion. */
  paperReviewCount: number | null;
  /** ISO timestamp of the promotion event. */
  promotedAt: string | null;
}

export interface SynthesisPromptArgs {
  ticker: string;
  analystContext: string;
  mode: "mint" | "refresh";
  existingThesisSummary?: string;
  dataBlock: string;
  promotionContext?: SynthesisPromotionContext;
  /**
   * ISO YYYY-MM-DD for today. Threaded through to the date-awareness block
   * so the synthesis model can distinguish past-tense vs future-tense
   * earnings claims. Defensive mirror of the writer-prompt fix from
   * PR #354's MRVL hallucination investigation. The proximate cause was a
   * Sonar web_search fabrication; the writer agent caught it eventually
   * but only after laundering the bad number. The synthesis prompt also
   * uses a web-search-enabled model (Claude Sonnet 4.6 + native search),
   * so the same class of bug could land here if synthesis ever succeeds
   * with similar Sonar / Google-grounding bias on future-dated catalysts.
   */
  runDate?: string;
}

function formatPnl(pnl: number | null): string {
  if (pnl == null) return "unknown";
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "today";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function buildPromotionBlock(ctx: SynthesisPromotionContext): string {
  const tenure = ctx.paperTenureDays ?? 0;
  const reviews = ctx.paperReviewCount ?? 0;
  const pnl = formatPnl(ctx.paperRealizedPnl);
  const when = formatDate(ctx.promotedAt);
  return `═══════════════════════════════════════════════════════════════════
PROMOTION CONTEXT — this thesis was just promoted from paper to live
═══════════════════════════════════════════════════════════════════
The analyst was promoted PAPER→LIVE on ${when}. This thesis was held in
paper for ${tenure} days, generated ${pnl} realized P&L, and was reviewed
${reviews} times before the user promoted the analyst to real money. The
paper position was force-closed at promotion.

Your rewrite must frame the Decision Fields block to explicitly answer:
given the conviction history above + current data + current price, which
of these three is the right call for the first live run?

  1. RE-ENTER LIVE — keep direction LONG/SHORT, current target/stop, status
     PROMOTED → ACTIVE on first live trade
  2. DOWNGRADE — change status to WATCHING (conviction softened, wait for
     cleaner entry)
  3. INVALIDATE — change direction to PASS, the paper outcome + current
     data say this thesis is dead

If paper P&L is strongly positive AND fundamentals still hold → bias
toward RE-ENTER. If paper P&L is negative AND no thesis-breaking catalyst
→ bias toward DOWNGRADE. If paper P&L is negative AND a key assumption
broke → bias toward INVALIDATE.
`;
}

export function buildSynthesisPrompt(args: SynthesisPromptArgs): string {
  const {
    ticker,
    analystContext,
    mode,
    existingThesisSummary,
    dataBlock,
    promotionContext,
    runDate,
  } = args;
  const T = ticker.toUpperCase();

  const modeNote =
    mode === "refresh" && existingThesisSummary
      ? `MODE: REFRESH. The existing thesis on $${T} is:

${existingThesisSummary}

Update the thesis based on new evidence since it was written. Where the
data above contradicts or supersedes the existing thesis, flag the change
explicitly.`
      : `MODE: MINT (net-new coverage).`;

  const promotionBlock = promotionContext ? `\n${buildPromotionBlock(promotionContext)}\n` : "";

  return `You are writing a deep-research equity thesis on $${T}.

═══════════════════════════════════════════════════════════════════
ANALYST CONTEXT — whose voice you're writing in
═══════════════════════════════════════════════════════════════════
${analystContext}

${modeNote}
${promotionBlock}
═══════════════════════════════════════════════════════════════════
GROUND-TRUTH DATA — use these numbers; do not invent or contradict
═══════════════════════════════════════════════════════════════════
${dataBlock}

${
  runDate
    ? `═══════════════════════════════════════════════════════════════════
DATE-AWARENESS — read before any earnings or catalyst claim
═══════════════════════════════════════════════════════════════════
Today is ${runDate}. Any catalyst date later than today (earnings prints,
FDA decisions, product launches, regulatory rulings) has NOT yet occurred.
When the ground-truth data above, the existing thesis, or your own web
research references such a catalyst:

  • Frame the outcome as "expected" / "anticipated" / "consensus expects".
  • NEVER frame it as "reported" / "beat" / "missed" / "actuals printed".
  • If a web search summary claims a future-dated catalyst has already
    printed (past-tense verbs + specific actuals), treat it as a
    search-result hallucination and discard it.

Cross-check ANY earnings claim against the Earnings History rows in the
ground-truth data — if the quarter isn't there, it hasn't reported.
Ground-truth data IS the source of truth; live web results are
supplemental and CAN hallucinate around future catalysts (production
incident 2026-05-26 — see PR #354).

`
    : ""
}═══════════════════════════════════════════════════════════════════
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

   ## Decision Fields (Recommended)
   Schema-shaped recommendations the analyst agent will copy into the
   record_thesis tool call. Treat as your considered first-pass; the
   agent reads the structured shape directly. Use these EXACT field
   labels and shapes. See docs/plans/THESIS_SCHEMA_AUDIT.md for the
   full rationale on why each field matters.

   **Direction:** LONG | SHORT | PASS — one-line why (which side of the
   bull-vs-bear weight wins, and why)

   **Horizon:** CATALYST | TARGET | TRADE | COMPOUNDER — one-line why
   - If CATALYST: catalyst_date = <YYYY-MM-DD> and the specific event name
   - If TRADE: max_hold_days = <N> and one-line why this window (5-7 for
     tight breakouts, 10-14 for swing patterns)

   **Entry / Target / Stop:**
   - Entry: $X (the current price reference from the data block)
   - Target: $Y (cite the level — breakout / resistance / consensus PT /
     analyst-aggregate / earnings-pop projection)
   - Stop: $Z (cite the level — support / -N% / structural break)
   - R:R: <target-entry>/(entry-stop) for LONG, or
     <entry-target>/(stop-entry) for SHORT. Must be ≥ 2:1.

   **Confidence: N/100** — one-line justification (cite the strongest
   data point that drove the score)

   **Core Belief (ONE sentence):**
   <The single load-bearing claim that, if it stops being true, the
   thesis is broken. Distinct from "bull case" — this is the one
   sentence the trade hinges on. Example: "AI-driven datacenter capex
   sustains $200B/quarter through 2026, driving NVDA gross margins above
   75%."

   **Key Assumptions (3+ falsifiable premises that must REMAIN TRUE):**
   Each item is a specific, checkable claim. Generic prose ("strong
   fundamentals") is insufficient. The tactical agent re-evaluates these
   against fresh signals to decide whether a trigger fire is
   thesis-breaking.
   - <Premise 1 — specific and falsifiable>
   - <Premise 2 — specific and falsifiable>
   - <Premise 3 — specific and falsifiable>

   **Invalidation Conditions (3+ specific trip-wires — DISTINCT from
   Bear Case above):**
   Specific things that would prove the thesis wrong. Bear Case lists
   risks (what could go wrong); Invalidation Conditions are the
   decision-rule trip-wires that end the position. Generic risks like
   "market volatility" are forbidden.
   - <Specific trip-wire — e.g. "Q2 EPS miss greater than 5%">
   - <Specific trip-wire — e.g. "Gross margin drops below 70% on next print">
   - <Specific trip-wire — e.g. "CFO departure or guidance cut on capex">

   **Composite Score: N/10** (sum of the four dimensions below; cap 10)
   - Trend Strength (0-3): <score> — <one-line evidence: e.g. "Multi-week
     uptrend, rising 50d MA, no major distribution candles">
   - Relative Strength (0-3): <score> — <one-line evidence: e.g. "Leads
     AI semis: +28% YTD vs AMD +14%, INTC -3%">
   - Entry Quality (0-2): <score> — <one-line evidence: e.g. "Clean
     pullback to 20d in trend at $185 entry vs $200 prior high — not a
     chase">
   - Catalyst Freshness (0-2): <score> — <one-line evidence: e.g. "Q2
     earnings 7/29 with beat-and-raise setup; data center revenue
     trajectory still accelerating">

   **Target Size:** N% of portfolio — one-line why (conviction × R:R ×
   analyst sizing convention)

   **Suggested Custom Triggers (beyond horizon defaults):**
   Most theses need no custom triggers — the horizon defaults handle
   the standard cases (entry/stop/target/earnings/filings). Add custom
   triggers ONLY when a specific key assumption or invalidation
   condition warrants a non-default predicate. Use predicate kinds from
   lib/agent/triggers/types.ts (PRICE_ABOVE, PRICE_BELOW, EARNINGS_BEAT,
   EARNINGS_MISS, GUIDANCE_CHANGE, FILING, RSI, VS_SMA, PRICE_MOVE_PCT,
   TIME_ELAPSED, REVIEW_DATE_HIT, SIGNAL_TYPE).
   - <Optional. Format: [PREDICATE_KIND params] → ACTION — rationale.
     Example: "EARNINGS_MISS minSurprisePct: 3 → REVIEW — guidance miss
     on next print kills the AI-acceleration thesis. Cooldown 7d.">
   - <Skip this section entirely if horizon defaults are sufficient.>

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
