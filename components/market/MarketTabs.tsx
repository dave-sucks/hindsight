"use client";

/**
 * The Market page's four tabs: Earnings, Filings, Movers, Signals.
 *
 * One page instead of four routes. Each tab is the surface that already
 * existed — the earnings calendar (in either of its two views), the movers
 * table, the signal feed — mounted here rather than on its own page.
 *
 * Two things the tabs do deliberately:
 *   • Earnings and Filings share ONE calendar instance. They are the same
 *     week, the same day strip and the same fetch; only the list changes.
 *     Two instances would refetch the week every time you switched.
 *   • Signals load the first time that tab is opened, not on page load.
 *     The feed is a 200-row read of a retired pipeline; nobody should pay
 *     for it to look at today's movers.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EarningsCalendar } from "@/components/earnings/EarningsCalendar";
import { MoversTable } from "@/components/movers/MoversTable";
import { SignalFeed } from "@/components/intelligence/signal-feed";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import type { Signal } from "@/components/intelligence/types";
import type { MoverKind } from "@/lib/market-data/movers";

export type MarketTab = "earnings" | "filings" | "movers" | "signals";

export const MARKET_TABS: Array<{ value: MarketTab; label: string; blurb: string }> = [
  { value: "earnings", label: "Earnings", blurb: "Who reports this week, and how it went. Your names first." },
  { value: "filings", label: "Filings", blurb: "This week's SEC filings for the names you follow." },
  { value: "movers", label: "Movers", blurb: "Today's biggest gainers, losers and most-traded stocks." },
  { value: "signals", label: "Signals", blurb: "What the retired monitors found. Read-only." },
];

export function MarketTabs({
  analysts,
  initialTab,
  initialDate,
  initialKind,
}: {
  analysts: Array<{ id: string; name: string }>;
  initialTab: MarketTab;
  initialDate: string;
  initialKind: MoverKind;
}) {
  const [tab, setTab] = useState<MarketTab>(initialTab);
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(false);

  const loadSignals = useCallback(() => {
    setSignalsLoading(true);
    fetch("/api/intelligence/signals?limit=200")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Signal[]) => setSignals(rows))
      .catch(() => setSignals([]))
      .finally(() => setSignalsLoading(false));
  }, []);

  // First open of the Signals tab pays for the feed; the others never do.
  useEffect(() => {
    if (tab === "signals" && signals === null && !signalsLoading) loadSignals();
  }, [tab, signals, signalsLoading, loadSignals]);

  // Keep the URL honest so a tab can be linked to, without a router push:
  // the tabs are already mounted, and a replace() would re-run the server
  // page (and its analyst query) on every click.
  function select(next: MarketTab) {
    setTab(next);
    window.history.replaceState(null, "", `/market?tab=${next}`);
  }

  const blurb = MARKET_TABS.find((t) => t.value === tab)?.blurb ?? "";
  const isCalendar = tab === "earnings" || tab === "filings";

  return (
    <TooltipProvider>
      <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-3">
        <div className="mb-4 space-y-1">
          <h1 className="text-2xl font-semibold">Market</h1>
          <p className="text-sm text-muted-foreground">{blurb}</p>
        </div>

        <Tabs value={tab} onValueChange={(v) => select(v as MarketTab)}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="self-start">
              {MARKET_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tab === "signals" ? (
              <div className="flex items-center gap-1.5">
                <HowItWorksSheet flow="intelligence">
                  <ScanSearch className="h-4 w-4" />
                </HowItWorksSheet>
                <Button variant="outline" size="sm" onClick={loadSignals} disabled={signalsLoading}>
                  {signalsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            ) : null}
          </div>
        </Tabs>

        <div className="pt-4">
          {/* One calendar across both of its views — see the note at the top. */}
          <div hidden={!isCalendar}>
            <EarningsCalendar
              analysts={analysts}
              initialDate={initialDate}
              mode={isCalendar ? tab : "earnings"}
            />
          </div>
          {tab === "movers" ? <MoversTable analysts={analysts} initialKind={initialKind} /> : null}
          {tab === "signals" ? <SignalFeed signals={signals ?? []} /> : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
