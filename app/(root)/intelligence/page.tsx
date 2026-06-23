"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Layers,
  ScanSearch,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { SignalFeed } from "@/components/intelligence/signal-feed";
import { MonitorList } from "@/components/intelligence/config-panel";
import { HealthTab } from "@/components/intelligence/health-tab";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import {
  IntelligenceShowcaseTrigger,
  IntelligenceShowcaseButton,
} from "@/components/domain/run-showcase-trigger";
import type {
  Signal,
  Monitor,
} from "@/components/intelligence/types";
import type { HealthData } from "@/app/api/intelligence/health/route";

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
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("findings");

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
      toast.success(`Triggered: ${label}`, {
        description: "Refresh in a few seconds to see results.",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Trigger failed");
    } finally {
      setTriggering(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sig, mon] = await Promise.all([
        fetchJSON<Signal[]>("/api/intelligence/signals?limit=200").catch(
          () => []
        ),
        fetchJSON<Monitor[]>("/api/intelligence/monitors").catch(() => []),
      ]);
      setSignals(sig);
      setMonitors(mon);
    } catch (err) {
      console.error("[intelligence] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await fetchJSON<HealthData>("/api/intelligence/health");
      setHealth(data);
    } catch (err) {
      console.error("[intelligence] Failed to load health:", err);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Lazy-load health data only when the tab is first opened
  useEffect(() => {
    if (activeTab === "health" && !health && !healthLoading) {
      loadHealth();
    }
  }, [activeTab, health, healthLoading, loadHealth]);

  const handleRefresh = useCallback(() => {
    loadAll();
    if (activeTab === "health") loadHealth();
  }, [loadAll, loadHealth, activeTab]);

  return (
    <TooltipProvider>
      <IntelligenceShowcaseTrigger />
      <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
        <Tabs
          defaultValue="findings"
          value={activeTab}
          onValueChange={setActiveTab}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="self-start">
              <TabsTrigger value="findings">Findings</TabsTrigger>
              <TabsTrigger value="monitors">Monitors</TabsTrigger>
              <TabsTrigger value="health">Health</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1.5">
              <IntelligenceShowcaseButton />
              <HowItWorksSheet flow="intelligence">
                <ScanSearch className="h-4 w-4" />
              </HowItWorksSheet>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
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
                      <span className="hidden sm:inline">Start Pipeline</span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => triggerJob("full-pipeline", "Full Pipeline")}
                  >
                    <Layers className="h-4 w-4" />
                    <span className="whitespace-nowrap">Run Full Pipeline</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => triggerJob("market-sweep", "Market Sweep")}
                  >
                    <Search className="h-4 w-4" />
                    <span className="whitespace-nowrap">Market Sweep</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      triggerJob("portfolio-monitor", "Portfolio Monitor")
                    }
                  >
                    <Radar className="h-4 w-4" />
                    <span className="whitespace-nowrap">
                      Portfolio &amp; Watchlist
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      triggerJob("domain-monitor", "Source Monitor")
                    }
                  >
                    <Globe className="h-4 w-4" />
                    <span className="whitespace-nowrap">Domain Sources</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      triggerJob("signal-router", "Signal Router")
                    }
                  >
                    <GitBranch className="h-4 w-4" />
                    <span className="whitespace-nowrap">Route Signals</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleRefresh}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="whitespace-nowrap">Refresh</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Findings tab */}
          <TabsContent value="findings" className="space-y-6 pt-4" keepMounted>
            <SignalFeed signals={signals} />
          </TabsContent>

          {/* Monitors tab */}
          <TabsContent value="monitors" className="pt-4">
            <MonitorList monitors={monitors} onRefresh={loadAll} />
          </TabsContent>

          {/* Health tab */}
          <TabsContent value="health" className="pt-4">
            <HealthTab data={health} loading={healthLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
