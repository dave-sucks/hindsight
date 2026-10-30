"use client";

/**
 * The stock page with a live thesis: the thesis body the trade page and the
 * sheet render — price, chart with its levels, triggers, the latest note,
 * the research, the timeline — hosting the stock's own content in its
 * slots. The history of every thesis and trade on the stock sits under
 * Overview (the newest few) and Activity (all of it); the financials and
 * filings under Research; News is its own tab. Overview's "View all" opens
 * the body's Activity tab.
 */

import type { ReactNode } from "react";
import {
  ThesisBody,
  ThesisBodySkeleton,
  THESIS_BODY_TABS,
  useThesisSheetData,
} from "@/components/agent/sheets/ThesisSheet";
import { StockHistory } from "@/components/stocks/StockHistory";
import type { StockHistoryItem } from "@/lib/stocks/stock-history";

export function StockThesisBody({
  thesisId,
  positionId,
  ticker,
  history,
  research,
  news,
  aside,
}: {
  thesisId: string;
  /** The open position, so the body pins its trade card to it. */
  positionId?: string;
  ticker: string;
  history: StockHistoryItem[];
  research: ReactNode;
  news: ReactNode;
  /** The stock's own sidebar card(s), between the trade card and the stock cards. */
  aside?: ReactNode;
}) {
  const data = useThesisSheetData(thesisId, ticker, positionId);
  const state = data.state;

  if (!data.loaded || !state) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {!data.loaded ? (
            <ThesisBodySkeleton />
          ) : (
            <p className="py-8 text-sm text-muted-foreground">Couldn&apos;t load this thesis. Reload to retry.</p>
          )}
        </div>
        {aside ? <div className="hidden lg:block space-y-4">{aside}</div> : null}
      </div>
    );
  }

  const label = (text: string) => (
    <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">{text}</p>
  );

  return (
    <ThesisBody
      data={{ ...data, state }}
      thesis_id={thesisId}
      ticker={ticker}
      surface="page"
      aside={aside}
      slots={({ show }) => ({
        overview: (
          <div className="space-y-2">
            {label(`Hindsight on ${ticker}`)}
            <StockHistory
              ticker={ticker}
              items={history}
              limit={5}
              onViewAll={() => show(THESIS_BODY_TABS.activity)}
            />
          </div>
        ),
        research,
        activity: (
          <div className="space-y-2">
            {label(`Every thesis and trade on ${ticker}`)}
            <StockHistory ticker={ticker} items={history} />
          </div>
        ),
        tabs: [{ label: "News", content: news }],
      })}
    />
  );
}
