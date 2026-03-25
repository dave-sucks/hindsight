"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { SignalFeed } from "@/components/intelligence/signal-feed";
import { BriefCards } from "@/components/intelligence/brief-cards";
import { PipelineLog } from "@/components/intelligence/pipeline-log";
import { ConfigPanel } from "@/components/intelligence/config-panel";
import type {
  IntelligenceQuery,
  Source,
  SourcePack,
  Signal,
  SignalBatch,
  MorningBrief,
  AnalystRouteInfo,
} from "@/components/intelligence/types";

// ── Fetch helper ────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [queries, setQueries] = useState<IntelligenceQuery[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [packs, setPacks] = useState<SourcePack[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [batches, setBatches] = useState<SignalBatch[]>([]);
  const [briefs, setBriefs] = useState<MorningBrief[]>([]);
  const [routes, setRoutes] = useState<AnalystRouteInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [q, s, p, sig, b, br, rt] = await Promise.all([
        fetchJSON<IntelligenceQuery[]>("/api/intelligence/queries").catch(() => []),
        fetchJSON<Source[]>("/api/intelligence/sources").catch(() => []),
        fetchJSON<SourcePack[]>("/api/intelligence/source-packs").catch(() => []),
        fetchJSON<Signal[]>("/api/intelligence/signals?limit=200").catch(() => []),
        fetchJSON<SignalBatch[]>("/api/intelligence/batches?limit=30").catch(() => []),
        fetchJSON<MorningBrief[]>("/api/intelligence/briefs").catch(() => []),
        fetchJSON<AnalystRouteInfo[]>("/api/intelligence/routes").catch(() => []),
      ]);
      setQueries(q);
      setSources(s);
      setPacks(p);
      setSignals(sig);
      setBatches(b);
      setBriefs(br);
      setRoutes(rt);
    } catch (err) {
      console.error("[intelligence] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Stats ──────────────────────────────────────────────────────────────

  const todaySignals = signals.filter((s) => {
    const d = new Date(s.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  const breakingHigh = todaySignals.filter(
    (s) => s.urgency === "BREAKING" || s.urgency === "HIGH"
  ).length;
  const bullish = todaySignals.filter((s) => s.sentiment === "BULLISH").length;
  const bearish = todaySignals.filter((s) => s.sentiment === "BEARISH").length;
  const tickers = new Set(todaySignals.flatMap((s) => s.tickers)).size;
  const todayJobs = batches.filter((b) => {
    const d = new Date(b.startedAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <TooltipProvider>
      <div className="p-6 space-y-4">
        {/* Top bar: empty left | tabs center | refresh right */}
        <Tabs defaultValue="signals">
          <div className="grid grid-cols-3 items-center">
            <div />
            <TabsList className="mx-auto">
              <TabsTrigger value="signals">
                Signals
                {todaySignals.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5">
                    {todaySignals.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="config">
                Config
                <Badge variant="secondary" className="ml-1.5">
                  {queries.length + sources.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Signals tab */}
          <TabsContent value="signals" className="space-y-6 pt-4" keepMounted>
            {/* Stats strip inside signals tab */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <StatCard label="Today's Signals" value={todaySignals.length} />
              <StatCard
                label="Breaking / High"
                value={breakingHigh}
                variant={breakingHigh > 0 ? "alert" : "default"}
              />
              <StatCard
                label="Bullish"
                value={bullish}
                variant={bullish > 0 ? "positive" : "default"}
              />
              <StatCard
                label="Bearish"
                value={bearish}
                variant={bearish > 0 ? "negative" : "default"}
              />
              <StatCard label="Tickers" value={tickers} />
              <StatCard label="Jobs Today" value={todayJobs} />
            </div>

            <Separator />

            {/* Briefs at top */}
            <BriefCards briefs={briefs} />

            {briefs.length > 0 && <Separator />}

            {/* Signal feed */}
            <SignalFeed signals={signals} routes={routes} />
          </TabsContent>

          {/* Pipeline tab */}
          <TabsContent value="pipeline" className="pt-4">
            <PipelineLog
              batches={batches}
              routes={routes}
              onRefresh={loadAll}
            />
          </TabsContent>

          {/* Config tab */}
          <TabsContent value="config" className="pt-4">
            <ConfigPanel
              queries={queries}
              sources={sources}
              packs={packs}
              onRefresh={loadAll}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "positive" | "negative" | "alert";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          variant === "positive" && "text-emerald-500",
          variant === "negative" && "text-red-500",
          variant === "alert" && value > 0 && "text-amber-500"
        )}
      >
        {value}
      </p>
    </Card>
  );
}
