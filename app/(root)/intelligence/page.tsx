"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  Search,
  Globe,
  Package,
  Plus,
  Trash2,
  Play,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Zap,
  Activity,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  X,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  Eye,
  Layers,
  Database,
  FileText,
  Info,
  Router,
  Users,
} from "lucide-react"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntelligenceQuery {
  id: string
  query: string
  category: string
  scope: string
  analystId: string | null
  enabled: boolean
  createdBy: string
  expiresAt: string | null
  createdAt: string
}

interface Source {
  id: string
  name: string
  type: string
  url: string | null
  domain: string | null
  category: string
  qualityScore: number
  enabled: boolean
  lastCheckedAt: string | null
}

interface SourcePackSource {
  id: string
  priority: number
  source: Source
}

interface SourcePack {
  id: string
  name: string
  scope: string
  analystId: string | null
  sources: SourcePackSource[]
}

interface Signal {
  id: string
  type: string
  headline: string
  summary: string
  tickers: string[]
  themes: string[]
  sectors: string[]
  sentiment: string
  urgency: string
  freshness: string
  sourceUrls: string[]
  sourceNames: string[]
  sourceQuality: number
  noveltyScore: number | null
  artifactId: string | null
  createdAt: string
  batch: { jobType: string; status: string; startedAt: string } | null
}

interface SignalBatch {
  id: string
  jobType: string
  status: string
  signalCount: number
  startedAt: string
  completedAt: string | null
  _count: { signals: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return res.json() as Promise<T>
}

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SENTIMENT_CONF = {
  BULLISH: { icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Bullish" },
  BEARISH: { icon: TrendingDown, color: "text-red-500", bg: "bg-red-500/10", label: "Bearish" },
  NEUTRAL: { icon: Minus, color: "text-muted-foreground", bg: "bg-muted", label: "Neutral" },
  MIXED: { icon: Activity, color: "text-amber-500", bg: "bg-amber-500/10", label: "Mixed" },
} as Record<string, { icon: typeof TrendingUp; color: string; bg: string; label: string }>

const URGENCY_CONF = {
  BREAKING: { dot: "bg-red-500 animate-pulse", label: "Breaking", color: "text-red-500" },
  HIGH: { dot: "bg-amber-500", label: "High", color: "text-amber-500" },
  MEDIUM: { dot: "bg-blue-500", label: "Medium", color: "text-blue-500" },
  LOW: { dot: "bg-muted-foreground/40", label: "Low", color: "text-muted-foreground" },
} as Record<string, { dot: string; label: string; color: string }>

const JOB_LABELS: Record<string, string> = {
  MARKET_SWEEP: "Market Sweep",
  PORTFOLIO_MONITOR: "Portfolio Monitor",
  SOURCE_PACK: "Source Packs",
  EMAIL_INGEST: "Email Ingest",
  MANUAL: "Manual",
}

type SignalFilter = "ALL" | "BREAKING" | "BULLISH" | "BEARISH" | "NEWS" | "EARNINGS"
type SourceTypeFilter = "ALL" | "WEB" | "API"

interface MorningBrief {
  id: string
  analystId: string
  date: string
  marketContext: string
  portfolioAlerts: Array<{ ticker: string; alert: string; urgency: string; signalIds: string[] }>
  watchlistUpdates: Array<{ ticker: string; update: string; recommendation: string; signalIds: string[] }>
  newOpportunities: Array<{ headline: string; tickers: string[]; thesisSeed: string; signalIds: string[] }>
  attentionPriority: string[]
  riskFlags: string[]
  signalCount: number
  generatedAt: string
  analyst: { id: string; name: string }
}

interface AnalystRouteInfo {
  analystId: string
  analystName: string
  totalRoutes: number
  high: number
  medium: number
  low: number
  pending: number
  read: number
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [queries, setQueries] = useState<IntelligenceQuery[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [packs, setPacks] = useState<SourcePack[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [batches, setBatches] = useState<SignalBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [triggerStatus, setTriggerStatus] = useState<Record<string, "idle" | "running" | "done" | "error">>({})
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("ALL")
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("ALL")
  const [briefs, setBriefs] = useState<MorningBrief[]>([])
  const [routeInfo, setRouteInfo] = useState<AnalystRouteInfo[]>([])

  // Forms
  const [newQuery, setNewQuery] = useState("")
  const [newQueryCategory, setNewQueryCategory] = useState("MARKET")
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceDomain, setNewSourceDomain] = useState("")
  const [newSourceCategory, setNewSourceCategory] = useState("MARKET")

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const [q, s, p, sig, b, br, rt] = await Promise.all([
        fetchJSON<IntelligenceQuery[]>("/api/intelligence/queries"),
        fetchJSON<Source[]>("/api/intelligence/sources"),
        fetchJSON<SourcePack[]>("/api/intelligence/source-packs"),
        fetchJSON<Signal[]>("/api/intelligence/signals?limit=200"),
        fetchJSON<SignalBatch[]>("/api/intelligence/batches?limit=30"),
        fetchJSON<MorningBrief[]>("/api/intelligence/briefs").catch(() => [] as MorningBrief[]),
        fetchJSON<AnalystRouteInfo[]>("/api/intelligence/routes").catch(() => [] as AnalystRouteInfo[]),
      ])
      setQueries(q)
      setSources(s)
      setPacks(p)
      setSignals(sig)
      setBatches(b)
      setBriefs(br)
      setRouteInfo(rt)
    } catch (e) {
      console.error("Failed to load intelligence data", e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Computed ─────────────────────────────────────────────────────────────

  const filteredSignals = useMemo(() => {
    let result = signals
    // Source type filter
    if (sourceTypeFilter === "API") {
      result = result.filter((s) => s.sourceNames.some((n) => ["FMP", "Finnhub"].includes(n)))
    } else if (sourceTypeFilter === "WEB") {
      result = result.filter((s) => !s.sourceNames.some((n) => ["FMP", "Finnhub"].includes(n)))
    }
    // Existing filters
    if (signalFilter === "ALL") return result
    if (signalFilter === "BREAKING") return result.filter((s) => s.urgency === "BREAKING" || s.urgency === "HIGH")
    if (signalFilter === "BULLISH") return result.filter((s) => s.sentiment === "BULLISH")
    if (signalFilter === "BEARISH") return result.filter((s) => s.sentiment === "BEARISH")
    if (signalFilter === "NEWS") return result.filter((s) => s.type === "NEWS")
    if (signalFilter === "EARNINGS") return result.filter((s) => s.type === "EARNINGS" || s.type === "FILING")
    return result
  }, [signals, signalFilter, sourceTypeFilter])

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todaySignals = signals.filter((s) => s.createdAt.slice(0, 10) === today)
    const todayBatches = batches.filter((b) => b.startedAt.slice(0, 10) === today)
    const breaking = todaySignals.filter((s) => s.urgency === "BREAKING" || s.urgency === "HIGH").length
    const bullish = todaySignals.filter((s) => s.sentiment === "BULLISH").length
    const bearish = todaySignals.filter((s) => s.sentiment === "BEARISH").length
    const uniqueTickers = new Set(todaySignals.flatMap((s) => s.tickers))
    const lastRun = batches.length > 0 ? batches[0] : null
    const briefsGenerated = briefs.length
    const signalsRouted = routeInfo.reduce((sum, r) => sum + r.totalRoutes, 0)
    return { todaySignals: todaySignals.length, todayRuns: todayBatches.length, breaking, bullish, bearish, uniqueTickers: uniqueTickers.size, lastRun, briefsGenerated, signalsRouted }
  }, [signals, batches, briefs, routeInfo])

  // ── Actions ─────────────────────────────────────────────────────────────

  const toggleQuery = async (id: string, enabled: boolean) => {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, enabled } : q)))
    await fetch("/api/intelligence/queries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id], enabled }) })
  }

  const deleteQuery = async (id: string) => {
    setQueries((prev) => prev.filter((q) => q.id !== id))
    await fetch(`/api/intelligence/queries?id=${id}`, { method: "DELETE" })
  }

  const createQuery = async () => {
    if (!newQuery.trim()) return
    const res = await fetch("/api/intelligence/queries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: newQuery.trim(), category: newQueryCategory, scope: "FIRM", createdBy: "USER" }) })
    if (res.ok) { setNewQuery(""); loadData() }
  }

  const createSource = async () => {
    if (!newSourceName.trim() || !newSourceDomain.trim()) return
    const res = await fetch("/api/intelligence/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newSourceName.trim(), type: "DOMAIN", domain: newSourceDomain.trim().replace(/^https?:\/\//, "").replace(/^www\./, ""), category: newSourceCategory, qualityScore: 3 }) })
    if (res.ok) { setNewSourceName(""); setNewSourceDomain(""); loadData() }
  }

  const toggleSource = async (id: string, enabled: boolean) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
    await fetch("/api/intelligence/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) })
  }

  const deleteSource = async (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
    await fetch(`/api/intelligence/sources?id=${id}`, { method: "DELETE" })
  }

  const triggerJob = async (job: string) => {
    setTriggerStatus((prev) => ({ ...prev, [job]: "running" }))
    try {
      const res = await fetch("/api/intelligence/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) })
      if (res.ok) {
        setTriggerStatus((prev) => ({ ...prev, [job]: "done" }))
        toast.success("Job started", { description: "Check the Activity tab for progress" })
      } else {
        setTriggerStatus((prev) => ({ ...prev, [job]: "error" }))
        toast.error("Failed to trigger job")
      }
      setTimeout(() => loadData(true), 8000)
    } catch {
      setTriggerStatus((prev) => ({ ...prev, [job]: "error" }))
      toast.error("Failed to trigger job")
    }
    setTimeout(() => { setTriggerStatus((prev) => ({ ...prev, [job]: "idle" })) }, 3000)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading intelligence pipeline...</span>
      </div>
    )
  }

  const firmQueries = queries.filter((q) => q.scope === "FIRM")
  const analystQueries = queries.filter((q) => q.scope === "ANALYST")
  const firmPacks = packs.filter((p) => p.scope === "FIRM")
  const analystPacks = packs.filter((p) => p.scope === "ANALYST")

  return (
    <TooltipProvider>
      <div className="p-6 space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Intelligence</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Persistent discovery backbone — signals, sources, and job activity
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* ── Stats Strip ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Today's Signals" value={stats.todaySignals} />
          <StatCard label="Jobs Run" value={stats.todayRuns} />
          <StatCard label="Breaking / High" value={stats.breaking} alert={stats.breaking > 0} />
          <StatCard label="Bullish" value={stats.bullish} positive />
          <StatCard label="Bearish" value={stats.bearish} negative />
          <StatCard label="Tickers Covered" value={stats.uniqueTickers} />
          <StatCard label="Briefs Generated" value={stats.briefsGenerated} />
          <StatCard label="Signals Routed" value={stats.signalsRouted} />
        </div>

        {/* ── Triggers ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">
            Run:
          </span>
          {[
            { key: "market-sweep", label: "Market Sweep", time: "6:30 AM", tip: "Searches all firm queries via Perplexity Sonar" },
            { key: "portfolio-monitor", label: "Portfolio", time: "7:00 AM", tip: "Searches news for every holding and watchlist ticker" },
            { key: "source-pack-monitor", label: "Sources", time: "7:15 AM", tip: "Checks tracked domains for new content" },
            { key: "signal-router", label: "Router", time: "7:30 AM", tip: "Routes signals to relevant analysts" },
            { key: "morning-brief", label: "Brief", time: "7:45 AM", tip: "Generates per-analyst morning intelligence briefs" },
          ].map(({ key, label, time, tip }) => {
            const status = triggerStatus[key] ?? "idle"
            return (
              <Tooltip key={key}>
                <TooltipTrigger
                  render={
                    <Button variant="outline" size="sm" disabled={status === "running"} onClick={() => triggerJob(key)} />
                  }
                >
                  {status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : status === "error" ? <XCircle className="h-3.5 w-3.5 text-red-500" />
                    : <Play className="h-3.5 w-3.5" />}
                  {label}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{tip}</p>
                  <p className="text-muted-foreground">Cron: {time} ET Mon-Fri</p>
                </TooltipContent>
              </Tooltip>
            )
          })}

          {stats.lastRun && (
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              Last run: {relativeTime(stats.lastRun.startedAt)} · {stats.lastRun._count.signals} signals
            </span>
          )}
        </div>

        <Separator />

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <Tabs defaultValue="signals">
          <TabsList>
            <TabsTrigger value="signals">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Signals
            </TabsTrigger>
            <TabsTrigger value="briefs">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Briefs ({briefs.length})
            </TabsTrigger>
            <TabsTrigger value="routes">
              <Router className="h-3.5 w-3.5 mr-1.5" />
              Routes
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="queries">
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Queries ({queries.length})
            </TabsTrigger>
            <TabsTrigger value="sources">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              Sources ({sources.length})
            </TabsTrigger>
            <TabsTrigger value="packs">
              <Package className="h-3.5 w-3.5 mr-1.5" />
              Packs ({packs.length})
            </TabsTrigger>
          </TabsList>

          {/* ── SIGNALS TAB ─────────────────────────────────────────── */}
          <TabsContent value="signals" className="mt-4 space-y-3">
            {/* Section tooltip */}
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Intelligence gathered by background jobs. Each signal has a headline, tickers, sentiment, urgency, and source. Signals are routed to analysts based on relevance.
                </TooltipContent>
              </Tooltip>
            </div>
            {/* Source type filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 w-fit">
                {(["ALL", "WEB", "API"] as SourceTypeFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSourceTypeFilter(f)}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1",
                      sourceTypeFilter === f
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f === "WEB" && <Globe className="h-3 w-3" />}
                    {f === "API" && <Database className="h-3 w-3" />}
                    {f === "ALL" ? "All Sources" : f === "WEB" ? "Web Search" : "API Data"}
                  </button>
                ))}
              </div>
            </div>
            {/* Signal type filter row */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 w-fit">
              {(["ALL", "BREAKING", "BULLISH", "BEARISH", "NEWS", "EARNINGS"] as SignalFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setSignalFilter(f)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    signalFilter === f
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f === "ALL" ? `All (${signals.length})` : f === "BREAKING" ? `Urgent (${signals.filter(s => s.urgency === "BREAKING" || s.urgency === "HIGH").length})` : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            {filteredSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Newspaper className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No signals yet</p>
                <p className="text-xs mt-1">Run the Market Sweep to gather your first intelligence signals</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredSignals.map((signal) => (
                  <SignalRow key={signal.id} signal={signal} onClick={() => setSelectedSignal(signal)} />
                ))}
                {filteredSignals.length < signals.length && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Showing {filteredSignals.length} of {signals.length} signals
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── BRIEFS TAB ──────────────────────────────────────────── */}
          <TabsContent value="briefs" className="mt-4 space-y-3">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Synthesized morning intelligence for each analyst. Generated from routed signals by GPT-4o-mini. The analyst reads this as their first tool call.
              </TooltipContent>
            </Tooltip>
            {briefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No briefs generated yet</p>
                <p className="text-xs mt-1">Run the Router then Brief jobs to generate morning intelligence for each analyst</p>
              </div>
            ) : (
              <div className="space-y-3">
                {briefs.map((brief) => (
                  <BriefCard key={brief.id} brief={brief} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── ROUTES TAB ──────────────────────────────────────────── */}
          <TabsContent value="routes" className="mt-4 space-y-3">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Which signals were routed to which analyst, grouped by relevance score. High = 60+, Medium = 30-59, Low = under 30.
              </TooltipContent>
            </Tooltip>
            {routeInfo.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Router className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No routing data yet</p>
                <p className="text-xs mt-1">Run the Signal Router job to route signals to analysts</p>
              </div>
            ) : (
              <div className="space-y-2">
                {routeInfo.map((ri) => (
                  <Card key={ri.analystId}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{ri.analystName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ri.totalRoutes} signals routed ({ri.high} high relevance, {ri.medium} medium, {ri.low} low)
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {ri.pending > 0 && <Badge variant="secondary">{ri.pending} pending</Badge>}
                          {ri.read > 0 && <Badge variant="outline">{ri.read} read</Badge>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── ACTIVITY TAB ────────────────────────────────────────── */}
          <TabsContent value="activity" className="mt-4">
            {batches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Activity className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No job runs yet</p>
                <p className="text-xs mt-1">Trigger a job above or wait for the morning cron</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right w-20">Signals</TableHead>
                    <TableHead className="w-40">Started</TableHead>
                    <TableHead className="w-24">Duration</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => {
                    const isRunning = batch.status === "RUNNING"
                    const isFailed = batch.status === "FAILED"
                    const duration = batch.completedAt
                      ? Math.round((new Date(batch.completedAt).getTime() - new Date(batch.startedAt).getTime()) / 1000)
                      : null
                    return (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <span className={cn(
                            "inline-block h-1.5 w-1.5 rounded-full",
                            isRunning ? "bg-blue-500 animate-pulse" : isFailed ? "bg-red-500" : "bg-emerald-500"
                          )} />
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{JOB_LABELS[batch.jobType] ?? batch.jobType}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {batch._count.signals}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {relativeTime(batch.startedAt)}
                          <span className="text-xs ml-1.5 opacity-60">
                            {new Date(batch.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {isRunning ? (
                            <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />running</span>
                          ) : duration !== null ? `${duration}s` : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={cn(
                            "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border",
                            isRunning && "text-blue-500",
                            isFailed && "text-red-500",
                            !isRunning && !isFailed && "text-emerald-500",
                          )}>
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isRunning ? "bg-blue-500 animate-pulse" : isFailed ? "bg-red-500" : "bg-emerald-500"
                            )} />
                            {isRunning ? "Running" : isFailed ? "Failed" : "Complete"}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ── QUERIES TAB ─────────────────────────────────────────── */}
          <TabsContent value="queries" className="space-y-4 mt-4">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Search strings sent to Perplexity Sonar every morning. Each query produces 3-8 signals. Add your own or let the briefing agent suggest them.
              </TooltipContent>
            </Tooltip>
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-2">
                  <Input placeholder="Add a search query (e.g. 'semiconductor supply chain disruptions')" value={newQuery} onChange={(e) => setNewQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createQuery()} className="flex-1" />
                  <Select value={newQueryCategory} onValueChange={(v) => { if (v) setNewQueryCategory(v) }}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="SECTOR">Sector</SelectItem>
                      <SelectItem value="TICKER">Ticker</SelectItem>
                      <SelectItem value="THEMATIC">Thematic</SelectItem>
                      <SelectItem value="EVENT">Event</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={createQuery} disabled={!newQuery.trim()}><Plus className="h-3.5 w-3.5" />Add</Button>
                </div>
              </CardContent>
            </Card>

            {firmQueries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm-wide ({firmQueries.length})</p>
                {firmQueries.map((q) => <QueryRow key={q.id} query={q} onToggle={toggleQuery} onDelete={deleteQuery} />)}
              </div>
            )}
            {analystQueries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Analyst-specific ({analystQueries.length})</p>
                {analystQueries.map((q) => <QueryRow key={q.id} query={q} onToggle={toggleQuery} onDelete={deleteQuery} />)}
              </div>
            )}
            {queries.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Search className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No queries configured</p>
                <p className="text-xs mt-1">Add queries above or run the seed script</p>
              </div>
            )}
          </TabsContent>

          {/* ── SOURCES TAB ─────────────────────────────────────────── */}
          <TabsContent value="sources" className="space-y-4 mt-4">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Domains and APIs that the intelligence pipeline monitors. Web sources are searched via Perplexity. API sources call Finnhub/FMP directly for structured data.
              </TooltipContent>
            </Tooltip>
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-2">
                  <Input placeholder="Source name" value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} className="w-48" />
                  <Input placeholder="Domain (e.g. electrek.co)" value={newSourceDomain} onChange={(e) => setNewSourceDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createSource()} className="flex-1" />
                  <Select value={newSourceCategory} onValueChange={(v) => { if (v) setNewSourceCategory(v) }}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="SECTOR">Sector</SelectItem>
                      <SelectItem value="COMPANY">Company</SelectItem>
                      <SelectItem value="THEMATIC">Thematic</SelectItem>
                      <SelectItem value="SOCIAL">Social</SelectItem>
                      <SelectItem value="EVENT">Event</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={createSource} disabled={!newSourceName.trim() || !newSourceDomain.trim()}><Plus className="h-3.5 w-3.5" />Add</Button>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-1">
              {sources.map((s) => <SourceRow key={s.id} source={s} onToggle={toggleSource} onDelete={deleteSource} />)}
            </div>
            {sources.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Globe className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No sources configured</p>
              </div>
            )}
          </TabsContent>

          {/* ── PACKS TAB ───────────────────────────────────────────── */}
          <TabsContent value="packs" className="space-y-4 mt-4">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Groups of sources assigned to the firm or specific analysts. The source pack monitor checks all sources in each pack daily.
              </TooltipContent>
            </Tooltip>
            {firmPacks.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm Packs</p>
                {firmPacks.map((p) => <PackCard key={p.id} pack={p} />)}
              </div>
            )}
            {analystPacks.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Analyst Packs</p>
                {analystPacks.map((p) => <PackCard key={p.id} pack={p} />)}
              </div>
            )}
            {packs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No source packs configured</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Signal Detail Sheet ─────────────────────────────────────── */}
      <Sheet open={!!selectedSignal} onOpenChange={(open) => { if (!open) setSelectedSignal(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" showCloseButton={false}>
          {selectedSignal && <SignalDetail signal={selectedSignal} onClose={() => setSelectedSignal(null)} />}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, positive, negative, alert: isAlert }: {
  label: string
  value: number
  positive?: boolean
  negative?: boolean
  alert?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn(
          "text-lg font-semibold tabular-nums mt-0.5",
          positive && value > 0 && "text-emerald-500",
          negative && value > 0 && "text-red-500",
          isAlert && value > 0 && "text-amber-500",
        )}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

// ── Signal Row ────────────────────────────────────────────────────────────────

function SignalRow({ signal, onClick }: { signal: Signal; onClick: () => void }) {
  const urgency = URGENCY_CONF[signal.urgency] ?? URGENCY_CONF.LOW
  const sentiment = SENTIMENT_CONF[signal.sentiment] ?? SENTIMENT_CONF.NEUTRAL
  const SentIcon = sentiment.icon

  return (
    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={onClick}>
      <CardContent className="p-3 flex items-start gap-3">
        {/* Urgency dot */}
        <div className="pt-1.5">
          <span className={cn("inline-block h-2 w-2 rounded-full", urgency.dot)} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-snug">{signal.headline}</p>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{relativeTime(signal.createdAt)}</span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{signal.summary}</p>

          {/* Bottom row: tickers, sentiment, sources, type */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Tickers */}
            {signal.tickers.slice(0, 4).map((t) => (
              <Badge key={t} variant="secondary">${t}</Badge>
            ))}
            {signal.tickers.length > 4 && (
              <span className="text-xs text-muted-foreground">+{signal.tickers.length - 4}</span>
            )}

            {/* Sentiment pill */}
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded", sentiment.bg, sentiment.color)}>
              <SentIcon className="h-3 w-3" />
              {sentiment.label}
            </span>

            {/* Type */}
            <Badge variant="outline">{signal.type}</Badge>

            {/* Source badge — API vs Web */}
            {signal.sourceNames.some((n) => ["FMP", "Finnhub"].includes(n)) ? (
              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                <Database className="h-2.5 w-2.5" />
                via {signal.sourceNames.find((n) => ["FMP", "Finnhub"].includes(n))} API
              </span>
            ) : (
              signal.sourceNames.slice(0, 2).map((name) => (
                <span key={name} className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                  <Globe className="h-2.5 w-2.5" />
                  via {name}
                </span>
              ))
            )}
            {!signal.sourceNames.some((n) => ["FMP", "Finnhub"].includes(n)) && signal.sourceNames.length > 2 && (
              <span className="text-[11px] text-muted-foreground">+{signal.sourceNames.length - 2} sources</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Signal Detail Sheet Content ───────────────────────────────────────────────

function SignalDetail({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const urgency = URGENCY_CONF[signal.urgency] ?? URGENCY_CONF.LOW
  const sentiment = SENTIMENT_CONF[signal.sentiment] ?? SENTIMENT_CONF.NEUTRAL
  const SentIcon = sentiment.icon

  return (
    <>
      <SheetHeader className="flex flex-row items-start justify-between gap-2 pb-0">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-block h-2 w-2 rounded-full", urgency.dot)} />
            <span className={cn("text-xs font-medium", urgency.color)}>{urgency.label}</span>
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", sentiment.color)}>
              <SentIcon className="h-3 w-3" />{sentiment.label}
            </span>
            <Badge variant="outline">{signal.type}</Badge>
            <Badge variant="secondary">{signal.freshness}</Badge>
          </div>
          <SheetTitle className="text-base leading-snug pr-6">{signal.headline}</SheetTitle>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 mt-0">
          <X className="h-4 w-4" />
        </Button>
      </SheetHeader>

      <div className="mt-4 space-y-5">
        {/* Summary */}
        <p className="text-sm leading-relaxed">{signal.summary}</p>

        {/* Tickers + Themes */}
        {(signal.tickers.length > 0 || signal.themes.length > 0) && (
          <div className="space-y-3">
            {signal.tickers.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Tickers</p>
                <div className="flex flex-wrap gap-1.5">
                  {signal.tickers.map((t) => <Badge key={t} variant="secondary">${t}</Badge>)}
                </div>
              </div>
            )}
            {signal.themes.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Themes</p>
                <div className="flex flex-wrap gap-1.5">
                  {signal.themes.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                </div>
              </div>
            )}
            {signal.sectors.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Sectors</p>
                <div className="flex flex-wrap gap-1.5">
                  {signal.sectors.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                </div>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Metadata grid */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Signal Metadata</p>
          <div className="grid grid-cols-2 gap-3">
            <MetaItem label="Urgency" value={urgency.label} className={urgency.color} />
            <MetaItem label="Freshness" value={signal.freshness} />
            <MetaItem label="Source Quality" value={"★".repeat(signal.sourceQuality) + "☆".repeat(5 - signal.sourceQuality)} />
            <MetaItem label="Job" value={JOB_LABELS[signal.batch?.jobType ?? ""] ?? "—"} />
            <MetaItem label="Novelty" value={signal.noveltyScore != null ? `${signal.noveltyScore}/10` : "—"} />
            <MetaItem label="Created" value={new Date(signal.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
          </div>
        </div>

        <Separator />

        {/* Sources */}
        {signal.sourceUrls.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Sources</p>
            <div className="space-y-2">
              {signal.sourceUrls.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 hover:border-border hover:bg-accent/50 transition-colors group"
                >
                  <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-foreground">
                      {signal.sourceNames[i] || domainFromUrl(url)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{domainFromUrl(url)}</p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Artifact link */}
        {signal.artifactId && (
          <>
            <Separator />
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border/40 bg-muted/30">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Full article extracted — analyst can call <code className="text-[11px] bg-muted px-1 py-0.5 rounded">read_artifact</code> during runtime
              </span>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Meta Item ─────────────────────────────────────────────────────────────────

function MetaItem({ label, value, className: cx }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm tabular-nums", cx)}>{value}</p>
    </div>
  )
}

// ── Query Row ─────────────────────────────────────────────────────────────────

function QueryRow({ query, onToggle, onDelete }: { query: IntelligenceQuery; onToggle: (id: string, enabled: boolean) => void; onDelete: (id: string) => void }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Switch checked={query.enabled} onCheckedChange={(checked) => onToggle(query.id, checked)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{query.query}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary">{query.category}</Badge>
            <span className="text-xs text-muted-foreground">
              {query.createdBy === "BRIEFING_AGENT" ? "from briefing" : query.createdBy === "USER" ? "manual" : query.createdBy.toLowerCase()}
            </span>
            {query.expiresAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-3 w-3" />expires {new Date(query.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this query?</AlertDialogTitle>
              <AlertDialogDescription>This query will no longer be searched in future runs.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(query.id)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ── Source Row ─────────────────────────────────────────────────────────────────

function SourceRow({ source, onToggle, onDelete }: { source: Source; onToggle: (id: string, enabled: boolean) => void; onDelete: (id: string) => void }) {
  const isApi = source.type === "API"
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Switch checked={source.enabled} onCheckedChange={(checked) => onToggle(source.id, checked)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{source.name}</p>
            {source.domain && <span className="text-xs text-muted-foreground">{source.domain}</span>}
            <Badge variant="outline">
              {isApi ? <Database className="h-3 w-3 mr-0.5" /> : <Globe className="h-3 w-3 mr-0.5" />}
              {isApi ? "API" : "WEB"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary">{source.category}</Badge>
            <span className="text-xs text-muted-foreground">{"★".repeat(source.qualityScore)}{"☆".repeat(5 - source.qualityScore)}</span>
            {source.lastCheckedAt && <span className="text-xs text-muted-foreground">Checked {relativeTime(source.lastCheckedAt)}</span>}
            {isApi && <span className="text-xs text-muted-foreground">Produces structured data signals</span>}
            {!isApi && source.domain && <span className="text-xs text-muted-foreground">Monitors: {source.domain}</span>}
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {source.name}?</AlertDialogTitle>
              <AlertDialogDescription>This removes the source from all packs.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(source.id)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ── Pack Card ─────────────────────────────────────────────────────────────────

// ── Brief Card ─────────────────────────────────────────────────────────────────

function BriefCard({ brief }: { brief: MorningBrief }) {
  const alerts = brief.portfolioAlerts ?? []
  const updates = brief.watchlistUpdates ?? []
  const opportunities = brief.newOpportunities ?? []

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">{brief.analyst?.name ?? "Unknown Analyst"}</p>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{relativeTime(brief.generatedAt)}</span>
        </div>

        {/* Market context */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Market Context</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{brief.marketContext}</p>
        </div>

        {/* Counts row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary">{alerts.length} portfolio alert{alerts.length !== 1 ? "s" : ""}</Badge>
          <Badge variant="secondary">{updates.length} watchlist update{updates.length !== 1 ? "s" : ""}</Badge>
          <Badge variant="secondary">{opportunities.length} new opportunit{opportunities.length !== 1 ? "ies" : "y"}</Badge>
          {brief.riskFlags.length > 0 && (
            <Badge variant="outline">
              <AlertTriangle className="h-3 w-3 mr-0.5" />
              {brief.riskFlags.length} risk flag{brief.riskFlags.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Attention priority */}
        {brief.attentionPriority.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Focus:</span>
            {brief.attentionPriority.map((t) => (
              <Badge key={t} variant="secondary">${t}</Badge>
            ))}
          </div>
        )}

        {/* Signals consumed */}
        <p className="text-xs text-muted-foreground">{brief.signalCount} signals synthesized into this brief</p>
      </CardContent>
    </Card>
  )
}

// ── Pack Card ─────────────────────────────────────────────────────────────────

function PackCard({ pack }: { pack: SourcePack }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{pack.name}</p>
            <p className="text-xs text-muted-foreground">{pack.sources.length} sources{pack.analystId && " · analyst-specific"}</p>
          </div>
          <Badge variant="outline">{pack.scope}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pack.sources.map((sps) => (
            <Badge key={sps.id} variant="secondary">{sps.priority === 1 && "★ "}{sps.source.name}</Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
