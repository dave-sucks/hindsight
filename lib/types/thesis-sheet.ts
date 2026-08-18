/**
 * thesis-sheet contract types. The sheet renders from a durable/live split:
 *
 *   • ThesisDossier — durable DB state (GET /api/theses/:id). Gates first paint.
 *   • QuoteResponse — the live layer (GET /api/theses/:id/quote): price + PnL +
 *     the price-dependent `resolved` envelope.
 *   • candles (StockCandle[]) and coverage (AnalystCoverageData) hydrate from
 *     their own ticker-scoped endpoints, each on its own boundary.
 *
 * Lives in lib/ because BOTH sides speak it: server routes produce it, the
 * sheet/rows/hooks consume it. Component files re-export for import paths.
 */

export interface TriggerPredicate {
  kind: string;
  level?: number;
  pct?: number;
  direction?: string;
  window?: string;
  period?: number;
  threshold?: number;
  signalType?: string;
  sentiment?: string;
  minUrgency?: string;
  minSurprisePct?: number;
  formType?: string;
  days?: number;
  trailPct?: number;
  predicates?: TriggerPredicate[];
}

export interface Trigger {
  id: string;
  predicate: TriggerPredicate;
  action: string;
  rationale: string;
  cooldownDays?: number;
  lastFiredAt?: string;
  /** "TACTICAL" (wake an agent) | "DIRECT" (close directly, no agent). Absent ⇒ TACTICAL. */
  fireMode?: "TACTICAL" | "DIRECT";
  /**
   * Which record this rung is stored on — the cascade level. Set by the
   * server's resolver (lib/agent/triggers/levels), never by the client.
   *
   *   THESIS  — stored on this thesis. Editable here. Solid pill.
   *   ANALYST — an analyst standing rule, shared by all its theses.
   *   ACCOUNT — an account standing rule, shared by every analyst.
   *   DEFAULT — a code constant. Read-only everywhere.
   *
   * Absent ⇒ treat as THESIS (a payload from before the cascade).
   */
  level?: "THESIS" | "ANALYST" | "ACCOUNT" | "DEFAULT";
  /**
   * `level !== "THESIS"`. Drives the dotted border and the read-only
   * popover: an inherited rung is edited at the level that owns it, not
   * here, so one edit can't silently mean different things on different
   * theses.
   */
  inherited?: boolean;
  /** Who authored the value — informational, shown in the popover. */
  source?: "DEFAULT" | "AGENT" | "PRINCIPAL";
  /**
   * The rung this one displaced, if any. Makes an override legible: a
   * dashed border only ever explains levels nothing has overridden, so
   * without this a `+20% from entry` rung looks identical whether it
   * replaced the +10% default or was invented from scratch.
   */
  overrides?: {
    level: "THESIS" | "ANALYST" | "ACCOUNT" | "DEFAULT";
    predicate: TriggerPredicate;
  };
}

// Position info from /triggers — quantity + cost basis + days held only.
// Live-quote-derived fields (currentPrice / marketValue / unrealizedPnl)
// come from the separate /quote response (`QuoteResponse.positionPnl`)
// and are merged into the rendered PositionRow client-side.
export interface ThesisStatePosition {
  /** Position row id — drives the sheet's "View trade →" link. Optional
   *  because the pre-fetched sheetState path (P2-19) doesn't carry it. */
  id?: string;
  quantity: number;
  avgCost: number;
  openedAt: string;
  daysHeld: number;
  closed?: boolean;
  closedAt?: string | null;
  closePrice?: number | null;
  realizedPnl?: number | null;
  realizedPnlPct?: number | null;
  closeReason?: string | null;
  // Trade-as-Proposal — populated when this position has an
  // Order(AWAITING_APPROVAL) attached. Drives the "Awaiting your approval"
  // alert at the top of the sheet with inline [Approve][Reject] actions.
  // See docs/plans/TRADE_AS_PROPOSAL.md §6.
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    quantity: number;
    expiresAt: string | null;
    rationale: string | null;
  } | null;
}

export interface ThesisScoringDim {
  score: number;
  note?: string;
}
export interface ThesisScoring {
  trendStrength?: ThesisScoringDim;
  relativeStrength?: ThesisScoringDim;
  entryQuality?: ThesisScoringDim;
  catalystFreshness?: ThesisScoringDim;
}

export interface ThesisDossier {
  thesisId: string;
  ticker: string;
  status: string;
  /** LONG | SHORT | null (pass/seed). The sheet reads direction from here. */
  direction: string | null;
  // When the thesis row was created — anchors the "started watching"
  // vertical marker on the sheet's price chart.
  createdAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
  // P1-24 B3: reason a thesis reached RETIRED — "SOLD"|"INVALIDATED"|
  // "DROPPED"|"REPLACED"|null. Drives the terminal-status banner.
  retiredReason: string | null;
  horizon: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  catalystDate: string | null;
  maxHoldDays: number | null;
  nextReviewAt: string | null;
  triggers: Trigger[];
  /**
   * The analyst that owns this thesis. Lets the trigger section deep-link
   * an ANALYST-level rung to the place it can actually be edited. Null for
   * a thesis whose research run has no analyst.
   */
  analystId: string | null;
  position: ThesisStatePosition | null;
  // Structural belief — load-bearing fields the trade-evaluator + tactical
  // agent read. Surfaced to the sheet so the user can see what the agent
  // actually committed to.
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  // 4-dim composite scoring + the /10 sum. Composite is the SINGLE
  // conviction number (PR-9 collapsed the legacy `confidenceScore` int
  // onto this). Both place_trade gates read from here.
  scoring: ThesisScoring | null;
  scoringComposite: number | null;
  // ── Conviction Expression v4 (writer-side) ──────────────────────────
  // See docs/plans/CONVICTION_EXPRESSION.md §3-§4. Tier verdict +
  // one-sentence rationale + the writer's contrarian take. Null on
  // PASS / PENDING / pre-v4 legacy rows. The conviction badge in
  // ThesisSheet header keys off `conviction`; tooltip shows
  // `convictionRationale`; the variantView callout block keys off
  // `variantView` (rendered only when present).
  conviction: "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null;
  convictionRationale: string | null;
  variantView: string | null;
  // ── V2 9-section narrative dossier (PR-9 flat schema) ────────────────
  // The 9 first-class JSONB columns that replaced the `researchSections`
  // blob. Three retypes of legacy fields (snapshot ↔ reasoningSummary,
  // bullCase ↔ thesisBullets, bearCase ↔ riskFlags) + 6 new sections.
  // Each section is either text-with-citations or bullets-with-citations
  // (see ResearchTextSection / ResearchBulletSection). All nullable —
  // legacy rows have the 3 retyped sections populated with empty
  // citations; the 6 new sections are null until V2 refresh.
  snapshot: ResearchTextSection | null;
  recentCatalysts: ResearchTextSection | null;
  fundamentals: ResearchTextSection | null;
  latestEarnings: ResearchBulletSection | null;
  catalystsAndEvents: ResearchBulletSection | null;
  bullCase: ResearchBulletSection | null;
  bearCase: ResearchBulletSection | null;
  analystConsensus: ResearchTextSection | null;
  insiderTechnical: ResearchTextSection | null;
  researchUpdatedAt: string | null;
  // Provenance: where the thesis came from + the analyst's one-line
  // rationale + the Signal rows that informed it.
  sourceKind: string | null;
  sourceRationale: string | null;
  sourceSignalIds: string[];
  // Direction-flip chain pointer. When non-null, this thesis supersedes
  // an earlier thesis on the same ticker; renders as a "Replaces #abc"
  // chip near the StatusPill.
  parentThesisId: string | null;
}

// Conviction Expression v4 — read-time resolver envelope (§6). Live price +
// trigger evaluation + supersession + the actionability rollup that drives the
// Trade-Structure "Status" cell. Price-dependent, so it rides on the live
// QuoteResponse rather than the durable dossier.
export interface ResolvedEnvelope {
  currentPrice: number | null;
  entryQualityScore: number | null;
  triggerState: "ENTER_FIRED" | "ENTER_WAITING" | "EXIT_FIRED" | "NONE";
  triggerDetail: string | null;
  actionability:
    | "ENTER_NOW"
    | "WAIT_FOR_TRIGGER"
    | "PENDING_CATALYST"
    | "ACTIVE_HOLD"
    | "STALE_PAST_CATALYST"
    | "SUPERSEDED"
    | "PROMOTED_DECIDE_TODAY"
    | "DEAD";
  supersededBy: string | null;
  staleness: "FRESH" | "STALE";
  resolvedAt: string;
  quoteAgeMs: number | null;
}

// Response shape from /api/theses/:id/quote — the live layer. Split from the
// durable dossier so the ~1-2s Finnhub call never blocks the readable body.
// The sheet fires both in parallel: the dossier paints, this refines the price
// header, position PnL, and the resolved "Status" cell whenever Finnhub lands.
export interface QuoteResponse {
  currentPrice: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  positionPnl: {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
  } | null;
  // Company name + exchange from the Finnhub profile — thesis rows rarely
  // store them, so the sheet header reads them off the quote to show the full
  // name + "TICKER · EXCHANGE" instead of the ticker twice.
  companyName?: string | null;
  exchange?: string | null;
  // Price-dependent actionability envelope (see ResolvedEnvelope). Null when
  // the resolver couldn't run.
  resolved?: ResolvedEnvelope | null;
}

// `sourcesUsed` column is Json — agents write `[{provider, title, url}]`
// at mint, but the column is permissive (some old rows have other shapes
// or null entries). Type loosely + render defensively.
export type ThesisSourcesUsedItem = {
  provider?: string;
  title?: string;
  url?: string;
  publishedAt?: string;
};
export type ThesisSourcesUsed = ThesisSourcesUsedItem[] | unknown;

// Deep-research section payload — see docs/plans/THESIS_RESEARCH_V2.md §4.4.
// Two content shapes coexist (text-with-citations OR bullet list). Keys are
// optional because the synthesis model may omit sections that don't apply.
export interface ResearchCitation {
  url?: string;
  title?: string;
  domain?: string;
  kind?: "STRUCTURED" | "WEB" | string;
}
export interface ResearchTextSection {
  text: string;
  citations?: ResearchCitation[];
}
export interface ResearchBullet {
  text: string;
  citation?: ResearchCitation;
}
export interface ResearchBulletSection {
  bullets: ResearchBullet[];
}
export interface ThesisResearchSections {
  snapshot?: ResearchTextSection;
  recentCatalysts?: ResearchTextSection;
  fundamentals?: ResearchTextSection;
  latestEarnings?: ResearchBulletSection;
  catalystsAndEvents?: ResearchBulletSection;
  bullCase?: ResearchBulletSection;
  bearCase?: ResearchBulletSection;
  analystConsensusSynthesis?: ResearchTextSection;
  insiderTechnicalSetup?: ResearchTextSection;
  // Allow unknown extra keys; the renderer ignores them. Lets the synthesis
  // model add new sections without a UI deploy.
  [extra: string]: ResearchTextSection | ResearchBulletSection | undefined;
}

