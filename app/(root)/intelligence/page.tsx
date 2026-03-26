"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  const todaySignals = useMemo(() => {
    const now = new Date().toDateString();
    return signals.filter((s) => new Date(s.createdAt).toDateString() === now);
  }, [signals]);

  const stats = useMemo(() => {
    const breakingHigh = todaySignals.filter(
      (s) => s.urgency === "BREAKING" || s.urgency === "HIGH"
    ).length;
    const tickers = new Set(todaySignals.flatMap((s) => s.tickers)).size;
    const todayJobs = batches.filter(
      (b) => new Date(b.startedAt).toDateString() === new Date().toDateString()
    ).length;
    return { breakingHigh, tickers, todayJobs };
  }, [todaySignals, batches]);

  return (
    <div className="p-6 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            {todaySignals.length > 0 ? (
              <>
                <span className="tabular-nums">{todaySignals.length}</span> signals today
                {stats.breakingHigh > 0 && (
                  <> · <span className="text-amber-500 tabular-nums">{stats.breakingHigh}</span> high priority</>
                )}
                {stats.tickers > 0 && (
                  <> · <span className="tabular-nums">{stats.tickers}</span> tickers</>
                )}
                {stats.todayJobs > 0 && (
                  <> · <span className="tabular-nums">{stats.todayJobs}</span> jobs ran</>
                )}
              </>
            ) : (
              "No signals today yet"
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="signals">
        <TabsList>
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

        {/* Signals tab */}
        <TabsContent value="signals" className="space-y-6 pt-4" keepMounted>
          {/* Briefs at top */}
          <BriefCards briefs={briefs} />

          {briefs.length > 0 && <Separator />}

          {/* Signal feed */}
          <SignalFeed signals={signals} />
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
  );
}
