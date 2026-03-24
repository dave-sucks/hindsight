"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  Globe,
  Package,
  Clock,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import type { IntelligenceQuery, Source, SourcePack } from "./types";

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
  return (
    <TooltipProvider>
      <div className="space-y-6">
        <QueriesSection queries={queries} onRefresh={onRefresh} />
        <Separator />
        <SourcesSection sources={sources} onRefresh={onRefresh} />
        <Separator />
        <PacksSection packs={packs} />
      </div>
    </TooltipProvider>
  );
}

// ── Queries Section ─────────────────────────────────────────────────────────

function QueriesSection({
  queries,
  onRefresh,
}: {
  queries: IntelligenceQuery[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [newQuery, setNewQuery] = useState("");
  const [newCategory, setNewCategory] = useState("MARKET");

  const firmQueries = queries.filter((q) => q.scope === "FIRM");
  const analystQueries = queries.filter((q) => q.scope === "ANALYST");

  const addQuery = async () => {
    if (!newQuery.trim()) return;
    try {
      const res = await fetch("/api/intelligence/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: newQuery.trim(),
          category: newCategory,
          scope: "FIRM",
          createdBy: "USER",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewQuery("");
      toast.success("Query added");
      onRefresh();
    } catch (err) {
      toast.error("Failed to add query");
      console.error(err);
    }
  };

  const toggleQuery = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/intelligence/queries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], enabled }),
      });
      onRefresh();
    } catch (err) {
      toast.error("Failed to toggle query");
      console.error(err);
    }
  };

  const deleteQuery = async (id: string) => {
    try {
      await fetch(`/api/intelligence/queries?id=${id}`, { method: "DELETE" });
      toast.success("Query deleted");
      onRefresh();
    } catch (err) {
      toast.error("Failed to delete query");
      console.error(err);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="w-full justify-start px-0 h-auto py-1" />}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 mr-2 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-2 text-muted-foreground" />
        )}
        <Search className="h-4 w-4 mr-2 text-muted-foreground" />
        <span className="text-sm font-medium">
          Queries
        </span>
        <Badge variant="secondary" className="ml-2">
          {queries.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 pt-3">
          {/* Add form */}
          <div className="flex gap-2">
            <Input
              placeholder="Add a search query..."
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addQuery()}
              className="flex-1"
            />
            <Select value={newCategory} onValueChange={(val) => val && setNewCategory(val)}>
              <SelectTrigger className="w-[130px]">
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
            <Button onClick={addQuery} size="sm" disabled={!newQuery.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Firm queries */}
          {firmQueries.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Firm-Wide ({firmQueries.length})
              </p>
              <div className="space-y-1">
                {firmQueries.map((q) => (
                  <QueryRow
                    key={q.id}
                    query={q}
                    onToggle={toggleQuery}
                    onDelete={deleteQuery}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Analyst queries */}
          {analystQueries.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Analyst-Specific ({analystQueries.length})
              </p>
              <div className="space-y-1">
                {analystQueries.map((q) => (
                  <QueryRow
                    key={q.id}
                    query={q}
                    onToggle={toggleQuery}
                    onDelete={deleteQuery}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Query Row ───────────────────────────────────────────────────────────────

function QueryRow({
  query,
  onToggle,
  onDelete,
}: {
  query: IntelligenceQuery;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <Switch
        checked={query.enabled}
        onCheckedChange={(checked) => onToggle(query.id, checked)}
      />
      <span className="text-sm flex-1 min-w-0 truncate">{query.query}</span>
      <Badge variant="outline">{query.category}</Badge>
      {query.createdBy === "BRIEFING_AGENT" && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Badge variant="secondary">briefing</Badge>
          </TooltipTrigger>
          <TooltipContent>Created by post-run briefing agent</TooltipContent>
        </Tooltip>
      )}
      {query.createdBy === "ANALYST_BUILDER" && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Badge variant="secondary">builder</Badge>
          </TooltipTrigger>
          <TooltipContent>Created during analyst setup</TooltipContent>
        </Tooltip>
      )}
      {query.expiresAt && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Clock className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            Expires {new Date(query.expiresAt).toLocaleDateString()}
          </TooltipContent>
        </Tooltip>
      )}
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          />}
        >
          <Trash2 className="h-3 w-3" />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete query?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &ldquo;{query.query.slice(0, 60)}...&rdquo; from
              the intelligence sweep.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(query.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sources Section ─────────────────────────────────────────────────────────

function SourcesSection({
  sources,
  onRefresh,
}: {
  sources: Source[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newCategory, setNewCategory] = useState("MARKET");

  const addSource = async () => {
    if (!newName.trim() || !newDomain.trim()) return;
    try {
      const res = await fetch("/api/intelligence/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          type: "DOMAIN",
          domain: newDomain.trim(),
          category: newCategory,
          qualityScore: 3,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewName("");
      setNewDomain("");
      toast.success("Source added");
      onRefresh();
    } catch (err) {
      toast.error("Failed to add source");
      console.error(err);
    }
  };

  const toggleSource = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/intelligence/sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      onRefresh();
    } catch (err) {
      toast.error("Failed to toggle source");
      console.error(err);
    }
  };

  const deleteSource = async (id: string) => {
    try {
      await fetch(`/api/intelligence/sources?id=${id}`, { method: "DELETE" });
      toast.success("Source deleted");
      onRefresh();
    } catch (err) {
      toast.error("Failed to delete source");
      console.error(err);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="w-full justify-start px-0 h-auto py-1" />}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 mr-2 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-2 text-muted-foreground" />
        )}
        <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
        <span className="text-sm font-medium">Sources</span>
        <Badge variant="secondary" className="ml-2">
          {sources.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 pt-3">
          {/* Add form */}
          <div className="flex gap-2">
            <Input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-[160px]"
            />
            <Input
              placeholder="domain.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="flex-1"
            />
            <Select value={newCategory} onValueChange={(val) => val && setNewCategory(val)}>
              <SelectTrigger className="w-[120px]">
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
              onClick={addSource}
              size="sm"
              disabled={!newName.trim() || !newDomain.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Source list */}
          <div className="space-y-1">
            {sources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                onToggle={toggleSource}
                onDelete={deleteSource}
              />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Source Row ───────────────────────────────────────────────────────────────

function SourceRow({
  source,
  onToggle,
  onDelete,
}: {
  source: Source;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <Switch
        checked={source.enabled}
        onCheckedChange={(checked) => onToggle(source.id, checked)}
      />
      <span className="text-sm font-medium min-w-0">{source.name}</span>
      {source.domain && (
        <span className="text-xs text-muted-foreground truncate">
          {source.domain}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <Badge variant="outline">{source.category}</Badge>
        {/* Quality stars */}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <span className="flex items-center gap-0.5">
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  className={`h-2.5 w-2.5 ${i < source.qualityScore ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"}`}
                />
              ))}
            </span>
          </TooltipTrigger>
          <TooltipContent>Quality: {source.qualityScore}/5</TooltipContent>
        </Tooltip>
        {source.lastCheckedAt && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Clock className="h-3 w-3 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              Last checked: {new Date(source.lastCheckedAt).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        )}
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            />}
          >
            <Trash2 className="h-3 w-3" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete source?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove {source.name} ({source.domain}) from intelligence monitoring.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(source.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ── Packs Section ───────────────────────────────────────────────────────────

function PacksSection({ packs }: { packs: SourcePack[] }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="w-full justify-start px-0 h-auto py-1" />}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 mr-2 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-2 text-muted-foreground" />
        )}
        <Package className="h-4 w-4 mr-2 text-muted-foreground" />
        <span className="text-sm font-medium">Source Packs</span>
        <Badge variant="secondary" className="ml-2">
          {packs.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 pt-3">
          {packs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No source packs configured. Create analysts with the AI builder to auto-generate packs.
            </p>
          )}
          {packs.map((pack) => (
            <Card key={pack.id} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">{pack.name}</span>
                <Badge variant="outline">{pack.scope}</Badge>
              </div>
              <div className="space-y-1">
                {pack.sources.map((ps) => (
                  <div
                    key={ps.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="flex items-center gap-0.5">
                      {Array.from({ length: 3 }, (_, i) => (
                        <span
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full ${i < ps.priority ? "bg-foreground" : "bg-muted-foreground/30"}`}
                        />
                      ))}
                    </span>
                    <span>{ps.source.name}</span>
                    {ps.source.domain && (
                      <span className="text-muted-foreground/60">
                        {ps.source.domain}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
