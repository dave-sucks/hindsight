"use client";

/**
 * The stock page's tabs when no thesis is live on the stock — Overview ·
 * Financials · Activity · News — with the sidebar beside every tab's content,
 * as on the trade page. With a live thesis the page renders the thesis's own
 * body instead (ThesisPageBody), with these two tabs after its own. Owns the
 * open tab so Overview's "View all" can switch to Activity.
 */

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StockOverview, type StockOverviewProps } from "@/components/stocks/StockOverview";
import { StockHistory } from "@/components/stocks/StockHistory";
import type { StockHistoryItem } from "@/lib/stocks/stock-history";

const OVERVIEW = 0;
const FINANCIALS = 1;
const ACTIVITY = 2;
const NEWS = 3;

export function StockPageTabs({
  overview,
  stats,
  history,
  financials,
  news,
  sidebar,
}: {
  overview: StockOverviewProps;
  /** The key stats under the chart. */
  stats: ReactNode;
  history: StockHistoryItem[];
  financials: ReactNode;
  news: ReactNode;
  sidebar: ReactNode;
}) {
  const [tab, setTab] = useState<number>(OVERVIEW);
  const columns = "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]";
  const side = <div className="hidden lg:block space-y-4">{sidebar}</div>;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as number)}>
      <TabsList>
        <TabsTrigger value={OVERVIEW}>Overview</TabsTrigger>
        <TabsTrigger value={FINANCIALS}>Financials</TabsTrigger>
        <TabsTrigger value={ACTIVITY}>Activity</TabsTrigger>
        <TabsTrigger value={NEWS}>News</TabsTrigger>
      </TabsList>

      <TabsContent value={OVERVIEW} className="space-y-5">
        <StockOverview {...overview} sidebar={sidebar}>
          {stats}
          <StockHistory ticker={overview.ticker} items={history} limit={5} onViewAll={() => setTab(ACTIVITY)} />
        </StockOverview>
      </TabsContent>

      <TabsContent value={FINANCIALS} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">{financials}</div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={ACTIVITY} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">
            <StockHistory ticker={overview.ticker} items={history} />
          </div>
          {side}
        </div>
      </TabsContent>

      <TabsContent value={NEWS} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">{news}</div>
          {side}
        </div>
      </TabsContent>
    </Tabs>
  );
}
