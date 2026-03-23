"use client"

import { useEffect, useState, useCallback } from "react"
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
  SheetTrigger,
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
  AlertTriangle,
  Newspaper,
  X,
} from "lucide-react"

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

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return res.json() as Promise<T>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SENTIMENT_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  BULLISH: { icon: TrendingUp, color: "text-emerald-500", label: "Bullish" },
  BEARISH: { icon: TrendingDown, color: "text-red-500", label: "Bearish" },
  NEUTRAL: { icon: Minus, color: "text-muted-foreground", label: "Neutral" },
  MIXED: { icon: Activity, color: "text-amber-500", label: "Mixed" },
}

const URGENCY_CONFIG: Record<string, { color: string; dot: string }> = {
  BREAKING: { color: "text-red-500", dot: "bg-red-500 animate-pulse" },
  HIGH: { color: "text-amber-500", dot: "bg-amber-500" },
  MEDIUM: { color: "text-blue-500", dot: "bg-blue-500" },
  LOW: { color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
}

const JOB_LABELS: Record<string, string> = {
  MARKET_SWEEP: "Market Sweep",
  PORTFOLIO_MONITOR: "Portfolio Monitor",
  SOURCE_PACK: "Source Packs",
  EMAIL_INGEST: "Email Ingest",
  MANUAL: "Manual",
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [queries, setQueries] = useState<IntelligenceQuery[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [packs, setPacks] = useState<SourcePack[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [batches, setBatches] = useState<SignalBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [triggerStatus, setTriggerStatus] = useState<Record<string, "idle" | "running" | "done" | "error">>({})
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)

  // New query form
  const [newQuery, setNewQuery] = useState("")
  const [newQueryCategory, setNewQueryCategory] = useState("MARKET")

  // New source form
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceDomain, setNewSourceDomain] = useState("")
  const [newSourceCategory, setNewSourceCategory] = useState("MARKET")

  const loadData = useCallback(async () => {
    try {
      const [q, s, p, sig, b] = await Promise.all([
        fetchJSON<IntelligenceQuery[]>("/api/intelligence/queries"),
        fetchJSON<Source[]>("/api/intelligence/sources"),
        fetchJSON<SourcePack[]>("/api/intelligence/source-packs"),
        fetchJSON<Signal[]>("/api/intelligence/signals?limit=100"),
        fetchJSON<SignalBatch[]>("/api/intelligence/batches?limit=20"),
      ])
      setQueries(q)
      setSources(s)
      setPacks(p)
      setSignals(sig)
      setBatches(b)
    } catch (e) {
      console.error("Failed to load intelligence data", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Actions ───────────────────────────────────────────────────────────────

  const toggleQuery = async (id: string, enabled: boolean) => {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, enabled } : q)))
    await fetch("/api/intelligence/queries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], enabled }),
    })
  }

  const deleteQuery = async (id: string) => {
    setQueries((prev) => prev.filter((q) => q.id !== id))
    await fetch(`/api/intelligence/queries?id=${id}`, { method: "DELETE" })
  }

  const createQuery = async () => {
    if (!newQuery.trim()) return
    const res = await fetch("/api/intelligence/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: newQuery.trim(),
        category: newQueryCategory,
        scope: "FIRM",
        createdBy: "USER",
      }),
    })
    if (res.ok) {
      setNewQuery("")
      loadData()
    }
  }

  const createSource = async () => {
    if (!newSourceName.trim() || !newSourceDomain.trim()) return
    const res = await fetch("/api/intelligence/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newSourceName.trim(),
        type: "DOMAIN",
        domain: newSourceDomain.trim().replace(/^https?:\/\//, "").replace(/^www\./, ""),
        category: newSourceCategory,
        qualityScore: 3,
      }),
    })
    if (res.ok) {
      setNewSourceName("")
      setNewSourceDomain("")
      loadData()
    }
  }

  const toggleSource = async (id: string, enabled: boolean) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
    await fetch("/api/intelligence/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    })
  }

  const deleteSource = async (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
    await fetch(`/api/intelligence/sources?id=${id}`, { method: "DELETE" })
  }

  const triggerJob = async (job: string) => {
    setTriggerStatus((prev) => ({ ...prev, [job]: "running" }))
    try {
      const res = await fetch("/api/intelligence/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      })
      setTriggerStatus((prev) => ({ ...prev, [job]: res.ok ? "done" : "error" }))
      // Reload data after a delay to pick up new signals
      setTimeout(() => loadData(), 5000)
    } catch {
      setTriggerStatus((prev) => ({ ...prev, [job]: "error" }))
    }
    setTimeout(() => {
      setTriggerStatus((prev) => ({ ...prev, [job]: "idle" }))
    }, 3000)
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Intelligence Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Background discovery, signal feed, sources, and job activity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {signals.length} signals · {batches.length} runs
            </span>
            <Button variant="outline" size="sm" onClick={loadData}>
              Refresh
            </Button>
          </div>
        </div>

        <Separator />

        {/* ── Manual Triggers ──────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Run Jobs
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "market-sweep", label: "Market Sweep", time: "6:30 AM", tip: "Searches all firm queries via Perplexity Sonar" },
              { key: "portfolio-monitor", label: "Portfolio Monitor", time: "7:00 AM", tip: "Searches news for every open position and watchlist ticker" },
              { key: "source-pack-monitor", label: "Source Packs", time: "7:15 AM", tip: "Checks tracked domains for new content" },
              { key: "signal-router", label: "Signal Router", time: "7:30 AM", tip: "Routes today's signals to relevant analysts" },
              { key: "morning-brief", label: "Morning Brief", time: "7:45 AM", tip: "Generates per-analyst intelligence briefs" },
            ].map(({ key, label, time, tip }) => {
              const status = triggerStatus[key] ?? "idle"
              return (
                <Tooltip key={key}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={status === "running"}
                        onClick={() => triggerJob(key)}
                      />
                    }
                  >
                    {status === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : status === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : status === "error" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {label}
                    <span className="text-muted-foreground text-xs ml-1">({time})</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{tip}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>

        <Separator />

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <Tabs defaultValue="signals">
          <TabsList>
            <TabsTrigger value="signals">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Signals ({signals.length})
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Activity ({batches.length})
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

          {/* ── Signals Tab ──────────────────────────────────────────── */}
          <TabsContent value="signals" className="mt-4">
            {signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Newspaper className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No signals yet</p>
                <p className="text-xs mt-1">
                  Run the Market Sweep to gather your first intelligence signals
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead className="w-24">Tickers</TableHead>
                    <TableHead className="w-20">Sentiment</TableHead>
                    <TableHead className="w-20">Source</TableHead>
                    <TableHead className="w-28">Job</TableHead>
                    <TableHead className="w-28 text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signals.map((signal) => {
                    const urgencyConf = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW
                    const sentimentConf = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL
                    const SentIcon = sentimentConf.icon
                    return (
                      <TableRow
                        key={signal.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedSignal(signal)}
                      >
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger render={<span />}>
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${urgencyConf.dot}`} />
                            </TooltipTrigger>
                            <TooltipContent side="right">{signal.urgency} urgency</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium truncate max-w-md">{signal.headline}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-md mt-0.5">
                            {signal.summary}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {signal.tickers.slice(0, 3).map((t) => (
                              <Badge key={t} variant="secondary">
                                ${t}
                              </Badge>
                            ))}
                            {signal.tickers.length > 3 && (
                              <span className="text-xs text-muted-foreground">+{signal.tickers.length - 3}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs ${sentimentConf.color}`}>
                            <SentIcon className="h-3 w-3" />
                            {sentimentConf.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground truncate block max-w-20">
                            {signal.sourceNames[0] ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {JOB_LABELS[signal.batch?.jobType ?? ""] ?? signal.batch?.jobType ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {new Date(signal.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ── Activity Tab ─────────────────────────────────────────── */}
          <TabsContent value="activity" className="mt-4">
            {batches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Activity className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No job runs yet</p>
                <p className="text-xs mt-1">
                  Trigger a job above or wait for the morning cron
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="w-28 text-right">Signals</TableHead>
                    <TableHead className="w-36">Started</TableHead>
                    <TableHead className="w-28">Duration</TableHead>
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
                          {isRunning ? (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                          ) : isFailed ? (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                          ) : (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">
                            {JOB_LABELS[batch.jobType] ?? batch.jobType}
                          </p>
                          <p className="text-xs text-muted-foreground">{batch.id.slice(0, 8)}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {batch._count.signals}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {new Date(batch.startedAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {isRunning ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> running
                            </span>
                          ) : duration !== null ? (
                            `${duration}s`
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ── Queries Tab ───────────────────────────────────────────── */}
          <TabsContent value="queries" className="space-y-4 mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a search query (e.g. 'semiconductor supply chain disruptions')"
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createQuery()}
                    className="flex-1"
                  />
                  <Select value={newQueryCategory} onValueChange={(v) => { if (v) setNewQueryCategory(v) }}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="SECTOR">Sector</SelectItem>
                      <SelectItem value="TICKER">Ticker</SelectItem>
                      <SelectItem value="THEMATIC">Thematic</SelectItem>
                      <SelectItem value="EVENT">Event</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={createQuery} disabled={!newQuery.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            {firmQueries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Firm-wide ({firmQueries.length})
                </p>
                {firmQueries.map((q) => (
                  <QueryRow key={q.id} query={q} onToggle={toggleQuery} onDelete={deleteQuery} />
                ))}
              </div>
            )}

            {analystQueries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Analyst-specific ({analystQueries.length})
                </p>
                {analystQueries.map((q) => (
                  <QueryRow key={q.id} query={q} onToggle={toggleQuery} onDelete={deleteQuery} />
                ))}
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

          {/* ── Sources Tab ───────────────────────────────────────────── */}
          <TabsContent value="sources" className="space-y-4 mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Source name (e.g. 'Electrek')"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    className="w-48"
                  />
                  <Input
                    placeholder="Domain (e.g. 'electrek.co')"
                    value={newSourceDomain}
                    onChange={(e) => setNewSourceDomain(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createSource()}
                    className="flex-1"
                  />
                  <Select value={newSourceCategory} onValueChange={(v) => { if (v) setNewSourceCategory(v) }}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="SECTOR">Sector</SelectItem>
                      <SelectItem value="COMPANY">Company</SelectItem>
                      <SelectItem value="THEMATIC">Thematic</SelectItem>
                      <SelectItem value="SOCIAL">Social</SelectItem>
                      <SelectItem value="EVENT">Event</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={createSource}
                    disabled={!newSourceName.trim() || !newSourceDomain.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-1">
              {sources.map((s) => (
                <SourceRow key={s.id} source={s} onToggle={toggleSource} onDelete={deleteSource} />
              ))}
            </div>

            {sources.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Globe className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No sources configured</p>
                <p className="text-xs mt-1">Run the seed script to populate defaults</p>
              </div>
            )}
          </TabsContent>

          {/* ── Source Packs Tab ──────────────────────────────────────── */}
          <TabsContent value="packs" className="space-y-4 mt-4">
            {firmPacks.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Firm Packs
                </p>
                {firmPacks.map((p) => (
                  <PackCard key={p.id} pack={p} />
                ))}
              </div>
            )}

            {analystPacks.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Analyst Packs
                </p>
                {analystPacks.map((p) => (
                  <PackCard key={p.id} pack={p} />
                ))}
              </div>
            )}

            {packs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium mt-3">No source packs configured</p>
                <p className="text-xs mt-1">Run the seed script to populate defaults</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Signal Detail Sheet ───────────────────────────────────────── */}
      <Sheet open={!!selectedSignal} onOpenChange={(open) => { if (!open) setSelectedSignal(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" showCloseButton={false}>
          {selectedSignal && (
            <>
              <SheetHeader className="flex flex-row items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <UrgencyDot urgency={selectedSignal.urgency} />
                    <Badge variant="secondary">{selectedSignal.type}</Badge>
                    <SentimentLabel sentiment={selectedSignal.sentiment} />
                  </div>
                  <SheetTitle className="text-base leading-snug">
                    {selectedSignal.headline}
                  </SheetTitle>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSignal(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Summary */}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Summary
                  </p>
                  <p className="text-sm leading-relaxed">{selectedSignal.summary}</p>
                </div>

                <Separator />

                {/* Tickers */}
                {selectedSignal.tickers.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                      Tickers
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedSignal.tickers.map((t) => (
                        <Badge key={t} variant="secondary">${t}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Themes */}
                {selectedSignal.themes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                      Themes
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedSignal.themes.map((t) => (
                        <Badge key={t} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Metadata */}
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Details
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Urgency</span>
                      <p className={URGENCY_CONFIG[selectedSignal.urgency]?.color}>{selectedSignal.urgency}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Freshness</span>
                      <p>{selectedSignal.freshness}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Source Quality</span>
                      <p>{"★".repeat(selectedSignal.sourceQuality)}{"☆".repeat(5 - selectedSignal.sourceQuality)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Job</span>
                      <p>{JOB_LABELS[selectedSignal.batch?.jobType ?? ""] ?? "—"}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Sources */}
                {selectedSignal.sourceUrls.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                      Sources
                    </p>
                    <div className="space-y-1.5">
                      {selectedSignal.sourceUrls.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {selectedSignal.sourceNames[i] ?? new URL(url).hostname}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timestamp */}
                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Created {new Date(selectedSignal.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function UrgencyDot({ urgency }: { urgency: string }) {
  const conf = URGENCY_CONFIG[urgency] ?? URGENCY_CONFIG.LOW
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${conf.dot}`} />
}

function SentimentLabel({ sentiment }: { sentiment: string }) {
  const conf = SENTIMENT_CONFIG[sentiment] ?? SENTIMENT_CONFIG.NEUTRAL
  const Icon = conf.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${conf.color}`}>
      <Icon className="h-3 w-3" />
      {conf.label}
    </span>
  )
}

function QueryRow({
  query,
  onToggle,
  onDelete,
}: {
  query: IntelligenceQuery
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Switch
          checked={query.enabled}
          onCheckedChange={(checked) => onToggle(query.id, checked)}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{query.query}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary">{query.category}</Badge>
            <span className="text-xs text-muted-foreground">
              {query.createdBy === "BRIEFING_AGENT" ? "from briefing" : query.createdBy === "USER" ? "manual" : query.createdBy.toLowerCase()}
            </span>
            {query.expiresAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                expires {new Date(query.expiresAt).toLocaleDateString()}
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
              <AlertDialogDescription>
                This will remove the query from the intelligence pipeline.
              </AlertDialogDescription>
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

function SourceRow({
  source,
  onToggle,
  onDelete,
}: {
  source: Source
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Switch
          checked={source.enabled}
          onCheckedChange={(checked) => onToggle(source.id, checked)}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{source.name}</p>
            {source.domain && (
              <span className="text-xs text-muted-foreground">{source.domain}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary">{source.category}</Badge>
            <span className="text-xs text-muted-foreground">
              {"★".repeat(source.qualityScore)}{"☆".repeat(5 - source.qualityScore)}
            </span>
            {source.lastCheckedAt && (
              <span className="text-xs text-muted-foreground">
                Checked {new Date(source.lastCheckedAt).toLocaleDateString()}
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
              <AlertDialogTitle>Delete {source.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the source from all packs that reference it.
              </AlertDialogDescription>
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

function PackCard({ pack }: { pack: SourcePack }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{pack.name}</p>
            <p className="text-xs text-muted-foreground">
              {pack.sources.length} sources
              {pack.analystId && " · analyst-specific"}
            </p>
          </div>
          <Badge variant="outline">{pack.scope}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pack.sources.map((sps) => (
            <Badge key={sps.id} variant="secondary">
              {sps.priority === 1 && "★ "}
              {sps.source.name}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
