"use client";

import { useState, useCallback } from "react";
import { Copy, Check, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  WorkflowStepCard,
  FlowConnector,
  TeamSheetContent,
} from "@/components/domain/team-card";
import { ProviderIcon } from "@/components/chat/SourceChip";
import {
  TEAMS,
  TOOL_REGISTRY,
  exportWorkflowAsMarkdown,
  type Team,
  type RegistryTool,
  type ToolCategory,
  type TeamId,
} from "@/lib/agent/workflow-registry";

// ── Copy button ────────────────────────────────────────────────────────────

function CopyMarkdownButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(exportWorkflowAsMarkdown()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy as markdown"}
    </Button>
  );
}

// ── Category config ────────────────────────────────────────────────────────

const CATEGORY_META: Record<ToolCategory, { label: string; color: string }> = {
  intelligence: { label: "Intelligence", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  research:     { label: "Research",     color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  action:       { label: "Action",       color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  system:       { label: "System",       color: "text-muted-foreground bg-muted border-border" },
};

// ── Agent label map ────────────────────────────────────────────────────────

const AGENT_LABELS: Record<TeamId, string> = {
  builder:     "Builder",
  intelligence: "Intel Pipeline",
  agent:       "Research Agent",
  briefing:    "Briefing Agent",
  evaluation:  "Evaluation",
};

// ── Tool card ──────────────────────────────────────────────────────────────

function ToolCard({ tool, onClick }: { tool: RegistryTool; onClick: () => void }) {
  const catMeta = CATEGORY_META[tool.category];

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-mono text-sm font-medium leading-tight">{tool.name}</span>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${catMeta.color}`}>
          {catMeta.label}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {tool.summary}
      </p>
      <div className="flex items-center justify-between">
        {/* Provider icons */}
        <div className="flex -space-x-1">
          {tool.providers.map((p) => (
            <div
              key={p}
              className="size-4 rounded-full bg-background ring-1 ring-border overflow-hidden flex items-center justify-center"
            >
              <ProviderIcon provider={p} size={12} />
            </div>
          ))}
        </div>
        {/* Agent badges */}
        <div className="flex gap-1 flex-wrap justify-end">
          {tool.agents.map((agentId) => (
            <span
              key={agentId}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground"
            >
              {AGENT_LABELS[agentId]}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Tool detail dialog ──────────────────────────────────────────────────────

function ToolDetailDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: RegistryTool | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!tool) return null;
  const catMeta = CATEGORY_META[tool.category];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base flex items-center gap-2">
            {tool.name}
            <Badge variant="outline" className={`text-[10px] font-sans ${catMeta.color}`}>
              {catMeta.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{tool.summary}</p>

        {/* Providers */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Data Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {tool.providers.map((p) => (
              <div key={p} className="flex items-center gap-1.5 text-xs bg-muted rounded-md px-2 py-1">
                <ProviderIcon provider={p} size={12} />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Used by */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Active In
          </p>
          <div className="flex flex-wrap gap-2">
            {tool.agents.map((agentId) => (
              <span
                key={agentId}
                className="inline-flex items-center rounded-md px-2 py-1 text-xs font-mono bg-muted text-muted-foreground"
              >
                {AGENT_LABELS[agentId]}
              </span>
            ))}
          </div>
        </div>

        {/* Resources */}
        {tool.resources && tool.resources.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Endpoints
            </p>
            <div className="space-y-2">
              {tool.resources.map((r, i) => (
                <div key={i} className="rounded-lg border border-border p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <ProviderIcon provider={r.source} size={12} />
                    {r.title}
                  </div>
                  <p className="text-muted-foreground">{r.description}</p>
                  <code className="block text-[10px] text-muted-foreground bg-muted rounded px-2 py-1 mt-1 font-mono">
                    {r.endpointOrPath}
                  </code>
                  {r.exampleOutput && (
                    <p className="text-muted-foreground/70 italic">{r.exampleOutput}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tools Registry section ─────────────────────────────────────────────────

const CATEGORIES: ToolCategory[] = ["intelligence", "research", "action", "system"];

function ToolsRegistry() {
  const [selectedTool, setSelectedTool] = useState<RegistryTool | null>(null);
  const [filterAgent, setFilterAgent] = useState<TeamId | "all">("all");
  const [filterCategory, setFilterCategory] = useState<ToolCategory | "all">("all");

  const agentIds: Array<TeamId | "all"> = ["all", "builder", "agent"];

  const filtered = TOOL_REGISTRY.filter((t) => {
    const agentMatch = filterAgent === "all" || t.agents.includes(filterAgent);
    const catMatch = filterCategory === "all" || t.category === filterCategory;
    return agentMatch && catMatch;
  });

  const grouped = CATEGORIES.reduce<Record<ToolCategory, RegistryTool[]>>(
    (acc, cat) => {
      acc[cat] = filtered.filter((t) => t.category === cat);
      return acc;
    },
    { intelligence: [], research: [], action: [], system: [] },
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Tools Registry</h2>
        <p className="text-sm text-muted-foreground">
          All {TOOL_REGISTRY.length} tools available to agents. Click any tool to see endpoints and usage.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Agent filter */}
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
          {agentIds.map((id) => (
            <button
              key={id}
              onClick={() => setFilterAgent(id)}
              className={`px-2.5 py-1.5 transition-colors ${
                filterAgent === id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {id === "all" ? "All agents" : AGENT_LABELS[id]}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setFilterCategory("all")}
            className={`px-2.5 py-1.5 transition-colors ${
              filterCategory === "all"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            All types
          </button>
          {CATEGORIES.map((cat) => {
            const meta = CATEGORY_META[cat];
            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1.5 transition-colors ${
                  filterCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tool cards grouped by category */}
      {CATEGORIES.map((cat) => {
        const tools = grouped[cat];
        if (tools.length === 0) return null;
        const meta = CATEGORY_META[cat];
        return (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded border ${meta.color}`}>
                {meta.label}
              </span>
              <span className="text-xs text-muted-foreground">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tools.map((tool) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  onClick={() => setSelectedTool(tool)}
                />
              ))}
            </div>
          </div>
        );
      })}

      <ToolDetailDialog
        tool={selectedTool}
        open={selectedTool !== null}
        onOpenChange={(open) => { if (!open) setSelectedTool(null); }}
      />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentWorkflowPage() {
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);

  return (
    <div className="p-6 space-y-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
          <CopyMarkdownButton />
        </div>
        <p className="text-sm text-muted-foreground">
          5 teams run in a daily loop. Open any step to see its workflow and tools.
        </p>
      </div>

      <Separator />

      {/* Team steps */}
      <div>
        {TEAMS.map((team, i) => (
          <div key={team.id}>
            <WorkflowStepCard
              team={team}
              onOpenSheet={() => setActiveTeam(team)}
            />
            {i < TEAMS.length - 1 && <FlowConnector />}
          </div>
        ))}
      </div>

      <Separator />

      {/* Tools Registry */}
      <ToolsRegistry />

      {/* Team detail sheet */}
      <Sheet
        open={activeTeam !== null}
        onOpenChange={(open: boolean) => { if (!open) setActiveTeam(null); }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:max-w-md overflow-y-auto"
        >
          {activeTeam && (
            <>
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <SheetTitle>{activeTeam.title}</SheetTitle>
                <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
              <div className="px-4 pb-6">
                <TeamSheetContent team={activeTeam} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
