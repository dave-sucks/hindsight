"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
import {
  RefreshCw,
  Loader2,
  Play,
  Radar,
  Search,
  Globe,
  GitBranch,
  FileText,
  Layers,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { SignalFeed } from "@/components/intelligence/signal-feed";
import { MonitorList } from "@/components/intelligence/config-panel";
import { BriefCards } from "@/components/intelligence/brief-cards";
import type {
  Signal,
  MorningBrief,
  Monitor,
} from "@/components/intelligence/types";

// ── Fetch helper ────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [briefs, setBriefs] = useState<MorningBrief[]>([]);
  const [loading, setLoading] = useState(true);

  // Brief date selection
  const [briefDate, setBriefDate] = useState<"today" | "yesterday" | "week">(
    "today"
  );

  const [triggering, setTriggering] = useState<string | null>(null);

  const triggerJob = useCallback(async (job: string, label: string) => {
    setTriggering(job);
    try {
      const res = await fetch("/api/intelligence/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      toast.success(`Triggered: ${label}`, { description: "Refresh in a few seconds to see results." });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Trigger failed");
    } finally {
      setTriggering(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sig, mon, br] = await Promise.all([
        fetchJSON<Signal[]>("/api/intelligence/signals?limit=200").catch(
          () => []
        ),
        fetchJSON<Monitor[]>("/api/intelligence/monitors").catch(() => []),
        fetchJSON<MorningBrief[]>("/api/intelligence/briefs").catch(() => []),
      ]);
      setSignals(sig);
      setMonitors(mon);
      setBriefs(br);
    } catch (err) {
      console.error("[intelligence] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Load briefs when date changes
  const loadBriefs = useCallback(async () => {
    try {
      const dateParam = getBriefDateParam(briefDate);
      const br = await fetchJSON<MorningBrief[]>(
        `/api/intelligence/briefs${dateParam ? `?date=${dateParam}` : ""}`
      );
      setBriefs(br);
    } catch {
      console.error("[intelligence] Failed to load briefs");
    }
  }, [briefDate]);

  useEffect(() => {
    loadBriefs();
  }, [loadBriefs]);

  // ── Stats ────────────────────────────────────────────────────────────────

  const todaySignals = useMemo(() => {
    const now = new Date().toDateString();
    return signals.filter(
      (s) => new Date(s.createdAt).toDateString() === now
    );
  }, [signals]);

  const stats = useMemo(() => {
    const breakingHigh = todaySignals.filter(
      (s) => s.urgency === "BREAKING" || s.urgency === "HIGH"
    ).length;
    const bullish = todaySignals.filter(
      (s) => s.sentiment === "BULLISH"
    ).length;
    const bearish = todaySignals.filter(
      (s) => s.sentiment === "BEARISH"
    ).length;
    const monitorsActive = monitors.filter((m) => m.enabled).length;
    return { breakingHigh, bullish, bearish, monitorsActive };
  }, [todaySignals, monitors]);

  return (
    <TooltipProvider>
      <div className="p-6 space-y-4">
        {/* Top bar: empty left | tabs center | refresh right */}
        <Tabs defaultValue="findings">
          <div className="grid grid-cols-3 items-center">
            <div />
            <TabsList className="mx-auto">
              <TabsTrigger value="findings">
                Findings
                {todaySignals.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5">
                    {todaySignals.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="monitors">
                Monitors
                <Badge variant="secondary" className="ml-1.5">
                  {monitors.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="briefs">Briefs</TabsTrigger>
            </TabsList>
            <div className="flex justify-end gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={triggering !== null}
                  >
                    {triggering ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Run Pipeline</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => triggerJob("full-pipeline", "Full Pipeline")}>
                    <Layers className="h-4 w-4" />
                    Run Full Pipeline
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Individual Steps</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => triggerJob("market-sweep", "Market Sweep")}>
                    <Search className="h-4 w-4" />
                    Market Sweep
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => triggerJob("portfolio-monitor", "Portfolio Monitor")}>
                    <Radar className="h-4 w-4" />
                    Portfolio &amp; Watchlist
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => triggerJob("source-pack-monitor", "Source Monitor")}>
                    <Globe className="h-4 w-4" />
                    Domain Sources
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => triggerJob("signal-router", "Signal Router")}>
                    <GitBranch className="h-4 w-4" />
                    Route Signals
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => triggerJob("morning-brief", "Morning Briefs")}>
                    <FileText className="h-4 w-4" />
                    Generate Briefs
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={loadAll}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Findings tab */}
          <TabsContent value="findings" className="space-y-6 pt-4" keepMounted>
            {/* Stats strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard
                label="Today's Findings"
                value={todaySignals.length}
              />
              <StatCard
                label="Breaking / High"
                value={stats.breakingHigh}
                variant={stats.breakingHigh > 0 ? "alert" : "default"}
              />
              <StatCard
                label="Bullish"
                value={stats.bullish}
                variant={stats.bullish > 0 ? "positive" : "default"}
              />
              <StatCard
                label="Bearish"
                value={stats.bearish}
                variant={stats.bearish > 0 ? "negative" : "default"}
              />
              <StatCard
                label="Monitors Active"
                value={stats.monitorsActive}
              />
            </div>

            <Separator />

            {/* Finding feed */}
            <SignalFeed signals={signals} />
          </TabsContent>

          {/* Monitors tab */}
          <TabsContent value="monitors" className="pt-4">
            <MonitorList monitors={monitors} onRefresh={loadAll} />
          </TabsContent>

          {/* Briefs tab */}
          <TabsContent value="briefs" className="pt-4 space-y-4">
            {/* Date selector */}
            <div className="flex items-center gap-2">
              <Button
                variant={briefDate === "today" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBriefDate("today")}
              >
                Today
              </Button>
              <Button
                variant={briefDate === "yesterday" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBriefDate("yesterday")}
              >
                Yesterday
              </Button>
              <Button
                variant={briefDate === "week" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBriefDate("week")}
              >
                This Week
              </Button>
            </div>

            <BriefCards briefs={briefs} />
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBriefDateParam(
  selection: "today" | "yesterday" | "week"
): string | null {
  const now = new Date();
  if (selection === "today") {
    return formatDateParam(now);
  }
  if (selection === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateParam(yesterday);
  }
  // "week" — return null to get all recent briefs
  return null;
}

function formatDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
