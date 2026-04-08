"use client";

import { useAssistantToolUI, useMessage } from "@assistant-ui/react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useMemo } from "react";

// ─── Briefing status — compact CoT row ─────────────────────────────────────

function BriefingStatusBanner({
  status,
  error,
}: {
  status: "success" | "failed" | "skipped";
  error: string | null;
}) {
  if (status === "success") {
    return (
      <ToolProgress>
        <ToolProgressHeader>Portfolio briefing written</ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>GPT-4o wrote the standup brief for the next run.</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  if (status === "failed") {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader>Portfolio briefing failed</ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>Post-run brief did not generate. Next session will not have updated context.</ToolProgressItem>
          {error && <ToolProgressItem>{error}</ToolProgressItem>}
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  return (
    <ToolProgress>
      <ToolProgressHeader>Portfolio briefing skipped</ToolProgressHeader>
      <ToolProgressContent>
        <ToolProgressItem>{error ?? "No analyst linked to this run."}</ToolProgressItem>
      </ToolProgressContent>
    </ToolProgress>
  );
}
import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  PortfolioReviewCard,
  type PortfolioReviewData,
  DecisionSummaryCard,
} from "@/components/domain";
import { ThesisCarousel } from "@/components/domain/thesis-carousel";
import { OrderConfirm } from "@/components/manifest-ui/order-confirm";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressItem,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";
import { ClampedText } from "@/components/ai-elements/clamped-text";
import { HugeiconsIcon } from "@hugeicons/react";
import { MessageSearch01Icon, ChartBreakoutSquareIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { extractToolSources, SourceChips } from "./tool-ui-shared";
import { SuggestConfigRender } from "./tool-ui-config";

// ─── Shared render functions (exported for tool-ui-followup.tsx reuse) ──────

/** Build a ThesisCardData from a record_thesis tool result envelope. */
function resultToThesis(result: Record<string, unknown>): ThesisCardData {
  const sources = extractToolSources(result);
  return {
    ticker: result.ticker as string,
    direction: result.direction as "LONG" | "SHORT" | "PASS",
    confidence_score: result.confidence_score as number,
    reasoning_summary: result.reasoning_summary as string,
    thesis_bullets: (result.thesis_bullets ?? []) as string[],
    risk_flags: (result.risk_flags ?? []) as string[],
    entry_price: (result.entry_price as number) ?? null,
    target_price: (result.target_price as number) ?? null,
    stop_loss: (result.stop_loss as number) ?? null,
    hold_duration: (result.hold_duration as string) ?? "SWING",
    signal_types: (result.signal_types ?? []) as string[],
    company_name: (result.company_name as string) ?? null,
    exchange: (result.exchange as string) ?? null,
    sources: sources.map((s) => ({
      provider: s.provider,
      title: s.title,
      url: s.url,
      excerpt: s.excerpt,
    })),
    fundamentals: (result.fundamentals as ThesisCardData["fundamentals"]) ?? null,
    status: (result.status as ThesisCardData["status"]) ?? undefined,
  };
}

/**
 * thesisRender — used in the agent run thread.
 *
 * Each record_thesis tool call streams in as its own message part. To
 * group every thesis from a single agent turn into ONE carousel without
 * changing the agent's tool-call shape, the FIRST record_thesis part in
 * the message reads forward through the message content and collects
 * every subsequent record_thesis result. Later record_thesis parts then
 * render null so we don't get duplicate cards.
 *
 * Same forward-read pattern as DecisionPlanRender below.
 */
export const thesisRender: ToolCallMessagePartComponent = ({ result, toolCallId }) => {
  const content = useMessage((m) => m.content) as unknown[];

  // Find all record_thesis / show_thesis parts in this message, in order
  const thesisParts = useMemo(() => {
    return content
      .map((p, i) => ({ p: p as Record<string, unknown> | undefined, i }))
      .filter(
        ({ p }) =>
          p?.type === "tool-call" &&
          (p.toolName === "record_thesis" || p.toolName === "show_thesis"),
      );
  }, [content]);

  // Find our position among thesis parts. Only the FIRST one renders the
  // carousel — every subsequent thesis tool call returns null.
  const myPositionInTheses = useMemo(() => {
    if (!toolCallId) return -1;
    return thesisParts.findIndex(({ p }) => p?.toolCallId === toolCallId);
  }, [thesisParts, toolCallId]);

  if (myPositionInTheses > 0) return null;

  // Pull tickers from EVERY thesis part (input or result) so the header
  // label can list them as soon as the agent starts streaming, even before
  // the first result lands.
  const tickers: string[] = [];
  for (const { p } of thesisParts) {
    const args = (p?.args ?? p?.input) as Record<string, unknown> | undefined;
    const r = (p?.result ?? p?.output) as Record<string, unknown> | undefined;
    const t = (r?.ticker ?? args?.ticker) as string | undefined;
    if (t && !tickers.includes(t)) tickers.push(t);
  }
  const headerLabel =
    tickers.length > 0
      ? `Writing thesis for ${tickers.map((t) => `$${t}`).join(", ")}`
      : "Writing thesis for each stock";

  // Loading state — first thesis hasn't returned yet
  if (myPositionInTheses < 0 && !result) {
    return (
      <div className="my-3 inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
        <HugeiconsIcon icon={ChartBreakoutSquareIcon} className="size-3.5 shrink-0" />
        <span>{headerLabel}…</span>
      </div>
    );
  }

  // Collect the result from every thesis tool call in the message
  const theses: ThesisCardData[] = thesisParts
    .map(({ p }) => {
      const r = (p?.result ?? p?.output) as Record<string, unknown> | undefined;
      return r ? resultToThesis(r) : null;
    })
    .filter((t): t is ThesisCardData => t !== null);

  if (theses.length === 0) return null;

  return (
    <div className="my-3 space-y-1">
      <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <HugeiconsIcon icon={ChartBreakoutSquareIcon} className="size-3.5 shrink-0" />
        <span>{headerLabel}</span>
      </div>
      <ThesisCarousel theses={theses} />
    </div>
  );
};

/**
 * thesisRenderSingle — used in the followup chat (RunFollowupChat).
 *
 * In the followup context, each record_thesis is an isolated tool call —
 * not part of a streaming agent turn that emits N theses in a row — so we
 * just render one full ThesisCard per call instead of trying to group.
 */
export const thesisRenderSingle = ({ result }: { result?: Record<string, unknown> }) => {
  if (!result) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Building thesis…</ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem active>Generating analysis</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  return (
    <div className="my-2">
      <ThesisCard {...resultToThesis(result)} />
    </div>
  );
};

// Unwrap the standardized envelope: action tools now return { summary, tickers,
// _sources, data: { ...camelCase } }. The followup chat still wants to render
// the rich TradeCard, so we drill into result.data here. Older persisted
// results without the envelope fall back to the top-level fields.
function unwrapData(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!result) return undefined;
  if (result.data && typeof result.data === "object") return result.data as Record<string, unknown>;
  return result;
}

export const placeTradeRender = ({ result }: { result?: Record<string, unknown> }) => {
  if (!result) {
    return (
      <div className="my-2 max-w-md">
        <OrderConfirm
          data={{
            productName: "Placing trade…",
            productVariant: "Submitting to Alpaca Paper",
          }}
          control={{ isLoading: true }}
        />
      </div>
    );
  }

  const d = unwrapData(result) ?? {};

  if (d.status === "FAILED" || d.success === false) {
    const ticker = (d.ticker as string) ?? "";
    return (
      <ToolProgress>
        <ToolProgressHeader>
          {ticker ? `Trade failed: $${ticker}` : "Trade failed"}
        </ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>{String(d.message ?? "")}</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  return (
    <div className="my-2">
      <TradeCard
        ticker={d.ticker as string}
        direction={d.direction as "LONG" | "SHORT"}
        entryPrice={typeof d.entryPrice === "number" ? d.entryPrice : 0}
        shares={typeof d.shares === "number" ? d.shares : undefined}
        targetPrice={typeof d.targetPrice === "number" ? d.targetPrice : undefined}
        stopLoss={typeof d.stopLoss === "number" ? d.stopLoss : undefined}
        status={d.fillStatus === "PENDING" ? "PENDING" : "OPEN"}
        placedAt={typeof d.placedAt === "string" ? d.placedAt : undefined}
        filledAt={typeof d.filledAt === "string" ? d.filledAt : undefined}
        alpacaOrderId={typeof d.alpacaOrderId === "string" ? d.alpacaOrderId : undefined}
      />
    </div>
  );
};

export const closePositionRender = ({ result }: { result?: Record<string, unknown> }) => {
  if (!result) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Closing position</ToolProgressHeader>
      </ToolProgress>
    );
  }

  const d = unwrapData(result) ?? {};

  if (d.status === "NO_POSITION") {
    return (
      <ToolProgress>
        <ToolProgressHeader>No position to close</ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>{String(d.message ?? "")}</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  if (d.status === "FAILED" || d.success === false) {
    return (
      <ToolProgress>
        <ToolProgressHeader>Close failed</ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>{String(d.message ?? "")}</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  return (
    <div className="my-2">
      <TradeCard
        ticker={d.ticker as string}
        direction={d.direction as "LONG" | "SHORT"}
        entryPrice={typeof d.entryPrice === "number" ? d.entryPrice : 0}
        shares={typeof d.shares === "number" ? d.shares : undefined}
        closePrice={typeof d.closePrice === "number" ? d.closePrice : undefined}
        realizedPnl={typeof d.realizedPnl === "number" ? d.realizedPnl : undefined}
        outcome={(d.outcome as "WIN" | "LOSS" | "BREAKEVEN") ?? null}
        status="CLOSED"
      />
    </div>
  );
};

// ─── DecisionPlanRender ─────────────────────────────────────────────────────
// The single CoT block that owns BOTH the agent's synthesis paragraph AND
// the per-ticker action rows. Each row reads forward in the message stream
// looking for a matching action tool call (place_trade, close_position,
// manage_watchlist) by ticker, and merges in the actual outcome — failed,
// executed, closed — so the user sees one row per ticker that updates as
// the run progresses. There is no second "Portfolio actions" group anywhere.

type PlannedAction = {
  ticker: string;
  action: string;
  reasoning?: string;
};

type ExecutedOutcome = {
  /** What the action tool's tag was after execution */
  tag: string;
  /** Optional outcome text to append (e.g. "Closed @ $192.40 · WIN +$710") */
  detail?: string;
};

const ACTION_TOOL_NAMES = new Set([
  "place_trade",
  "close_position",
  "manage_watchlist",
]);

function unwrapToolResult(part: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!part) return undefined;
  const result = (part.result as Record<string, unknown> | undefined)
    ?? (part.output as Record<string, unknown> | undefined);
  return result;
}

function normalizeTicker(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().trim();
}

function tagToActionIcon(tag: string | undefined): TickerActionIcon | undefined {
  switch (tag) {
    case "Buy":     return "buy";
    case "Sell":    return "sell";
    case "Watch":   return "watch";
    case "Unwatch": return "unwatch";
    case "Closed-Win": return "closed-win";
    case "Closed-Loss": return "closed-loss";
    case "Closed":  return "closed-win";
    case "Failed":
    case "NoOp":
      return "failed";
    default:
      return undefined;
  }
}

/**
 * Map a planned action label (INITIATE / ADD / HOLD / etc.) to the icon we
 * should display when there's no executed outcome yet. Once an action tool
 * fires for the same ticker, the executed outcome takes over and replaces
 * this fallback.
 */
function plannedActionIcon(action: string): TickerActionIcon | undefined {
  const a = action.toUpperCase();
  if (a === "INITIATE" || a === "ADD") return "buy";
  if (a === "REDUCE" || a === "EXIT") return "sell";
  if (a === "WATCH") return "watch";
  if (a === "REMOVE_WATCH") return "unwatch";
  // HOLD and PASS get no overlay icon — they're "no-action" states
  return undefined;
}

const DecisionPlanRender: ToolCallMessagePartComponent = ({ result, toolCallId }) => {
  // Read the full message content so we can walk forward looking for
  // executed action tool calls that match this plan's planned actions.
  const content = useMessage((m) => m.content) as unknown[];

  // Find ourselves in the message stream so we only look at parts AFTER us.
  const myIndex = useMemo(() => {
    if (!toolCallId) return -1;
    return content.findIndex((p) => {
      const part = p as Record<string, unknown> | undefined;
      return part?.type === "tool-call" && part.toolCallId === toolCallId;
    });
  }, [content, toolCallId]);

  // Build a map: TICKER → outcome from any matching action tool call
  // recorded after this decision plan in the message stream.
  const outcomesByTicker = useMemo(() => {
    const map = new Map<string, ExecutedOutcome>();
    if (myIndex < 0) return map;
    for (let i = myIndex + 1; i < content.length; i++) {
      const part = content[i] as Record<string, unknown> | undefined;
      if (!part || part.type !== "tool-call") continue;
      const toolName = part.toolName as string | undefined;
      if (!toolName || !ACTION_TOOL_NAMES.has(toolName)) continue;

      const args = (part.args as Record<string, unknown> | undefined)
        ?? (part.input as Record<string, unknown> | undefined)
        ?? {};
      const ticker = normalizeTicker(args.ticker ?? args.symbol);
      if (!ticker) continue;

      const partResult = unwrapToolResult(part);
      // Action tools return a standardized envelope with tickers[]
      const tickerFindings = partResult?.tickers as
        | { ticker: string; tag?: string; summary?: string }[]
        | undefined;
      const finding = tickerFindings?.find(
        (t) => normalizeTicker(t.ticker) === ticker,
      );

      const tag = finding?.tag ?? "";
      const detail = finding?.summary;
      // Last write wins — later actions override earlier ones for the same ticker
      map.set(ticker, { tag, detail });
    }
    return map;
  }, [content, myIndex]);

  if (!result) {
    return (
      <ToolProgress defaultOpen>
        <ToolProgressHeader loading>Managing portfolio…</ToolProgressHeader>
      </ToolProgress>
    );
  }

  const r = result as Record<string, unknown>;
  const plannedActions = (r.planned_actions as PlannedAction[] | undefined) ?? [];

  // Compute header summary from EXECUTED outcomes when available, falling
  // back to planned counts. The header reflects what actually happened
  // (or what's planned if execution hasn't started yet).
  // The synthesis is intentionally NOT shown inside this CoT — the agent
  // writes it as visible chat text in the message body just above this
  // CoT, so showing it again here would duplicate.
  const headerLabel = useMemo(() => {
    let bought = 0, sold = 0, closedWin = 0, closedLoss = 0;
    let watching = 0, unwatched = 0, failed = 0, held = 0, passed = 0;

    for (const p of plannedActions) {
      const ticker = normalizeTicker(p.ticker);
      const outcome = outcomesByTicker.get(ticker);
      if (outcome) {
        // Use the executed outcome's tag
        switch (outcome.tag) {
          case "Buy":         bought += 1; break;
          case "Sell":        sold += 1; break;
          case "Closed-Win":
          case "Closed":      closedWin += 1; break;
          case "Closed-Loss": closedLoss += 1; break;
          case "Watch":       watching += 1; break;
          case "Unwatch":     unwatched += 1; break;
          case "Failed":
          case "NoOp":        failed += 1; break;
        }
      } else {
        // No execution outcome yet — fall back to the planned label
        const a = p.action.toUpperCase();
        if (a === "INITIATE" || a === "ADD") bought += 1;
        else if (a === "REDUCE" || a === "EXIT") sold += 1;
        else if (a === "WATCH") watching += 1;
        else if (a === "REMOVE_WATCH") unwatched += 1;
        else if (a === "HOLD") held += 1;
        else if (a === "PASS") passed += 1;
      }
    }

    const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
    const parts: string[] = [];
    if (held > 0)       parts.push(`holding ${plural(held, "stock")}`);
    if (bought > 0)     parts.push(`bought ${plural(bought, "position")}`);
    if (sold > 0)       parts.push(`sold ${plural(sold, "position")}`);
    if (closedWin > 0)  parts.push(`closed ${plural(closedWin, "winner")}`);
    if (closedLoss > 0) parts.push(`closed ${plural(closedLoss, "loss")}`);
    if (watching > 0)   parts.push(`added ${plural(watching, "watchlist item")}`);
    if (unwatched > 0)  parts.push(`removed ${plural(unwatched, "watchlist item")}`);
    if (passed > 0)     parts.push(`${passed} passed`);
    if (failed > 0)     parts.push(`${failed} failed`);

    if (parts.length === 0) return "Managing portfolio";

    // Join as a sentence: "a, b, and c" — single segment stays bare
    let sentence: string;
    if (parts.length === 1) sentence = parts[0];
    else if (parts.length === 2) sentence = `${parts[0]} and ${parts[1]}`;
    else sentence = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;

    return `Managing portfolio — ${sentence}`;
  }, [plannedActions, outcomesByTicker]);

  return (
    <ToolProgress defaultOpen>
      <ToolProgressHeader>{headerLabel}</ToolProgressHeader>
      <ToolProgressContent>
        {plannedActions.map((p, i) => {
          const ticker = normalizeTicker(p.ticker);
          const outcome = outcomesByTicker.get(ticker);
          // If executed, use the action tool's tag + detail. Otherwise fall
          // back to the planned action label.
          const displayTag = outcome?.tag || p.action;
          const icon = outcome
            ? tagToActionIcon(outcome.tag)
            : plannedActionIcon(p.action);
          const detail = outcome?.detail || p.reasoning || "";
          return (
            <ToolProgressTickerItem
              key={`${p.ticker}-${i}`}
              ticker={p.ticker}
              tag={displayTag}
              actionIcon={icon}
            >
              {detail}
            </ToolProgressTickerItem>
          );
        })}
      </ToolProgressContent>
    </ToolProgress>
  );
};

// ─── Research tool UI registrations ────────────────────────────────────────

export function useRegisterResearchToolUIs(_runId?: string) {
  // ── Research tools rendered by ResearchToolGroup (return null) ──────
  useAssistantToolUI({ toolName: "get_market_context", render: () => null });
  useAssistantToolUI({ toolName: "get_stock_data", render: () => null });
  useAssistantToolUI({ toolName: "get_earnings_data", render: () => null });
  useAssistantToolUI({ toolName: "get_options_flow", render: () => null });
  useAssistantToolUI({ toolName: "get_sec_filings", render: () => null });

  // ── Intelligence: Morning Brief — generic envelope rendering ──────
  useAssistantToolUI({
    toolName: "read_morning_brief",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading morning brief...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Loading intelligence</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      const summary = r.summary as string | undefined;
      const tickers = r.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;
      const data = r.data as Record<string, unknown> | undefined;

      if (data?.available === false || r.available === false) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>No morning brief available</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>Intelligence jobs may not have run yet</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      // Read marketContext from data envelope or legacy top-level
      const marketCtx = (data?.marketContext as string) ?? (r.marketContext as string) ?? "";

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Morning intelligence brief"}</ToolProgressHeader>
          <ToolProgressContent>
            {marketCtx && <ClampedText>{marketCtx}</ClampedText>}

            {tickers && tickers.length > 0 ? (
              // Unified envelope rendering
              tickers.map((t, i) => (
                <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                  {t.summary}
                </ToolProgressTickerItem>
              ))
            ) : (
              // Fallback for old persisted runs without envelope
              <ToolProgressItem>Brief loaded</ToolProgressItem>
            )}

            <SourceChips sources={extractToolSources(r)} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Signals — generic envelope rendering ────────────
  useAssistantToolUI({
    toolName: "read_signals",
    render: ({ args, result }) => {
      const filterTickers = (args as Record<string, unknown>)?.tickers as string[] | undefined;

      if (!result) {
        const ctx = filterTickers?.length ? ` for ${filterTickers.join(", ")}` : "";
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading signals{ctx}...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Querying intelligence feed</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      const summary = r.summary as string | undefined;
      const tickers = r.tickers as { ticker: string; tag?: string; summary: string }[] | undefined;

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Signals loaded"}</ToolProgressHeader>
          <ToolProgressContent>
            {tickers && tickers.length > 0 ? (
              <>
                {tickers.slice(0, 8).map((t, i) => (
                  <ToolProgressTickerItem key={i} ticker={t.ticker} tag={t.tag}>
                    {t.summary}
                  </ToolProgressTickerItem>
                ))}
                {tickers.length > 8 && (
                  <ToolProgressItem>+{tickers.length - 8} more signals</ToolProgressItem>
                )}
              </>
            ) : (
              <ToolProgressItem>No signals found</ToolProgressItem>
            )}
            <SourceChips sources={extractToolSources(r)} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Intelligence: Artifact — generic envelope rendering ───────────
  useAssistantToolUI({
    toolName: "read_artifact",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Reading article...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Extracting content</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      const r = result as Record<string, unknown>;
      const summary = r.summary as string | undefined;

      if (!summary && r.error) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader>Article not found</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem>{String(r.error)}</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader>{summary ?? "Article loaded"}</ToolProgressHeader>
          <ToolProgressContent>
            <SourceChips sources={extractToolSources(r).length > 0 ? extractToolSources(r) : []} />
          </ToolProgressContent>
        </ToolProgress>
      );
    },
  });

  // ── Thesis → ThesisCard ────────────────────────────────────────────
  useAssistantToolUI({ toolName: "record_thesis", render: thesisRender });
  useAssistantToolUI({ toolName: "show_thesis", render: thesisRender });

  // ── Portfolio state → PortfolioReviewCard ──────────────────────────
  useAssistantToolUI({
    toolName: "get_portfolio_state",
    render: ({ result }) => {
      if (!result) {
        return (
          <ToolProgress defaultOpen>
            <ToolProgressHeader loading>Loading portfolio...</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressItem active>Fetching positions</ToolProgressItem>
            </ToolProgressContent>
          </ToolProgress>
        );
      }

      if (result.error) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Portfolio state failed: {String(result.error)}
          </div>
        );
      }

      return (
        <div className="my-2">
          <PortfolioReviewCard
            run_theses={(result.run_theses ?? []) as PortfolioReviewData["run_theses"]}
            open_positions={(result.open_positions ?? []) as PortfolioReviewData["open_positions"]}
            watchlist={(result.watchlist ?? []) as PortfolioReviewData["watchlist"]}
            account={(result.account ?? { cash: 0, buying_power: 0, portfolio_value: 0 }) as PortfolioReviewData["account"]}
          />
        </div>
      );
    },
  });

  // ── Action tools render null in the run thread ────────────────────
  // place_trade / close_position / manage_watchlist render nothing on
  // their own — their outcomes are merged into the Decision CoT
  // (DecisionPlanRender above) by reading forward in the message stream.
  // placeTradeRender / closePositionRender are still exported above for
  // RunFollowupChat, which renders them as full TradeCards in a separate
  // post-run discussion context.
  useAssistantToolUI({ toolName: "close_position", render: () => null });
  useAssistantToolUI({ toolName: "place_trade", render: () => null });

  // ── Stage 4: Decision Plan ──────────────────────────────────────────
  // The single CoT for synthesis + actions. Each planned action is rendered
  // as a ticker row, and the row reads FORWARD in the message stream for a
  // matching action tool call (place_trade / close_position /
  // manage_watchlist with the same ticker). When found, the row's tag and
  // icon are updated from the planned state to the actual outcome
  // (executed, failed, closed). This collapses what used to be two CoT
  // blocks (planned + executed) into one.
  useAssistantToolUI({
    toolName: "record_decision_plan",
    render: DecisionPlanRender,
  });

  // ── Stage 6: Run Summary → RunSummaryCard ────────────────────────────
  // Pure data recap. No synthesis text — that lives in the decision plan.
  // Just the ranked picks table and the exposure breakdown.
  useAssistantToolUI({
    toolName: "record_run_summary",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-3 inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
            <HugeiconsIcon icon={MessageSearch01Icon} className="size-3.5 shrink-0" />
            <span>Summarizing run…</span>
          </div>
        );
      }
      const exposure = result.exposureBreakdown as
        | { longExposure?: number; shortExposure?: number; netExposure?: number }
        | undefined;
      const invested =
        (exposure?.longExposure ?? 0) + (exposure?.shortExposure ?? 0);
      return (
        <div className="my-3 space-y-1">
          <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <HugeiconsIcon icon={MessageSearch01Icon} className="size-3.5 shrink-0" />
            <span>Summarizing run</span>
            {invested > 0 && (
              <>
                <span>—</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="tabular-nums cursor-default">
                        ${invested.toLocaleString()} invested
                      </span>
                    }
                  />
                  <TooltipContent>
                    Long ${(exposure?.longExposure ?? 0).toLocaleString()} ·
                    Short ${(exposure?.shortExposure ?? 0).toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
          <DecisionSummaryCard
            rankedPicks={
              (result.rankedPicks ?? []) as {
                rank: number;
                ticker: string;
                direction: string;
                confidence: number;
                reasoning: string;
                action: string;
              }[]
            }
          />
        </div>
      );
    },
  });

  // ── Stage 7: Complete Run ───────────────────────────────────────────
  // ONE CoT row. Header is "Completing run". Body shows the briefing status
  // as REAL debug data sourced directly from complete_run's return value
  // (which comes from the live updateAnalystBriefing call inside the tool's
  // execute function — see lib/agent/tools.ts complete_run, untouched from
  // PR #132). The briefing line shows the status verbatim (success / failed
  // / skipped) and the actual error string if anything went wrong, so this
  // is genuinely useful for debugging — not flowery hardcoded text.
  // Default-open only when briefing failed so the failure is visible at a
  // glance; otherwise the row is collapsed to keep the run thread tidy.
  const completeRunRender = ({ result }: { result?: Record<string, unknown> }) => {
    if (!result) {
      return (
        <ToolProgress defaultOpen>
          <ToolProgressHeader loading>Completing run…</ToolProgressHeader>
        </ToolProgress>
      );
    }
    const briefingStatus = result.briefing as
      | "success"
      | "failed"
      | "skipped"
      | undefined;
    const briefingError = result.briefingError as string | null | undefined;

    // Build the debug line. Real data only — status from the verified
    // briefing block, error from the actual thrown exception if any.
    let briefingLine: string | null = null;
    if (briefingStatus === "success") {
      briefingLine = "Briefing: written and verified";
    } else if (briefingStatus === "failed") {
      briefingLine = `Briefing: failed${briefingError ? ` — ${briefingError}` : ""}`;
    } else if (briefingStatus === "skipped") {
      briefingLine = `Briefing: skipped${briefingError ? ` — ${briefingError}` : ""}`;
    }

    return (
      <ToolProgress defaultOpen={briefingStatus === "failed"}>
        <ToolProgressHeader>Completing run</ToolProgressHeader>
        {briefingLine && (
          <ToolProgressContent>
            <ToolProgressItem>{briefingLine}</ToolProgressItem>
          </ToolProgressContent>
        )}
      </ToolProgress>
    );
  };
  useAssistantToolUI({ toolName: "complete_run", render: completeRunRender });
  useAssistantToolUI({ toolName: "summarize_run", render: completeRunRender });

  // ── Watchlist management — outcome merged into the Decision CoT ───
  useAssistantToolUI({ toolName: "manage_watchlist", render: () => null });
}

// ─── Builder tools ──────────────────────────────────────────────────────────

export function useRegisterBuilderToolUIs() {
  useRegisterResearchToolUIs();
  useAssistantToolUI({ toolName: "suggest_config", render: SuggestConfigRender });
}
