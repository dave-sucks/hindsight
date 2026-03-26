"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
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
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Search,
  Globe,
  Info,
  SlidersHorizontal,
  Package,
  Terminal,
  Lock,
  CalendarDays,
  Briefcase,
  TrendingUp,
  TrendingDown,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IntelligenceQuery, Source, SourcePack } from "./types";
import { relativeTime } from "./types";
import { PerplexityLogo, FirecrawlLogo } from "./icons";

// ── Built-in Data Sources ────────────────────────────────────────────────────
// These represent data sources that run during the intelligence pipeline but
// have NO representation in the Config DB. Making them visible so users can
// understand what's actually producing signals.

interface BuiltInSource {
  id: string;
  name: string;
  description: string;
  tool: string;
  toolIcon: React.ComponentType<{ className?: string }>;
  endpoint: string;
  schedule: string;
  job: string;
  signalType: string;
  estimatedSignals: string;
  enabled: boolean; // always true — can't disable yet
}

const BUILT_IN_SOURCES: BuiltInSource[] = [
  {
    id: "builtin-fmp-gainers",
    name: "FMP Market Gainers",
    description:
      "Top 10 stocks with largest percentage gains today. Each becomes a BULLISH price action signal with urgency based on change magnitude.",
    tool: "Financial Modeling Prep",
    toolIcon: TrendingUp,
    endpoint: "GET /stock_market/gainers",
    schedule: "6:30 AM ET",
    job: "Market Sweep",
    signalType: "PRICE_ACTION",
    estimatedSignals: "~10 per day",
    enabled: true,
  },
  {
    id: "builtin-fmp-losers",
    name: "FMP Market Losers",
    description:
      "Top 10 stocks with largest percentage losses today. Each becomes a BEARISH price action signal.",
    tool: "Financial Modeling Prep",
    toolIcon: TrendingDown,
    endpoint: "GET /stock_market/losers",
    schedule: "6:30 AM ET",
    job: "Market Sweep",
    signalType: "PRICE_ACTION",
    estimatedSignals: "~10 per day",
    enabled: true,
  },
  {
    id: "builtin-fmp-actives",
    name: "FMP Most Active",
    description:
      "Top 10 most actively traded stocks by volume. High volume often signals institutional activity or breaking news.",
    tool: "Financial Modeling Prep",
    toolIcon: Activity,
    endpoint: "GET /stock_market/actives",
    schedule: "6:30 AM ET",
    job: "Market Sweep",
    signalType: "PRICE_ACTION",
    estimatedSignals: "~10 per day",
    enabled: true,
  },
  {
    id: "builtin-finnhub-earnings",
    name: "Finnhub Earnings Calendar",
    description:
      "Companies reporting earnings in the next 7 days. Urgency increases as the earnings date approaches (HIGH if ≤2 days).",
    tool: "Finnhub",
    toolIcon: CalendarDays,
    endpoint: "GET /calendar/earnings",
    schedule: "6:30 AM ET",
    job: "Market Sweep",
    signalType: "EARNINGS",
    estimatedSignals: "~20-80 per day",
    enabled: true,
  },
  {
    id: "builtin-portfolio-monitor",
    name: "Portfolio & Watchlist Monitor",
    description:
      'For every ticker in open positions + watchlists across all analysts, searches "{TICKER} stock news developments catalysts today" via Perplexity Sonar. Catches ticker-specific news the broad sweep misses.',
    tool: "Perplexity Sonar",
    toolIcon: Briefcase,
    endpoint: "Sonar search per ticker",
    schedule: "7:00 AM ET",
    job: "Portfolio Monitor",
    signalType: "NEWS",
    estimatedSignals: "~3-5 per ticker",
    enabled: true,
  },
];

// ── Unified row type ─────────────────────────────────────────────────────────

type ItemKind = "search" | "source" | "builtin";

interface UnifiedItem {
  id: string;
  kind: ItemKind;
  name: string;
  detail: string | null;
  category: string;
  scope: string;
  enabled: boolean;
  createdBy?: string;
  expiresAt?: string | null;
  lastCheckedAt?: string | null;
  qualityScore?: number;
  sourceType?: string;
  domain?: string | null;
  packs?: string[];
  raw: IntelligenceQuery | Source | BuiltInSource;
}

function buildUnifiedItems(
  queries: IntelligenceQuery[],
  sources: Source[],
  packs: SourcePack[]
): UnifiedItem[] {
  const sourcePackMap = new Map<string, string[]>();
  for (const pack of packs) {
    for (const ps of pack.sources) {
      const existing = sourcePackMap.get(ps.source.id) ?? [];
      existing.push(pack.name);
      sourcePackMap.set(ps.source.id, existing);
    }
  }

  const builtInItems: UnifiedItem[] = BUILT_IN_SOURCES.map((b) => ({
    id: b.id,
    kind: "builtin" as const,
    name: b.name,
    detail: b.endpoint,
    category: b.signalType,
    scope: "FIRM",
    enabled: b.enabled,
    sourceType: "API",
    raw: b,
  }));

  const queryItems: UnifiedItem[] = queries.map((q) => ({
    id: q.id,
    kind: "search" as const,
    name: q.query,
    detail: null,
    category: q.category,
    scope: q.scope,
    enabled: q.enabled,
    createdBy: q.createdBy,
    expiresAt: q.expiresAt,
    raw: q,
  }));

  const sourceItems: UnifiedItem[] = sources.map((s) => ({
    id: s.id,
    kind: "source" as const,
    name: s.name,
    detail: s.domain,
    category: s.category,
    scope: "FIRM",
    enabled: s.enabled,
    lastCheckedAt: s.lastCheckedAt,
    qualityScore: s.qualityScore,
    sourceType: s.type,
    domain: s.domain,
    packs: sourcePackMap.get(s.id) ?? [],
    raw: s,
  }));

  return [...builtInItems, ...queryItems, ...sourceItems];
}

// ── Category tooltips ────────────────────────────────────────────────────────

const CATEGORY_TOOLTIPS: Record<string, string> = {
  MARKET: "Broad market-level intelligence — indices, macro data, overall sentiment",
  SECTOR: "Industry/sector-specific monitoring — e.g. tech, healthcare, energy",
  TICKER: "Individual stock-level queries or sources for specific companies",
  THEMATIC: "Cross-cutting themes — e.g. AI, tariffs, supply chain trends",
  EVENT: "Time-bound events — earnings, IPOs, FDA decisions, M&A announcements",
  COMPANY: "Company-specific source — covers one company's filings, news, etc.",
  SOCIAL: "Social media / sentiment — StockTwits, Reddit, Twitter/X chatter",
  PRICE_ACTION: "Price movement signals — market movers, volume spikes",
  EARNINGS: "Earnings calendar and reporting signals",
  NEWS: "General news and portfolio monitoring signals",
  MACRO: "Macroeconomic indicators and regime signals",
};

const CATEGORY_OPTIONS = [
  { value: "MARKET", label: "Market", description: "Broad market & macro intelligence" },
  { value: "SECTOR", label: "Sector", description: "Industry-specific monitoring" },
  { value: "TICKER", label: "Ticker", description: "Individual stock queries" },
  { value: "THEMATIC", label: "Thematic", description: "Cross-cutting themes (AI, tariffs...)" },
  { value: "EVENT", label: "Event", description: "Earnings, IPOs, FDA decisions" },
  { value: "COMPANY", label: "Company", description: "Single company coverage" },
  { value: "SOCIAL", label: "Social", description: "Social media sentiment" },
];

const CREATED_BY_LABELS: Record<string, string> = {
  USER: "You",
  BRIEFING_AGENT: "Briefing agent",
  ANALYST_BUILDER: "Analyst builder",
  ANALYST_RUNTIME: "Analyst runtime",
};

// ── Config Panel ────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  queries: IntelligenceQuery[];
  sources: Source[];
  packs: SourcePack[];
  onRefresh: () => void;
}

export function ConfigPanel({
  queries,
  sources,
  packs,
  onRefresh,
}: ConfigPanelProps) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | ItemKind>("all");

  const allItems = useMemo(
    () => buildUnifiedItems(queries, sources, packs),
    [queries, sources, packs]
  );

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = `${item.name} ${item.detail ?? ""} ${item.domain ?? ""}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, kindFilter, search]);

  const toggleItem = async (item: UnifiedItem) => {
    if (item.kind === "builtin") {
      toast.info("Built-in sources can't be disabled yet");
      return;
    }
    try {
      if (item.kind === "search") {
        await fetch("/api/intelligence/queries", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [item.id], enabled: !item.enabled }),
        });
      } else {
        await fetch("/api/intelligence/sources", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
        });
      }
      onRefresh();
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const deleteItem = async (item: UnifiedItem) => {
    if (item.kind === "builtin") return;
    try {
      const endpoint = item.kind === "search" ? "queries" : "sources";
      await fetch(`/api/intelligence/${endpoint}?id=${item.id}`, {
        method: "DELETE",
      });
      toast.success("Deleted");
      onRefresh();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const builtInCount = BUILT_IN_SOURCES.length;
  const searchCount = queries.length;
  const sourceCount = sources.length;
  const hasFilters = kindFilter !== "all" || search !== "";

  return (
    <TooltipProvider>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* ── Built-in Data Sources ────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">API Integrations</p>
              <p className="text-xs text-muted-foreground">
                Built-in data feeds that run automatically during the pipeline
              </p>
            </div>
            <Badge variant="secondary">{builtInCount}</Badge>
          </div>
          <div className="grid gap-2">
            {BUILT_IN_SOURCES.map((source) => (
              <BuiltInSourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>

        <Separator />

        {/* ── Search Queries + Domain Sources ──────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Search Queries & Sources</p>
              <p className="text-xs text-muted-foreground">
                Configurable queries and monitored domains
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{searchCount} queries</Badge>
              <Badge variant="secondary">{sourceCount} sources</Badge>
            </div>
          </div>

          {/* Add new */}
          <AddItemInput onRefresh={onRefresh} />

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={kindFilter} onValueChange={(v) => v && setKindFilter(v as typeof kindFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="search">Queries ({searchCount})</SelectItem>
                <SelectItem value="source">Sources ({sourceCount})</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKindFilter("all");
                  setSearch("");
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Table — only queries and sources */}
          <Table>
            <TableBody>
              {filtered.filter(i => i.kind !== "builtin").length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No items match your filters
                  </TableCell>
                </TableRow>
              )}
              {filtered
                .filter((i) => i.kind !== "builtin")
                .map((item) => (
                  <ConfigRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onToggle={() => toggleItem(item)}
                    onDelete={() => deleteItem(item)}
                  />
                ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </TooltipProvider>
  );
}

// ── Built-in Source Card ─────────────────────────────────────────────────────
// A clear, informative card for each built-in API integration

function BuiltInSourceCard({ source }: { source: BuiltInSource }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = source.toolIcon;

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/30 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md flex items-center justify-center bg-muted shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{source.name}</p>
            <Badge variant="outline" className="text-[10px]">
              Built-in
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {source.description}
          </p>

          {expanded && (
            <div className="mt-3 space-y-2">
              {/* Endpoint */}
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
                <Badge variant="secondary">GET</Badge>
                <span>{source.endpoint}</span>
              </div>
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Tool</span>
                <span>{source.tool}</span>
                <span className="text-muted-foreground">Schedule</span>
                <span>{source.schedule} weekdays</span>
                <span className="text-muted-foreground">Pipeline job</span>
                <span>{source.job}</span>
                <span className="text-muted-foreground">Signal type</span>
                <span>{source.signalType}</span>
                <span className="text-muted-foreground">Output</span>
                <span>{source.estimatedSignals}</span>
              </div>
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{source.schedule}</span>
      </div>
    </Card>
  );
}

// ── Config Row ───────────────────────────────────────────────────────────────

function ConfigRow({
  item,
  onToggle,
  onDelete,
}: {
  item: UnifiedItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      {/* Colored type icon */}
      <TableCell>
        <ItemIcon kind={item.kind} sourceType={item.sourceType} />
      </TableCell>

      {/* Name + detail */}
      <TableCell>
        <div className="min-w-0">
          <p className={cn("text-sm truncate", !item.enabled && "text-muted-foreground")}>
            {item.name}
          </p>
          {item.detail && (
            <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
          )}
        </div>
      </TableCell>

      {/* Scope */}
      <TableCell>
        <span className="text-xs text-muted-foreground">
          {item.scope === "FIRM" ? "Firm" : "Analyst"}
        </span>
      </TableCell>

      {/* Enabled toggle */}
      <TableCell>
        <Switch checked={item.enabled} onCheckedChange={onToggle} />
      </TableCell>

      {/* Detail popover */}
      <TableCell>
        <ItemDetailPopover item={item} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}

// ── Shared visual elements ────────────────────────────────────────────────────

function ItemIcon({ kind, sourceType }: { kind: ItemKind; sourceType?: string }) {
  if (kind === "search") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-brand-blue/10 text-brand-blue">
        <Search className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (sourceType === "API") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-brand/20 text-emerald-600 dark:text-emerald-400">
        <Terminal className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="h-7 w-7 rounded-md flex items-center justify-center bg-brand-orange/10 text-brand-orange">
      <Globe className="h-3.5 w-3.5" />
    </div>
  );
}

/** Fake search bar for search queries */
function SearchQueryVisual({ query }: { query: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <p className="text-sm text-foreground truncate">{query}</p>
    </div>
  );
}

/** Browser-style URL bar for domain sources */
function DomainVisual({ domain, name }: { domain: string; name: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground font-mono truncate">{domain}</p>
      </div>
    </div>
  );
}

/** Fake API call display for API sources */
function ApiCallVisual({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono">
        <Badge variant="secondary" className="shrink-0 text-[10px] font-mono">
          GET
        </Badge>
        <p className="text-xs text-foreground truncate">{domain}</p>
      </div>
    </div>
  );
}

// ── Detail Popover ───────────────────────────────────────────────────────────

function ItemDetailPopover({
  item,
  onDelete,
}: {
  item: UnifiedItem;
  onDelete: () => void;
}) {
  const isSearch = item.kind === "search";
  const isApi = item.sourceType === "API";

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" />}
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80">
        {/* Visual header */}
        <div className="pb-1">
          {isSearch ? (
            <SearchQueryVisual query={item.name} />
          ) : isApi ? (
            <ApiCallVisual name={item.name} domain={item.detail ?? item.domain ?? ""} />
          ) : (
            <DomainVisual
              name={item.name}
              domain={item.detail ?? item.domain ?? ""}
            />
          )}
        </div>

        <Separator />

        {/* Trigger + how it works */}
        <div className="text-xs space-y-2">
          <div className="flex items-center gap-2">
            {isSearch ? (
              <PerplexityLogo className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : isApi ? (
              <Terminal className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <FirecrawlLogo className="h-4 w-4 text-brand-orange shrink-0" />
            )}
            <span className="font-medium text-foreground">
              {isSearch ? "Market Sweep" : isApi ? "API Integration" : "Source Pack Monitor"}
            </span>
            <span className="text-muted-foreground ml-auto tabular-nums">
              {isSearch ? "6:30 AM ET" : isApi ? "6:30 AM ET" : "7:15 AM ET"}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {isSearch
              ? "This query runs as a Perplexity Sonar search every weekday morning. Results are parsed into signals, deduplicated, then routed to matching analysts."
              : isApi
              ? "This API endpoint is called during the market sweep to pull structured data (earnings, movers, filings). Results become signals routed to matching analysts."
              : "This domain is checked for new content via Perplexity Sonar domain search. High-value pages get full text extraction via Firecrawl."}
          </p>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground">Category</span>
          <Tooltip>
            <TooltipTrigger render={<span className="text-foreground underline decoration-dotted cursor-help" />}>
              {item.category.charAt(0) + item.category.slice(1).toLowerCase()}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {CATEGORY_TOOLTIPS[item.category] ?? item.category}
            </TooltipContent>
          </Tooltip>

          <span className="text-muted-foreground">Scope</span>
          <span className="text-foreground">
            {item.scope === "FIRM" ? "Firm-wide" : "Analyst-specific"}
          </span>

          {isSearch && (
            <>
              <span className="text-muted-foreground">Created by</span>
              <span className="text-foreground">
                {CREATED_BY_LABELS[item.createdBy ?? "USER"] ?? item.createdBy ?? "You"}
              </span>
              {item.expiresAt && (
                <>
                  <span className="text-muted-foreground">Expires</span>
                  <span className="text-foreground">
                    {new Date(item.expiresAt).toLocaleDateString()}
                  </span>
                </>
              )}
            </>
          )}

          {item.kind === "source" && (
            <>
              {item.qualityScore != null && (
                <>
                  <span className="text-muted-foreground">Quality</span>
                  <Tooltip>
                    <TooltipTrigger render={<span className="text-foreground underline decoration-dotted cursor-help" />}>
                      {item.qualityScore}/5
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Signal scoring weight. Higher quality sources produce higher-scored signals that get prioritized in analyst briefs.
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
              {item.lastCheckedAt && (
                <>
                  <span className="text-muted-foreground">Last checked</span>
                  <span className="text-foreground tabular-nums">
                    {relativeTime(item.lastCheckedAt)}
                  </span>
                </>
              )}
              {item.packs && item.packs.length > 0 && (
                <>
                  <span className="text-muted-foreground">Packs</span>
                  <span className="text-foreground flex items-center gap-1">
                    <Package className="h-3 w-3 text-muted-foreground" />
                    {item.packs.join(", ")}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <Separator />

        {/* Delete */}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="ghost" size="sm" className="w-full text-red-500 hover:text-red-600" />}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete {isSearch ? "search" : "source"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {isSearch ? "search" : "source"}?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove &ldquo;{item.name.slice(0, 60)}&rdquo; from intelligence monitoring.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PopoverContent>
    </Popover>
  );
}

// ── Add Item — Pure ShadCN InputGroup with block-end addon ───────────────────

function AddItemInput({ onRefresh }: { onRefresh: () => void }) {
  const [kind, setKind] = useState<"search" | "source">("search");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("MARKET");
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState("DOMAIN");
  const [qualityScore, setQualityScore] = useState("3");
  const [adding, setAdding] = useState(false);

  const canSubmit = kind === "search"
    ? value.trim().length > 0
    : value.trim().length > 0 && sourceName.trim().length > 0;

  const handleAdd = async () => {
    if (!canSubmit || adding) return;
    setAdding(true);
    try {
      if (kind === "search") {
        const res = await fetch("/api/intelligence/queries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: value.trim(),
            category,
            scope: "FIRM",
            createdBy: "USER",
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Search added");
      } else {
        const res = await fetch("/api/intelligence/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: sourceName.trim(),
            type: sourceType,
            domain: value.trim(),
            category,
            qualityScore: parseInt(qualityScore),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Source added");
      }
      setValue("");
      setSourceName("");
      onRefresh();
    } catch (err) {
      toast.error(`Failed to add ${kind}`);
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <InputGroup className="h-auto">
      {/* Top: the actual input */}
      <InputGroupInput
        placeholder={kind === "search"
          ? "semiconductor supply chain disruptions today..."
          : "seekingalpha.com"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />

      {/* Bottom: controls bar */}
      <InputGroupAddon align="block-end">
        {/* Type selector — icon-only trigger */}
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <Select value={kind} onValueChange={(v) => v && setKind(v as typeof kind)}>
              <SelectTrigger size="sm" chevron={false}>
                {kind === "search" ? (
                  <Search className="h-3.5 w-3.5" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="search">
                  <Search className="h-3.5 w-3.5" /> Search
                </SelectItem>
                <SelectItem value="source">
                  <Globe className="h-3.5 w-3.5" /> Source
                </SelectItem>
              </SelectContent>
            </Select>
          </TooltipTrigger>
          <TooltipContent>{kind === "search" ? "Search query" : "Monitored source"}</TooltipContent>
        </Tooltip>

        {/* Category selector */}
        <Select value={category} onValueChange={(v) => v && setCategory(v)}>
          <SelectTrigger size="sm" chevron={false}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS
              .filter((c) => kind === "source" || !["COMPANY", "SOCIAL"].includes(c.value))
              .map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {/* Source options popover */}
        {kind === "source" && (
          <Popover>
            <PopoverTrigger
              render={<InputGroupButton variant="ghost" size="icon-xs" />}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-64">
              <PopoverHeader>
                <PopoverTitle>Source Options</PopoverTitle>
              </PopoverHeader>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-medium text-muted-foreground block mb-1">
                    Display name
                  </label>
                  <Input
                    placeholder="e.g. Seeking Alpha"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="font-medium text-muted-foreground block mb-1">
                    Source type
                  </label>
                  <Select value={sourceType} onValueChange={(v) => v && setSourceType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DOMAIN">Web domain</SelectItem>
                      <SelectItem value="RSS">RSS feed</SelectItem>
                      <SelectItem value="NEWSLETTER">Newsletter</SelectItem>
                      <SelectItem value="TWITTER">Twitter/X</SelectItem>
                      <SelectItem value="API">API endpoint</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground block mb-1">
                    Quality score
                  </label>
                  <Select value={qualityScore} onValueChange={(v) => v && setQualityScore(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Low reliability</SelectItem>
                      <SelectItem value="2">2 — Fair</SelectItem>
                      <SelectItem value="3">3 — Good</SelectItem>
                      <SelectItem value="4">4 — High reliability</SelectItem>
                      <SelectItem value="5">5 — Premium / official</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground mt-1">
                    Higher quality sources produce higher-weighted signals in analyst briefs.
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Submit button */}
        <Button
          size="sm"
          className="ml-auto"
          onClick={handleAdd}
          disabled={!canSubmit || adding}
        >
          <Plus className="h-3.5 w-3.5" />
          {adding ? "Adding..." : "Add"}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
