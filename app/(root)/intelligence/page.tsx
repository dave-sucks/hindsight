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

interface SignalBatch {
  id: string
  jobType: string
  status: string
  signalCount: number
  startedAt: string
  completedAt: string | null
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return res.json() as Promise<T>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const [queries, setQueries] = useState<IntelligenceQuery[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [packs, setPacks] = useState<SourcePack[]>([])
  const [loading, setLoading] = useState(true)
  const [triggerStatus, setTriggerStatus] = useState<Record<string, "idle" | "running" | "done" | "error">>({})

  // New query form
  const [newQuery, setNewQuery] = useState("")
  const [newQueryCategory, setNewQueryCategory] = useState("MARKET")

  // New source form
  const [newSourceName, setNewSourceName] = useState("")
  const [newSourceDomain, setNewSourceDomain] = useState("")
  const [newSourceCategory, setNewSourceCategory] = useState("MARKET")

  const loadData = useCallback(async () => {
    try {
      const [q, s, p] = await Promise.all([
        fetchJSON<IntelligenceQuery[]>("/api/intelligence/queries"),
        fetchJSON<Source[]>("/api/intelligence/sources"),
        fetchJSON<SourcePack[]>("/api/intelligence/source-packs"),
      ])
      setQueries(q)
      setSources(s)
      setPacks(p)
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
        <span className="text-sm">Loading intelligence config...</span>
      </div>
    )
  }

  const firmQueries = queries.filter((q) => q.scope === "FIRM")
  const analystQueries = queries.filter((q) => q.scope === "ANALYST")
  const firmPacks = packs.filter((p) => p.scope === "FIRM")
  const analystPacks = packs.filter((p) => p.scope === "ANALYST")

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Intelligence Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure what background discovery jobs search for, which sources they monitor, and trigger jobs manually
        </p>
      </div>

      <Separator />

      {/* ── Manual Triggers ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Run Jobs
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "market-sweep", label: "Market Sweep", time: "6:30 AM" },
            { key: "portfolio-monitor", label: "Portfolio Monitor", time: "7:00 AM" },
            { key: "source-pack-monitor", label: "Source Packs", time: "7:15 AM" },
            { key: "signal-router", label: "Signal Router", time: "7:30 AM" },
            { key: "morning-brief", label: "Morning Brief", time: "7:45 AM" },
          ].map(({ key, label, time }) => {
            const status = triggerStatus[key] ?? "idle"
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                disabled={status === "running"}
                onClick={() => triggerJob(key)}
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
              </Button>
            )
          })}
        </div>
      </div>

      <Separator />

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs defaultValue="queries">
        <TabsList>
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
            Source Packs ({packs.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Queries Tab ─────────────────────────────────────────────── */}
        <TabsContent value="queries" className="space-y-4 mt-4">
          {/* Add query form */}
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

          {/* Firm queries */}
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

          {/* Analyst queries */}
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
            <p className="text-sm text-muted-foreground py-8 text-center">
              No queries configured. Run the seed script or add queries above.
            </p>
          )}
        </TabsContent>

        {/* ── Sources Tab ─────────────────────────────────────────────── */}
        <TabsContent value="sources" className="space-y-4 mt-4">
          {/* Add source form */}
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

          {/* Source list */}
          <div className="space-y-1">
            {sources.map((s) => (
              <SourceRow key={s.id} source={s} onToggle={toggleSource} onDelete={deleteSource} />
            ))}
          </div>

          {sources.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No sources configured. Run the seed script to populate defaults.
            </p>
          )}
        </TabsContent>

        {/* ── Source Packs Tab ─────────────────────────────────────────── */}
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
            <p className="text-sm text-muted-foreground py-8 text-center">
              No source packs configured. Run the seed script to populate defaults.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

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
                This will remove the query from the intelligence pipeline. It won&apos;t be searched in future runs.
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
              Quality: {"★".repeat(source.qualityScore)}{"☆".repeat(5 - source.qualityScore)}
            </span>
            {source.lastCheckedAt && (
              <span className="text-xs text-muted-foreground">
                Last checked: {new Date(source.lastCheckedAt).toLocaleString()}
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
