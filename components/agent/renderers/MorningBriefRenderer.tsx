"use client";

/**
 * MorningBriefRenderer — ui: "morning-brief"
 *
 * Shows all sections of the pre-generated morning brief:
 * market context, portfolio alerts, watchlist updates, opportunities, risk flags.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import {
  ToolProgress,
  ToolProgressHeader,
  ToolProgressContent,
  ToolProgressTickerItem,
  ToolProgressItem,
} from "@/components/ai-elements/tool-progress";
import { Badge } from "@/components/ui/badge";
import { extractToolSources, SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import { AlertTriangleIcon, NewspaperIcon } from "lucide-react";

interface PortfolioAlert {
  ticker: string;
  alert: string;
  urgency: string;
}

interface WatchlistUpdate {
  ticker: string;
  update: string;
  recommendation: string;
}

interface NewOpportunity {
  headline: string;
  tickers: string[];
  thesisSeed: string;
}

interface BriefData {
  available?: boolean;
  date?: string;
  marketContext?: string;
  attentionPriority?: string[];
  riskFlags?: string[];
  signalCount?: number;
  portfolioAlerts?: PortfolioAlert[];
  watchlistUpdates?: WatchlistUpdate[];
  newOpportunities?: NewOpportunity[];
}

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function MorningBriefRenderer({ result, loading }: Props) {
  const data = (result.data as BriefData) ?? {};
  const rawResult = { ...data, _sources: result.sources };
  const sources = loading ? [] : extractToolSources(rawResult as Record<string, unknown>);

  const alerts = data.portfolioAlerts ?? [];
  const updates = data.watchlistUpdates ?? [];
  const opps = data.newOpportunities ?? [];
  const riskFlags = data.riskFlags ?? [];
  const signalCount = data.signalCount ?? 0;
  const date = data.date ?? "";

  // Build header label
  const parts: string[] = ["Morning brief"];
  if (date) parts.push(date);
  if (signalCount > 0) parts.push(`${signalCount} signals`);
  const label = parts.join(" · ");

  if (!data.available) {
    return (
      <ToolProgress defaultOpen={loading}>
        <ToolProgressHeader loading={loading} icon={NewspaperIcon}>
          {label}
        </ToolProgressHeader>
        <ToolProgressContent>
          <ToolProgressItem>{result.summary}</ToolProgressItem>
        </ToolProgressContent>
      </ToolProgress>
    );
  }

  return (
    <ToolProgress defaultOpen={loading}>
      <ToolProgressHeader loading={loading} icon={NewspaperIcon}>
        {label}
      </ToolProgressHeader>
      <ToolProgressContent>
        {/* Market context */}
        {data.marketContext && (
          <ToolProgressItem active={false}>
            {data.marketContext}
          </ToolProgressItem>
        )}

        {/* Attention tickers */}
        {data.attentionPriority && data.attentionPriority.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-6">
            <span className="text-xs text-muted-foreground mr-1">Focus:</span>
            {data.attentionPriority.map((t) => (
              <Badge key={t} variant="outline" className="text-xs font-mono">
                ${t}
              </Badge>
            ))}
          </div>
        )}

        {/* Risk flags */}
        {riskFlags.length > 0 && (
          <div className="flex flex-col gap-1 pl-6">
            {riskFlags.map((flag, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-amber-500/90">
                <AlertTriangleIcon className="size-3 shrink-0 mt-0.5" />
                <span>{flag}</span>
              </div>
            ))}
          </div>
        )}

        {/* Portfolio alerts */}
        {alerts.map((a, i) => (
          <ToolProgressTickerItem key={i} ticker={a.ticker} tag="Alert">
            {a.alert}
            {a.urgency && a.urgency !== "NORMAL" && (
              <Badge
                variant="outline"
                className="ml-1.5 text-[10px] border-amber-500/40 text-amber-500"
              >
                {a.urgency}
              </Badge>
            )}
          </ToolProgressTickerItem>
        ))}

        {/* Watchlist updates */}
        {updates.map((w, i) => (
          <ToolProgressTickerItem key={i} ticker={w.ticker} tag="Watchlist">
            {w.update}
            {w.recommendation && w.recommendation !== "HOLD" && (
              <span className="ml-1 text-xs text-muted-foreground">→ {w.recommendation}</span>
            )}
          </ToolProgressTickerItem>
        ))}

        {/* New opportunities */}
        {opps.map((o, i) => {
          const primaryTicker = o.tickers?.[0];
          return primaryTicker ? (
            <ToolProgressTickerItem key={i} ticker={primaryTicker} tag="Opportunity">
              {o.thesisSeed || o.headline}
            </ToolProgressTickerItem>
          ) : (
            <ToolProgressItem key={i}>
              <span className="text-xs text-muted-foreground mr-1">Opportunity:</span>
              {o.thesisSeed || o.headline}
            </ToolProgressItem>
          );
        })}

        {/* Empty state */}
        {alerts.length === 0 && updates.length === 0 && opps.length === 0 && (
          <ToolProgressItem>{result.summary}</ToolProgressItem>
        )}

        <SourceChips sources={sources} />
      </ToolProgressContent>
    </ToolProgress>
  );
}
