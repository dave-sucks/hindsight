"use client";

/**
 * The stock page's tabs — Overview · Research · Activity · News — with the
 * sidebar beside every tab's content, as on the trade page. Owns the open
 * tab so Overview's "View all" can switch to Activity.
 */

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StockOverview, type StockOverviewProps } from "@/components/stocks/StockOverview";
import { StockHistory } from "@/components/stocks/StockHistory";
import type { StockHistoryItem } from "@/lib/stocks/stock-history";

const OVERVIEW = 0;
const RESEARCH = 1;
const ACTIVITY = 2;
const NEWS = 3;

export function StockPageTabs({
  overview,
  history,
  research,
  news,
  sidebar,
}: {
  overview: StockOverviewProps;
  history: StockHistoryItem[];
  research: ReactNode;
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
        <TabsTrigger value={RESEARCH}>Research</TabsTrigger>
        <TabsTrigger value={ACTIVITY}>Activity</TabsTrigger>
        <TabsTrigger value={NEWS}>News</TabsTrigger>
      </TabsList>

      <TabsContent value={OVERVIEW} className="space-y-5">
        <StockOverview {...overview} sidebar={sidebar}>
          <StockHistory ticker={overview.ticker} items={history} limit={5} onViewAll={() => setTab(ACTIVITY)} />
        </StockOverview>
      </TabsContent>

      <TabsContent value={RESEARCH} className="space-y-5">
        <div className={columns}>
          <div className="min-w-0 space-y-5">{research}</div>
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
