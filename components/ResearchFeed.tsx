"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useCallback } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { TradeReviewSheet } from "@/components/TradeReviewSheet";

type Trade = {
  id: string;
  realizedPnl: number | null;
  status: string;
  entryPrice: number;
  closePrice: number | null;
};

type Thesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  holdDuration: string;
  signalTypes: string[];
  sector: string | null;
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  createdAt: Date;
  trade: Trade | null;
  researchRun: { source: string } | null;
};

type CompanyProfile = {
  name: string;
  logo: string;
  exchange: string;
};

const FILTERS = [
  { label: "All", params: {} },
  { label: "Long", params: { direction: "LONG" } },
  { label: "Short", params: { direction: "SHORT" } },
  { label: "High confidence", params: { confidence: "high" } },
  { label: "Traded", params: { status: "traded" } },
];

export default function ResearchFeed({
  theses,
  profiles = {},
}: {
  theses: Thesis[];
  profiles?: Record<string, CompanyProfile>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const applyFilter = useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => sp.set(k, v));
      router.push(`${pathname}?${sp.toString()}`);
    },
    [router, pathname]
  );

  const activeKey = searchParams.toString();

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const key = new URLSearchParams(
            f.params as Record<string, string>
          ).toString();
          const active = key === activeKey;
          return (
            <button
              key={f.label}
              onClick={() => applyFilter(f.params as Record<string, string>)}
              className={`text-xs font-medium uppercase tracking-wide px-3 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {theses.length === 0 && (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No theses yet. Use Research Chat to generate your first trade idea.
          </p>
        </div>
      )}

      {/* Thesis cards — 2-col grid on sm+ */}
      {theses.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {theses.map((thesis) => (
            <ThesisCard
              key={thesis.id}
              thesis={thesis}
              profile={profiles[thesis.ticker]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThesisCard({
  thesis,
  profile,
}: {
  thesis: Thesis;
  profile?: CompanyProfile;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";
  const isPass = thesis.direction === "PASS";

  const dirClass = isLong
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : isShort
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : "bg-muted text-muted-foreground";

  const trade = thesis.trade;
  const pnl = trade?.realizedPnl ?? null;
  const pnlColor =
    pnl != null ? (pnl >= 0 ? "text-emerald-500" : "text-red-500") : "";
  const alreadyTraded = trade !== null;

  const tradeStatusClass =
    trade?.status === "OPEN"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : trade?.status === "WIN"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : trade?.status === "LOSS"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "";

  const confidenceClass =
    thesis.confidenceScore >= 70
      ? "text-emerald-500"
      : thesis.confidenceScore >= 50
        ? "text-amber-500"
        : "text-red-500";

  const companyName =
    profile?.name && profile.name !== thesis.ticker ? profile.name : null;
  const exchange = profile?.exchange ?? null;
  const logoUrl = profile?.logo && !imgError ? profile.logo : null;

  const subtitle = [companyName, exchange].filter(Boolean).join(" · ");

  const dateStr = new Date(thesis.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const statCols = [
    { label: "Entry", value: thesis.entryPrice, color: "text-foreground" },
    { label: "Target", value: thesis.targetPrice, color: "text-emerald-500" },
    { label: "Stop", value: thesis.stopLoss, color: "text-red-500" },
  ] as const;

  return (
    <>
      <div className="rounded-lg border bg-card flex flex-col hover:border-foreground/25 transition-colors">
        {/* ── Body ─────────────────────────────────────── */}
        <div className="p-4 flex-1 space-y-3">
          {/* Logo + ticker + badges */}
          <div className="flex items-start gap-3">
            {/* Logo / fallback */}
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={thesis.ticker}
                onError={() => setImgError(true)}
                className="h-10 w-10 rounded-md object-contain bg-muted shrink-0 border border-border"
              />
            ) : (
              <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 border border-border">
                {thesis.ticker.slice(0, 2)}
              </div>
            )}

            <div className="flex-1 min-w-0">
              {/* Ticker + badges row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Link
                  href={`/research/${thesis.id}`}
                  className="font-semibold text-foreground hover:underline leading-tight"
                >
                  {thesis.ticker}
                </Link>

                {thesis.researchRun?.source === "AGENT" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-violet-500/10 text-violet-600 dark:text-violet-400 uppercase tracking-wide leading-none">
                    AI
                  </span>
                )}

                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${dirClass}`}
                  >
                    {thesis.direction}
                  </span>
                  {trade && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${tradeStatusClass}`}
                    >
                      {trade.status}
                    </span>
                  )}
                </span>
              </div>

              {/* Company name + date subtitle */}
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight truncate">
                {[subtitle, dateStr].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {/* Reasoning summary */}
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {thesis.reasoningSummary}
          </p>
        </div>

        {/* ── Price stats bar ───────────────────────────── */}
        <div className="border-t px-4 py-2.5 grid grid-cols-4 gap-3 bg-muted/20">
          {statCols.map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
                {label}
              </p>
              <p
                className={`text-xs font-semibold tabular-nums mt-1 ${color}`}
              >
                {value != null ? `$${value.toFixed(2)}` : "—"}
              </p>
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
              Conf.
            </p>
            <p
              className={`text-xs font-semibold tabular-nums mt-1 ${confidenceClass}`}
            >
              {thesis.confidenceScore}%
            </p>
          </div>
        </div>

        {/* ── Footer: P&L + action ──────────────────────── */}
        <div className="border-t px-4 py-2 flex items-center justify-between">
          <div>
            {pnl != null ? (
              <span
                className={`text-xs font-semibold tabular-nums ${pnlColor}`}
              >
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} P&L
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {thesis.holdDuration}
              </span>
            )}
          </div>

          {!alreadyTraded && !isPass ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => setSheetOpen(true)}
            >
              {isLong ? (
                <TrendingUp className="h-3 w-3 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              Place Trade
            </Button>
          ) : alreadyTraded && trade ? (
            <Link href={`/trades/${trade.id}`}>
              <Button size="sm" variant="ghost" className="h-7 text-xs">
                View Trade →
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <TradeReviewSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis={{
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          entryPrice: thesis.entryPrice,
          targetPrice: thesis.targetPrice,
          stopLoss: thesis.stopLoss,
          confidenceScore: thesis.confidenceScore,
          holdDuration: thesis.holdDuration,
        }}
      />
    </>
  );
}
