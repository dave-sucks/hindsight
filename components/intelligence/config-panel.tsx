"use client";

import { useState, useMemo } from "react";
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
  TableHead,
  TableHeader,
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
  ArrowRight,
  Clock,
  Zap,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IntelligenceQuery, Source, SourcePack } from "./types";
import { relativeTime } from "./types";

// ── Unified row type ─────────────────────────────────────────────────────────

type ItemKind = "search" | "source";

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
  raw: IntelligenceQuery | Source;
}

function buildUnifiedItems(
  queries: IntelligenceQuery[],
  sources: Source[],
  packs: SourcePack[]
): UnifiedItem[] {
  // Build source→pack name map
  const sourcePackMap = new Map<string, string[]>();
  for (const pack of packs) {
    for (const ps of pack.sources) {
      const existing = sourcePackMap.get(ps.source.id) ?? [];
      existing.push(pack.name);
      sourcePackMap.set(ps.source.id, existing);
    }
  }

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

  return [...queryItems, ...sourceItems];
}

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
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");

  const allItems = useMemo(
    () => buildUnifiedItems(queries, sources, packs),
    [queries, sources, packs]
  );

  const categories = useMemo(() => {
    const set = new Set(allItems.map((i) => i.category));
    return Array.from(set).sort();
  }, [allItems]);

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = `${item.name} ${item.detail ?? ""} ${item.category} ${item.domain ?? ""}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, kindFilter, categoryFilter, scopeFilter, search]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const toggleItem = async (item: UnifiedItem) => {
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

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Add row */}
        <AddItemRow onRefresh={onRefresh} />

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={kindFilter} onValueChange={(v) => v && setKindFilter(v as typeof kindFilter)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="search">Searches</SelectItem>
              <SelectItem value="source">Sources</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={(v) => v && setScopeFilter(v)}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="FIRM">Firm</SelectItem>
              <SelectItem value="ANALYST">Analyst</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results count */}
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {allItems.length} items
        </p>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]" />
              <TableHead>Name</TableHead>
              <TableHead className="w-[90px]">Category</TableHead>
              <TableHead className="w-[70px]">Scope</TableHead>
              <TableHead className="w-[50px]">On</TableHead>
              <TableHead className="w-[30px]" />
              <TableHead className="w-[30px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No items match your filters
                </TableCell>
              </TableRow>
            )}
            {filtered.map((item) => (
              <ConfigRow
                key={`${item.kind}-${item.id}`}
                item={item}
                onToggle={() => toggleItem(item)}
                onDelete={() => deleteItem(item)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
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
    <TableRow className="group">
      {/* Type icon */}
      <TableCell>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            {item.kind === "search" ? (
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {item.kind === "search" ? "Search query — runs via Perplexity Sonar" : "Monitored source domain"}
          </TooltipContent>
        </Tooltip>
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

      {/* Category */}
      <TableCell>
        <Badge variant="outline">{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</Badge>
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
        <ItemDetailPopover item={item} />
      </TableCell>

      {/* Delete */}
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            }
          >
            <Trash2 className="h-3 w-3" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {item.kind === "search" ? "search" : "source"}?</AlertDialogTitle>
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
      </TableCell>
    </TableRow>
  );
}

// ── Detail Popover ───────────────────────────────────────────────────────────

function ItemDetailPopover({ item }: { item: UnifiedItem }) {
  const isSearch = item.kind === "search";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="h-6 w-6" />
        }
      >
        <Info className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5">
            {isSearch ? (
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {isSearch ? "Search Query" : "Monitored Source"}
          </PopoverTitle>
        </PopoverHeader>

        <Separator />

        {/* What it is */}
        <div className="space-y-3 text-xs">
          <div>
            <p className="font-medium text-foreground mb-0.5">
              {item.name}
            </p>
            {item.detail && (
              <p className="text-muted-foreground">{item.detail}</p>
            )}
          </div>

          {/* How it works */}
          <div>
            <p className="font-medium uppercase tracking-wide text-muted-foreground mb-1">
              How it works
            </p>
            {isSearch ? (
              <p className="text-muted-foreground leading-relaxed">
                Executed as a Perplexity Sonar search during the{" "}
                <span className="text-foreground font-medium">Market Sweep</span> job
                (6:30 AM ET weekdays). Results are parsed into Signals, deduplicated,
                then routed to matching analysts by the Signal Router.
              </p>
            ) : (
              <p className="text-muted-foreground leading-relaxed">
                Checked by the{" "}
                <span className="text-foreground font-medium">Source Pack Monitor</span>{" "}
                (7:15 AM ET weekdays). New content detected via domain-filtered Sonar search.
                High-value pages get full extraction via Firecrawl. Results become Signals.
              </p>
            )}
          </div>

          {/* Data flow */}
          <div>
            <p className="font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Data flow
            </p>
            <div className="flex items-center gap-1 text-muted-foreground flex-wrap">
              {isSearch ? (
                <>
                  <span className="text-foreground">Query</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Perplexity Sonar</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Signals</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Router</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Analyst Briefs</span>
                </>
              ) : (
                <>
                  <span className="text-foreground">Domain</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Sonar</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Firecrawl</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Signals</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>Briefs</span>
                </>
              )}
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <MetaRow label="Category" value={item.category} />
            <MetaRow label="Scope" value={item.scope === "FIRM" ? "Firm-wide" : "Analyst-specific"} />
            <MetaRow label="Status" value={item.enabled ? "Active" : "Disabled"} />
            {isSearch && (
              <>
                <MetaRow
                  label="Created by"
                  value={CREATED_BY_LABELS[item.createdBy ?? "USER"] ?? item.createdBy ?? "User"}
                />
                {item.expiresAt && (
                  <MetaRow
                    label="Expires"
                    value={new Date(item.expiresAt).toLocaleDateString()}
                  />
                )}
                <MetaRow label="Trigger" value="Market Sweep (6:30 AM)" />
              </>
            )}
            {!isSearch && (
              <>
                <MetaRow label="Type" value={SOURCE_TYPE_LABELS[item.sourceType ?? "DOMAIN"] ?? item.sourceType ?? "Domain"} />
                {item.qualityScore != null && (
                  <MetaRow label="Quality" value={`${item.qualityScore}/5`} />
                )}
                {item.lastCheckedAt && (
                  <MetaRow label="Last checked" value={relativeTime(item.lastCheckedAt)} />
                )}
                <MetaRow label="Trigger" value="Source Pack Monitor (7:15 AM)" />
                {item.packs && item.packs.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Packs: </span>
                    <span className="text-foreground">{item.packs.join(", ")}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </>
  );
}

const CREATED_BY_LABELS: Record<string, string> = {
  USER: "You",
  BRIEFING_AGENT: "Briefing agent",
  ANALYST_BUILDER: "Analyst builder",
  ANALYST_RUNTIME: "Analyst runtime",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  DOMAIN: "Web domain",
  RSS: "RSS feed",
  NEWSLETTER: "Newsletter",
  TWITTER: "Twitter/X",
  API: "API endpoint",
};

// ── Add Item Row ─────────────────────────────────────────────────────────────

function AddItemRow({ onRefresh }: { onRefresh: () => void }) {
  const [kind, setKind] = useState<ItemKind>("search");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("MARKET");
  const [showOptions, setShowOptions] = useState(false);
  // Source-specific fields
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState("DOMAIN");
  const [qualityScore, setQualityScore] = useState("3");

  const canSubmit = kind === "search"
    ? value.trim().length > 0
    : value.trim().length > 0 && sourceName.trim().length > 0;

  const handleAdd = async () => {
    if (!canSubmit) return;
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
      setShowOptions(false);
      onRefresh();
    } catch (err) {
      toast.error(`Failed to add ${kind}`);
      console.error(err);
    }
  };

  return (
    <div className="space-y-2">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Select value={kind} onValueChange={(v) => v && setKind(v as ItemKind)}>
            <SelectTrigger className="h-6 w-[90px] border-0 shadow-none text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="search">
                <Search className="h-3 w-3 mr-1.5 inline" />
                Search
              </SelectItem>
              <SelectItem value="source">
                <Globe className="h-3 w-3 mr-1.5 inline" />
                Source
              </SelectItem>
            </SelectContent>
          </Select>
        </InputGroupAddon>
        <InputGroupInput
          placeholder={kind === "search" ? "e.g. semiconductor supply chain disruptions..." : "e.g. seekingalpha.com"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <InputGroupAddon align="inline-end">
          <Popover open={showOptions} onOpenChange={setShowOptions}>
            <PopoverTrigger
              render={
                <InputGroupButton variant="ghost" size="icon-xs">
                  <Zap className="h-3.5 w-3.5" />
                </InputGroupButton>
              }
            />
            <PopoverContent side="bottom" align="end" className="w-64">
              <PopoverHeader>
                <PopoverTitle>Options</PopoverTitle>
              </PopoverHeader>
              <Separator />
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-medium uppercase tracking-wide text-muted-foreground block mb-1">
                    Category
                  </label>
                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="SECTOR">Sector</SelectItem>
                      <SelectItem value="TICKER">Ticker</SelectItem>
                      <SelectItem value="THEMATIC">Thematic</SelectItem>
                      <SelectItem value="EVENT">Event</SelectItem>
                      {kind === "source" && (
                        <>
                          <SelectItem value="COMPANY">Company</SelectItem>
                          <SelectItem value="SOCIAL">Social</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {kind === "source" && (
                  <>
                    <div>
                      <label className="font-medium uppercase tracking-wide text-muted-foreground block mb-1">
                        Display name
                      </label>
                      <Input
                        className="h-7 text-xs"
                        placeholder="e.g. Seeking Alpha"
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="font-medium uppercase tracking-wide text-muted-foreground block mb-1">
                        Source type
                      </label>
                      <Select value={sourceType} onValueChange={(v) => v && setSourceType(v)}>
                        <SelectTrigger className="h-7 text-xs">
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
                      <label className="font-medium uppercase tracking-wide text-muted-foreground block mb-1">
                        Quality (1-5)
                      </label>
                      <Select value={qualityScore} onValueChange={(v) => v && setQualityScore(v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 — Low</SelectItem>
                          <SelectItem value="2">2 — Fair</SelectItem>
                          <SelectItem value="3">3 — Good</SelectItem>
                          <SelectItem value="4">4 — High</SelectItem>
                          <SelectItem value="5">5 — Premium</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <InputGroupButton
            variant="default"
            size="xs"
            onClick={handleAdd}
            disabled={!canSubmit}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {/* Hint text */}
      <p className="text-xs text-muted-foreground pl-1">
        {kind === "search"
          ? "Searches run via Perplexity Sonar during the daily Market Sweep (6:30 AM ET)."
          : "Sources are monitored by the Source Pack Monitor (7:15 AM ET). Set name via options."}
      </p>
    </div>
  );
}
