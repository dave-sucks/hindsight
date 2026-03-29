"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronRight, Zap, Globe, Database, Cpu } from "lucide-react";
import { ProviderIcon } from "@/components/chat/SourceChip";
import type { Team, ToolEntry, SubStep, Resource, ResourceType } from "@/lib/agent/workflow-registry";

// ── Resource type config ──────────────────────────────────────────────────

const RESOURCE_TYPE_META: Record<ResourceType, { icon: typeof Zap; label: string }> = {
  api: { icon: Zap, label: "API" },
  website: { icon: Globe, label: "Scraper" },
  db: { icon: Database, label: "Database" },
  internal: { icon: Cpu, label: "Internal" },
};

// ── Sidebar open icon (from user's SVG) ────────────────────────────────────

export function SidebarOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M2 8C2 4.68629 4.68629 2 8 2H10V22H8C4.68629 22 2 19.3137 2 16V8Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Tool detail dialog ────────────────────────────────────────────────────

function ToolDetailDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: ToolEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!tool || !tool.resources?.length) return null;

  const hasMultiple = tool.resources.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <ProviderIcon provider={tool.provider} size={16} />
            <code className="text-sm font-mono font-medium">{tool.name}</code>
          </div>
          <DialogTitle className="sr-only">{tool.name}</DialogTitle>
          <DialogDescription>{tool.summary}</DialogDescription>
        </DialogHeader>

        {hasMultiple ? (
          <Tabs defaultValue={tool.resources[0].title}>
            <TabsList className="w-full">
              {tool.resources.map((r) => (
                <TabsTrigger key={r.title} value={r.title} className="text-xs flex-1">
                  {r.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tool.resources.map((r) => (
              <TabsContent key={r.title} value={r.title}>
                <ResourceDetail resource={r} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <ResourceDetail resource={tool.resources[0]} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResourceDetail({ resource }: { resource: Resource }) {
  const meta = RESOURCE_TYPE_META[resource.type];
  const TypeIcon = meta.icon;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={resource.source} size={14} />
        <span className="text-xs text-muted-foreground flex-1">{resource.description}</span>
        <Badge variant="secondary" className="text-[10px]">{meta.label}</Badge>
      </div>

      {/* Endpoint */}
      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <TypeIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          <code className="text-[11px] text-foreground break-all">{resource.endpointOrPath}</code>
        </div>
      </div>

      {/* Example output */}
      {resource.exampleOutput && (
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Example
          </span>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
            {resource.exampleOutput}
          </p>
        </div>
      )}

      {/* Notes */}
      {resource.notes?.length ? (
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Notes
          </span>
          <ul className="mt-0.5 space-y-0">
            {resource.notes.map((note, i) => (
              <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                · {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────

function ToolCard({
  tool,
  onClick,
}: {
  tool: ToolEntry;
  onClick?: () => void;
}) {
  const hasDetail = tool.resources && tool.resources.length > 0;

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={onClick}
        className="flex items-start gap-2 w-full text-left px-3 py-2.5 hover:bg-accent/30 transition-colors disabled:hover:bg-transparent group"
      >
        <ProviderIcon provider={tool.provider} size={14} />
        <div className="flex-1 min-w-0">
          <code className="text-xs font-mono font-medium">{tool.name}</code>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {tool.summary}
          </p>
        </div>
        {hasDetail && (
          <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
        )}
      </button>
    </Card>
  );
}

// ── Sub-step row ───────────────────────────────────────────────────────────

function SubStepRow({ step, index }: { step: SubStep; index: number }) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      {step.time ? (
        <Badge variant="outline" className="shrink-0 text-[10px] font-mono tabular-nums mt-0.5">
          {step.time}
        </Badge>
      ) : (
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums w-4 shrink-0 text-center mt-0.5">
          {index + 1}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium">{step.title}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {step.summary}
        </p>
      </div>
    </div>
  );
}

// ── Team sheet content ─────────────────────────────────────────────────────
// Renders a team's full content for use inside a sheet.

export function TeamSheetContent({ team }: { team: Team }) {
  const [selectedTool, setSelectedTool] = useState<ToolEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleToolClick = useCallback((tool: ToolEntry) => {
    setSelectedTool(tool);
    setDialogOpen(true);
  }, []);

  const Icon = team.icon;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{team.title}</h2>
          {team.model && (
            <Badge variant="secondary" className="text-[10px]">{team.model}</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">{team.schedule}</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {team.description}
        </p>
      </div>

      <Separator />

      {/* Sub-steps */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-2">
          Steps
        </p>
        <div className="space-y-0.5">
          {team.substeps.map((step, i) => (
            <SubStepRow key={i} step={step} index={i} />
          ))}
        </div>
      </div>

      <Separator />

      {/* Tools */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-2">
          Tools
          <span className="ml-1.5 text-muted-foreground/40">{team.tools.length}</span>
        </p>
        <div className="space-y-1.5">
          {team.tools.map((tool, i) => (
            <ToolCard
              key={i}
              tool={tool}
              onClick={tool.resources?.length ? () => handleToolClick(tool) : undefined}
            />
          ))}
        </div>
      </div>

      <ToolDetailDialog
        tool={selectedTool}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

// ── Workflow step row (for /agent-workflow page) ───────────────────────────

export function WorkflowStepRow({
  team,
  onOpenSheet,
}: {
  team: Team;
  onOpenSheet: () => void;
}) {
  const Icon = team.icon;

  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{team.title}</span>
          {team.model && (
            <Badge variant="secondary" className="text-[10px]">{team.model}</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">{team.schedule}</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {team.summary}
        </p>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onOpenSheet}
                className="shrink-0 p-1.5 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
              />
            }
          >
            <SidebarOpenIcon />
          </TooltipTrigger>
          <TooltipContent side="left">View details</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Flow connector ─────────────────────────────────────────────────────────

export function FlowConnector() {
  return (
    <div className="flex items-center ml-[7px]">
      <div className="w-px h-3 bg-border" />
    </div>
  );
}
