"use client";

/**
 * The Data tab: the company's numbers, live, in the place the research
 * essays used to be. Who the company is, the key stats and the financials
 * (lib/stocks/stock-stats, the stock page's own tables), the earnings
 * record, open-market insider buying and the SEC filings. Nothing here is
 * written by an analyst; everything refreshes when the tab opens. A read
 * that failed says so, which is not the same as "nothing".
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EarningsCard } from "@/components/domain/earnings-card";
import { StockFilingsSection } from "@/components/filings/StockFilingsSection";
import { StatBlock } from "@/components/stocks/StatGrid";
import { StatTable } from "@/components/stocks/StatTable";
import { insiderRows, insiderSummary } from "@/lib/stocks/insider-words";
import type { StockInsiderBuying } from "@/lib/market-data/stock-activity";
import type { EarningsResponse, StockProfileResponse } from "@/lib/types/thesis-sheet";

/** The section label every block on the tab uses. */
function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** Fetch one JSON resource once; `undefined` while in flight, `null` when it failed. */
function useJson<T>(url: string): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setValue(undefined);
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((json) => {
        if (!cancelled) setValue(json);
      })
      .catch(() => {
        if (!cancelled) setValue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return value;
}

function AboutRows({ about }: { about: StockProfileResponse["about"] }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Exchange", value: about.exchange ?? "—" },
    { label: "Industry", value: about.industry ?? "—" },
    { label: "IPO", value: about.ipo ?? "—" },
  ];
  if (about.website && about.url) {
    rows.push({
      label: "Website",
      value: (
        <a href={about.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
          {about.website}
          <ExternalLink className="h-3 w-3" />
        </a>
      ),
    });
  }
  return (
    <Card className="bg-muted/40 p-2 gap-1">
      <Label>About</Label>
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm border-b border-border pb-1 last:border-0">
          <span className="text-muted-foreground shrink-0">{label}</span>
          <span className="font-medium tabular-nums text-right min-w-0 truncate">{value}</span>
        </div>
      ))}
    </Card>
  );
}

function InsidersBlock({ data }: { data: StockInsiderBuying | null }) {
  const rows = insiderRows(data);
  return (
    <section className="space-y-2">
      <Label>Insiders</Label>
      <p className="text-sm text-foreground">{insiderSummary(data)}</p>
      {rows.length > 0 ? (
        <Card className="p-1 gap-1">
          {rows.map((r) => (
            <div key={`${r.date}-${r.name}-${r.text}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md p-2 text-sm">
              <span className="text-xs text-muted-foreground tabular-nums">
                {new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </span>
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="text-muted-foreground tabular-nums">{r.text}</span>
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}

export function ThesisDataTab({ ticker }: { ticker: string }) {
  const symbol = encodeURIComponent(ticker.toUpperCase());
  const profile = useJson<StockProfileResponse>(`/api/stocks/${symbol}/profile`);
  const earnings = useJson<EarningsResponse>(`/api/stocks/${symbol}/earnings`);
  const activity = useJson<{ insiders: StockInsiderBuying }>(`/api/stocks/${symbol}/activity`);

  return (
    <div className="space-y-6">
      {profile === undefined ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : profile === null ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t read the company&apos;s numbers for {ticker}.</p>
      ) : (
        <>
          <AboutRows about={profile.about} />
          <StatBlock label="Key stats" columns={profile.keyStats} />
          {profile.financials.length > 0 ? (
            <section className="space-y-1">
              <Label>Financials</Label>
              <StatTable sections={profile.financials} />
            </section>
          ) : null}
        </>
      )}

      {earnings === undefined ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : earnings ? (
        <EarningsCard data={earnings} />
      ) : (
        <p className="text-sm text-muted-foreground">Couldn&apos;t read the earnings record for {ticker}.</p>
      )}

      {activity === undefined ? <Skeleton className="h-16 w-full rounded-lg" /> : <InsidersBlock data={activity?.insiders ?? null} />}

      <section className="space-y-2">
        <Label>Filings</Label>
        <StockFilingsSection symbol={ticker.toUpperCase()} />
      </section>
    </div>
  );
}
