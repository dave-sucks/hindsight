"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ThesisCard, type ThesisCardProfile } from "@/components/ThesisCard";

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
  profiles?: Record<string, ThesisCardProfile>;
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
              thesis={{ ...thesis, createdAt: thesis.createdAt.toISOString() }}
              profile={profiles[thesis.ticker]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
