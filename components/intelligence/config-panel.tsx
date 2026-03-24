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
  InputGroupText,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Search,
  Globe,
  Info,
  Clock,
  SlidersHorizontal,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IntelligenceQuery, Source, SourcePack } from "./types";
import { relativeTime } from "./types";

// ── Logos ─────────────────────────────────────────────────────────────────────

function PerplexityLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 1L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-4zm0 2.18l6 3v5.82c0 4.53-3.13 8.74-6 9.94-2.87-1.2-6-5.41-6-9.94V6.18l6-3zM11 7v6H7l5 7v-6h4l-5-7z" />
    </svg>
  );
}

function FirecrawlLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2c-1.5 3-4 5-4 8 0 2.21 1.79 4 4 4s4-1.79 4-4c0-3-2.5-5-4-8zm0 10c-1.1 0-2-.9-2-2 0-1.5 1-2.8 2-4.2 1 1.4 2 2.7 2 4.2 0 1.1-.9 2-2 2zm-4 4c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-2c0-.55-.45-1-1-1H8z" />
    </svg>
  );
}

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

// ── Category tooltips ────────────────────────────────────────────────────────

const CATEGORY_TOOLTIPS: Record<string, string> = {
  MARKET: "Broad market-level intelligence — indices, macro data, overall sentiment",
  SECTOR: "Industry/sector-specific monitoring — e.g. tech, healthcare, energy",
  TICKER: "Individual stock-level queries or sources for specific companies",
  THEMATIC: "Cross-cutting themes — e.g. AI, tariffs, supply chain trends",
  EVENT: "Time-bound events — earnings, IPOs, FDA decisions, M&A announcements",
  COMPANY: "Company-specific source — covers one company's filings, news, etc.",
  SOCIAL: "Social media / sentiment — StockTwits, Reddit, Twitter/X chatter",
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
  const [categoryFilter, setCategoryFilter] = useState("all");

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
      if (search) {
        const q = search.toLowerCase();
        const searchable = `${item.name} ${item.detail ?? ""} ${item.domain ?? ""}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, kindFilter, categoryFilter, search]);

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

  const searchCount = allItems.filter((i) => i.kind === "search").length;
  const sourceCount = allItems.filter((i) => i.kind === "source").length;
  const hasFilters = kindFilter !== "all" || categoryFilter !== "all" || search !== "";

  return (
    <TooltipProvider>
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Add new — InputGroup block-end pattern */}
        <AddItemInput onRefresh={onRefresh} />

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={kindFilter} onValueChange={(v) => v && setKindFilter(v as typeof kindFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types ({allItems.length})</SelectItem>
              <SelectItem value="search">Searches ({searchCount})</SelectItem>
              <SelectItem value="source">Sources ({sourceCount})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
            <SelectTrigger>
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
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setKindFilter("all"); setCategoryFilter("all"); setSearch(""); }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Results */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {allItems.length} items
        </p>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Name</TableHead>
              <TableHead className="w-16">Scope</TableHead>
              <TableHead className="w-14" />
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
    <TableRow>
      {/* Colored type icon */}
      <TableCell>
        <div
          className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center",
            item.kind === "search"
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "bg-orange-500/10 text-orange-600 dark:text-orange-400"
          )}
        >
          {item.kind === "search" ? (
            <Search className="h-3.5 w-3.5" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
        </div>
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

// ── Detail Popover ───────────────────────────────────────────────────────────

function ItemDetailPopover({
  item,
  onDelete,
}: {
  item: UnifiedItem;
  onDelete: () => void;
}) {
  const isSearch = item.kind === "search";

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" />}
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2">
            <div
              className={cn(
                "h-6 w-6 rounded-md flex items-center justify-center shrink-0",
                isSearch
                  ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  : "bg-orange-500/10 text-orange-600 dark:text-orange-400"
              )}
            >
              {isSearch ? <Search className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            </div>
            <span>{isSearch ? "Search Query" : "Monitored Source"}</span>
          </PopoverTitle>
        </PopoverHeader>

        {/* Name */}
        <div className="text-xs">
          <p className="font-medium text-foreground">{item.name}</p>
          {item.detail && (
            <p className="text-muted-foreground mt-0.5">{item.detail}</p>
          )}
        </div>

        <Separator />

        {/* Trigger + how it works */}
        <div className="text-xs space-y-2">
          <div className="flex items-center gap-2">
            {isSearch ? (
              <PerplexityLogo className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <FirecrawlLogo className="h-4 w-4 text-orange-500 shrink-0" />
            )}
            <span className="font-medium text-foreground">
              {isSearch ? "Market Sweep" : "Source Pack Monitor"}
            </span>
            <span className="text-muted-foreground ml-auto tabular-nums">
              {isSearch ? "6:30 AM ET" : "7:15 AM ET"}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {isSearch
              ? "This query runs as a Perplexity Sonar search every weekday morning. Results are parsed into signals, deduplicated, then routed to matching analysts based on their sectors and watchlist."
              : "This domain is checked for new content via Perplexity Sonar domain search. High-value pages get full text extraction via Firecrawl. Results become signals routed to matching analysts."}
          </p>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {/* Category with tooltip */}
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

          {!isSearch && (
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
  const [kind, setKind] = useState<ItemKind>("search");
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
        {/* Type selector */}
        <Select value={kind} onValueChange={(v) => v && setKind(v as ItemKind)}>
          <SelectTrigger className="w-[110px] h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="search">Search</SelectItem>
            <SelectItem value="source">Source</SelectItem>
          </SelectContent>
        </Select>

        {/* Category selector */}
        <Select value={category} onValueChange={(v) => v && setCategory(v)}>
          <SelectTrigger className="w-[110px] h-7">
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
        <InputGroupButton
          variant="default"
          size="sm"
          className="ml-auto"
          onClick={handleAdd}
          disabled={!canSubmit || adding}
        >
          <Plus className="h-3.5 w-3.5" />
          {adding ? "Adding..." : `Add ${kind}`}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
