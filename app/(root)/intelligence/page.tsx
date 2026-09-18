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
import { RefreshCw, Loader2, ScanSearch } from "lucide-react";

import { SignalFeed } from "@/components/intelligence/signal-feed";
import { HealthTab } from "@/components/intelligence/health-tab";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import {
  IntelligenceShowcaseTrigger,
  IntelligenceShowcaseButton,
} from "@/components/domain/run-showcase-trigger";
import type { Signal } from "@/components/intelligence/types";
import type { HealthData } from "@/app/api/intelligence/health/route";

// ── Fetch helper ────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ── Page ────────────────────────────────────────────────────────────────────
//
// Read-only since 2026-09-15. The jobs that produced these signals, the
// router that assigned them and the monitor editor are deleted; the rows are
// kept, and this page is how they stay readable. No pipeline trigger, no
// monitor edits.

export default function IntelligencePage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("findings");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const sig = await fetchJSON<Signal[]>(
        "/api/intelligence/signals?limit=200",
      ).catch(() => []);
      setSignals(sig);
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
              <TabsTrigger value="health">Health</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1.5">
              <IntelligenceShowcaseButton />
              <HowItWorksSheet flow="intelligence">
                <ScanSearch className="h-4 w-4" />
              </HowItWorksSheet>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          {/* Findings tab */}
          <TabsContent value="findings" className="space-y-6 pt-4" keepMounted>
            <SignalFeed signals={signals} />
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
