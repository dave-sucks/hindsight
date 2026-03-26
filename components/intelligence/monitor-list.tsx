"use client";

import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  Lock,
  BarChart3,
  CalendarDays,
  Briefcase,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Monitor } from "./types";
import {
  relativeTime,
  MONITOR_TYPE_CONFIG,
  MONITOR_METHOD_CONFIG,
  ORIGIN_LABELS,
} from "./types";
import { PerplexityLogo, FirecrawlLogo, FinnhubLogo, FmpLogo } from "./icons";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "MARKET", label: "Market" },
  { value: "SECTOR", label: "Sector" },
  { value: "TICKER", label: "Ticker" },
  { value: "THEMATIC", label: "Thematic" },
  { value: "EVENT", label: "Event" },
  { value: "COMPANY", label: "Company" },
  { value: "SOCIAL", label: "Social" },
];

// ── Monitor List ────────────────────────────────────────────────────────────

interface MonitorListProps {
  monitors: Monitor[];
  onRefresh: () => void;
}

export function MonitorList({ monitors, onRefresh }: MonitorListProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const categories = useMemo(() => {
    const set = new Set(monitors.map((m) => m.category));
    return Array.from(set).sort();
  }, [monitors]);

  const filtered = useMemo(() => {
    return monitors.filter((m) => {
      if (typeFilter !== "ALL" && m.type !== typeFilter) return false;
      if (categoryFilter !== "ALL" && m.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = `${m.name} ${getMonitorDetail(m)}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [monitors, typeFilter, categoryFilter, search]);

  // Separate built-in from user monitors
  const builtInMonitors = useMemo(
    () => filtered.filter((m) => m.builtIn),
    [filtered]
  );
  const userMonitors = useMemo(
    () => filtered.filter((m) => !m.builtIn),
    [filtered]
  );

  const toggleMonitor = useCallback(
    async (monitor: Monitor) => {
      try {
        await fetch("/api/intelligence/monitors", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: monitor.id, enabled: !monitor.enabled }),
        });
        onRefresh();
      } catch {
        toast.error("Failed to toggle monitor");
      }
    },
    [onRefresh]
  );

  const deleteMonitor = useCallback(
    async (monitor: Monitor) => {
      try {
        await fetch(`/api/intelligence/monitors?id=${monitor.id}`, {
          method: "DELETE",
        });
        toast.success("Monitor deleted");
        onRefresh();
      } catch {
        toast.error("Failed to delete monitor");
      }
    },
    [onRefresh]
  );

  const hasFilters =
    typeFilter !== "ALL" || categoryFilter !== "ALL" || search !== "";

  return (
    <TooltipProvider>
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Add new monitor */}
        <AddMonitorInput onRefresh={onRefresh} />

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search monitors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => v && setTypeFilter(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Type</SelectItem>
              {Object.entries(MONITOR_TYPE_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={categoryFilter}
            onValueChange={(v) => v && setCategoryFilter(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTypeFilter("ALL");
                setCategoryFilter("ALL");
                setSearch("");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Results count */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} monitors
        </p>

        {/* Built-in monitors */}
        {builtInMonitors.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Built-in
            </p>
            <Table>
              <TableBody>
                {builtInMonitors.map((monitor) => (
                  <MonitorRow
                    key={monitor.id}
                    monitor={monitor}
                    onToggle={() => toggleMonitor(monitor)}
                    onDelete={() => deleteMonitor(monitor)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* User monitors */}
        {userMonitors.length > 0 && (
          <div className="space-y-1">
            {builtInMonitors.length > 0 && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Custom
              </p>
            )}
            <Table>
              <TableBody>
                {userMonitors.map((monitor) => (
                  <MonitorRow
                    key={monitor.id}
                    monitor={monitor}
                    onToggle={() => toggleMonitor(monitor)}
                    onDelete={() => deleteMonitor(monitor)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No monitors match your filters
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Monitor Row ──────────────────────────────────────────────────────────────

function MonitorRow({
  monitor,
  onToggle,
  onDelete,
}: {
  monitor: Monitor;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [tickersOpen, setTickersOpen] = useState(false);
  const detail = getMonitorDetail(monitor);
  const hasTickers =
    (monitor.type === "PORTFOLIO" || monitor.type === "WATCHLIST") &&
    monitor.monitoredTickers &&
    monitor.monitoredTickers.length > 0;

  return (
    <>
      <TableRow>
        {/* Type icon */}
        <TableCell>
          <MonitorTypeIcon type={monitor.type} method={monitor.method} />
        </TableCell>

        {/* Provider logo */}
        <TableCell>
          <ProviderLogo method={monitor.method} />
        </TableCell>

        {/* Name + detail */}
        <TableCell>
          <div className="min-w-0">
            <p
              className={cn(
                "text-sm truncate",
                !monitor.enabled && "text-muted-foreground"
              )}
            >
              {monitor.name}
            </p>
            {detail && (
              <p className="text-xs text-muted-foreground truncate">
                {detail}
              </p>
            )}
            {hasTickers && (
              <Collapsible open={tickersOpen} onOpenChange={setTickersOpen}>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 py-0.5"
                    />
                  }
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {monitor.monitoredTickers!.length} tickers
                  </span>
                  {tickersOpen ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-1" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground ml-1" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {monitor.monitoredTickers!.map((t) => (
                      <Tooltip key={t.ticker}>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <Badge variant="secondary">${t.ticker}</Badge>
                        </TooltipTrigger>
                        {t.reason && (
                          <TooltipContent>{t.reason}</TooltipContent>
                        )}
                      </Tooltip>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </TableCell>

        {/* Scope */}
        <TableCell>
          <span className="text-xs text-muted-foreground">
            {monitor.scope === "FIRM"
              ? "Firm"
              : monitor.analyst?.name ?? "Analyst"}
          </span>
        </TableCell>

        {/* Today's findings */}
        <TableCell>
          <span className="text-xs text-muted-foreground tabular-nums">
            {monitor._count.signals}
          </span>
        </TableCell>

        {/* Enabled toggle */}
        <TableCell>
          <Switch checked={monitor.enabled} onCheckedChange={onToggle} />
        </TableCell>

        {/* Info / actions */}
        <TableCell>
          <MonitorInfoPopover
            monitor={monitor}
            onDelete={onDelete}
          />
        </TableCell>
      </TableRow>
    </>
  );
}

// ── Monitor Type Icon ───────────────────────────────────────────────────────

function MonitorTypeIcon({
  type,
  method,
}: {
  type: string;
  method: string;
}) {
  if (type === "SEARCH") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-brand-blue/10 text-brand-blue">
        <Search className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (type === "DOMAIN") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-brand-orange/10 text-brand-orange">
        <Globe className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (type === "API") {
    if (method === "fmp") {
      return (
        <div className="h-7 w-7 rounded-md flex items-center justify-center bg-purple-500/10 text-purple-500">
          <BarChart3 className="h-3.5 w-3.5" />
        </div>
      );
    }
    if (method === "finnhub") {
      return (
        <div className="h-7 w-7 rounded-md flex items-center justify-center bg-teal-500/10 text-teal-500">
          <CalendarDays className="h-3.5 w-3.5" />
        </div>
      );
    }
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-purple-500/10 text-purple-500">
        <BarChart3 className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (type === "PORTFOLIO") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-emerald-500/10 text-emerald-500">
        <Briefcase className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (type === "WATCHLIST") {
    return (
      <div className="h-7 w-7 rounded-md flex items-center justify-center bg-amber-500/10 text-amber-500">
        <Eye className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="h-7 w-7 rounded-md flex items-center justify-center bg-muted text-muted-foreground">
      <Search className="h-3.5 w-3.5" />
    </div>
  );
}

// ── Provider Logo ────────────────────────────────────────────────────────────

function ProviderLogo({ method }: { method: string }) {
  if (method === "perplexity_sonar") {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <PerplexityLogo className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Perplexity Sonar</TooltipContent>
      </Tooltip>
    );
  }
  if (method === "firecrawl") {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <FirecrawlLogo className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Firecrawl</TooltipContent>
      </Tooltip>
    );
  }
  if (method === "fmp") {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <FmpLogo className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>FMP</TooltipContent>
      </Tooltip>
    );
  }
  if (method === "finnhub") {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <FinnhubLogo className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Finnhub</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="text-[10px] text-muted-foreground">
      {MONITOR_METHOD_CONFIG[method]?.label ?? method}
    </span>
  );
}

// ── Info Popover ─────────────────────────────────────────────────────────────

function MonitorInfoPopover({
  monitor,
  onDelete,
}: {
  monitor: Monitor;
  onDelete: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" />}>
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80">
        {/* Visual header */}
        <div className="pb-1">
          <MonitorVisualHeader monitor={monitor} />
        </div>

        <Separator />

        {/* How it works */}
        <div className="text-xs space-y-2">
          <div className="flex items-center gap-2">
            <ProviderLogo method={monitor.method} />
            <span className="font-medium text-foreground">
              {MONITOR_METHOD_CONFIG[monitor.method]?.label ?? monitor.method}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {getMonitorExplanation(monitor)}
          </p>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground">Category</span>
          <span className="text-foreground">
            {monitor.category.charAt(0) +
              monitor.category.slice(1).toLowerCase()}
          </span>

          <span className="text-muted-foreground">Scope</span>
          <span className="text-foreground">
            {monitor.scope === "FIRM"
              ? "Firm-wide"
              : monitor.analyst?.name ?? "Analyst-specific"}
          </span>

          <span className="text-muted-foreground">Origin</span>
          <span className="text-foreground">
            {ORIGIN_LABELS[monitor.origin] ?? monitor.origin}
          </span>

          {monitor.lastRunAt && (
            <>
              <span className="text-muted-foreground">Last run</span>
              <span className="text-foreground tabular-nums">
                {relativeTime(monitor.lastRunAt)}
              </span>
            </>
          )}

          {monitor.expiresAt && (
            <>
              <span className="text-muted-foreground">Expires</span>
              <span className="text-foreground">
                {new Date(monitor.expiresAt).toLocaleDateString()}
              </span>
            </>
          )}
        </div>

        {/* Monitored tickers for PORTFOLIO/WATCHLIST */}
        {(monitor.type === "PORTFOLIO" || monitor.type === "WATCHLIST") &&
          monitor.monitoredTickers &&
          monitor.monitoredTickers.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Monitored Tickers
                </p>
                <div className="flex flex-wrap gap-1">
                  {monitor.monitoredTickers.map((t) => (
                    <Tooltip key={t.ticker}>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Badge variant="secondary">${t.ticker}</Badge>
                      </TooltipTrigger>
                      {t.reason && (
                        <TooltipContent>{t.reason}</TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              </div>
            </>
          )}

        {/* Delete button (non-builtIn only) */}
        {!monitor.builtIn && (
          <>
            <Separator />
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-red-500 hover:text-red-600"
                  />
                }
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete monitor
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete monitor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Remove &ldquo;{monitor.name.slice(0, 60)}&rdquo; from
                    intelligence monitoring.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Visual Header ────────────────────────────────────────────────────────────

function MonitorVisualHeader({ monitor }: { monitor: Monitor }) {
  const config = monitor.config as Record<string, unknown> | null;

  if (monitor.type === "SEARCH") {
    const query = (config?.query as string) ?? monitor.name;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm text-foreground truncate">{query}</p>
      </div>
    );
  }

  if (monitor.type === "DOMAIN") {
    const domain = (config?.domain as string) ?? monitor.name;
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">{monitor.name}</p>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground font-mono truncate">
            {domain}
          </p>
        </div>
      </div>
    );
  }

  if (monitor.type === "API") {
    const endpoint = (config?.endpoint as string) ?? monitor.name;
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">{monitor.name}</p>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono">
          <Badge variant="secondary">GET</Badge>
          <p className="text-xs text-foreground truncate">{endpoint}</p>
        </div>
      </div>
    );
  }

  if (monitor.type === "PORTFOLIO") {
    const tickerCount = monitor.monitoredTickers?.length ?? 0;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">{monitor.name}</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tickerCount} tickers
        </span>
      </div>
    );
  }

  if (monitor.type === "WATCHLIST") {
    const tickerCount = monitor.monitoredTickers?.length ?? 0;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">{monitor.name}</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tickerCount} tickers
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <p className="text-sm text-foreground truncate">{monitor.name}</p>
    </div>
  );
}

// ── Add Monitor Input ───────────────────────────────────────────────────────

type AddKind = "search" | "domain";

function AddMonitorInput({ onRefresh }: { onRefresh: () => void }) {
  const [kind, setKind] = useState<AddKind>("search");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("MARKET");
  const [adding, setAdding] = useState(false);

  const canSubmit = value.trim().length > 0;

  const handleAdd = async () => {
    if (!canSubmit || adding) return;
    setAdding(true);
    try {
      const body =
        kind === "search"
          ? {
              name: value.trim(),
              type: "SEARCH",
              method: "perplexity_sonar",
              config: { query: value.trim() },
              category,
              scope: "FIRM",
            }
          : {
              name: value.trim(),
              type: "DOMAIN",
              method: "firecrawl",
              config: { domain: value.trim() },
              category,
              scope: "FIRM",
            };

      const res = await fetch("/api/intelligence/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${kind === "search" ? "Search" : "Domain"} monitor added`);
      setValue("");
      onRefresh();
    } catch (err) {
      toast.error(`Failed to add monitor`);
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <InputGroup className="h-auto">
      <InputGroupInput
        placeholder={
          kind === "search"
            ? "semiconductor supply chain disruptions today..."
            : "seekingalpha.com"
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      />
      <InputGroupAddon align="block-end">
        {/* Type selector */}
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <Select
              value={kind}
              onValueChange={(v) => v && setKind(v as AddKind)}
            >
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
                <SelectItem value="domain">
                  <Globe className="h-3.5 w-3.5" /> Domain
                </SelectItem>
              </SelectContent>
            </Select>
          </TooltipTrigger>
          <TooltipContent>
            {kind === "search" ? "Search query" : "Monitored domain"}
          </TooltipContent>
        </Tooltip>

        {/* Category selector */}
        <Select
          value={category}
          onValueChange={(v) => v && setCategory(v)}
        >
          <SelectTrigger size="sm" chevron={false}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Submit */}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMonitorDetail(monitor: Monitor): string {
  const config = monitor.config as Record<string, unknown> | null;
  if (monitor.type === "SEARCH") {
    return (config?.query as string) ?? "";
  }
  if (monitor.type === "DOMAIN") {
    return (config?.domain as string) ?? "";
  }
  if (monitor.type === "API") {
    return (config?.endpoint as string) ?? "";
  }
  if (monitor.type === "PORTFOLIO" || monitor.type === "WATCHLIST") {
    const count = monitor.monitoredTickers?.length ?? 0;
    return `${count} tickers`;
  }
  return "";
}

function getMonitorExplanation(monitor: Monitor): string {
  if (monitor.type === "SEARCH") {
    return "This query runs as a Perplexity Sonar search every weekday morning. Results are parsed into signals, deduplicated, then routed to matching analysts.";
  }
  if (monitor.type === "DOMAIN") {
    return "This domain is checked for new content via Perplexity Sonar domain search. High-value pages get full text extraction via Firecrawl.";
  }
  if (monitor.type === "API" && monitor.method === "fmp") {
    return "This FMP API endpoint is called during the market sweep to pull structured data (market movers, analyst targets, filings). Results become aggregate signals.";
  }
  if (monitor.type === "API" && monitor.method === "finnhub") {
    return "This Finnhub API endpoint is called during the market sweep to pull structured data (earnings calendar, company metrics). Results become aggregate signals.";
  }
  if (monitor.type === "PORTFOLIO") {
    return "Monitors all open positions across analysts. Checks current prices and recent news for each ticker, generating alerts for stop-loss proximity, target hits, and material news.";
  }
  if (monitor.type === "WATCHLIST") {
    return "Monitors all watchlist items across analysts. Searches for recent developments and catalysts for each ticker, generating signals when new information is found.";
  }
  return "Monitors for market intelligence and generates signals for analyst review.";
}
