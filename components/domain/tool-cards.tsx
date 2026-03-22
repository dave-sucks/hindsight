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
} from "@/components/ui/input-group";
import { ProviderIcon } from "@/components/chat/SourceChip";
import { ChevronRight, Globe, Database, Cpu, Zap } from "lucide-react";
import {
  STAGES,
  STAGE_META,
  getToolsByStage,
  type ToolDef,
  type Resource,
} from "@/lib/agent/tool-registry";

// ── Resource type config ──────────────────────────────────────────────────

const RESOURCE_TYPE_ICON: Record<Resource["type"], typeof Globe> = {
  api: Zap,
  website: Globe,
  db: Database,
  internal: Cpu,
};

const RESOURCE_TYPE_TOOLTIP: Record<Resource["type"], string> = {
  api: "External API call",
  website: "Web scraper / crawler",
  db: "Database query",
  internal: "Internal function",
};

const RESOURCE_TYPE_LABEL: Record<Resource["type"], string> = {
  api: "API",
  website: "Scraper",
  db: "Database",
  internal: "Internal",
};

// ── Resource detail dialog ────────────────────────────────────────────────

function ResourceDetailDialog({
  resource,
  open,
  onOpenChange,
}: {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!resource) return null;

  const TypeIcon = RESOURCE_TYPE_ICON[resource.type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <ProviderIcon provider={resource.source} size={16} />
            <span className="text-sm font-medium">{resource.source}</span>
            <Badge variant="secondary">{RESOURCE_TYPE_LABEL[resource.type]}</Badge>
          </div>
          <DialogTitle>{resource.title}</DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Endpoint — InputGroup with icon left, kbd right for API */}
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <TypeIcon className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {RESOURCE_TYPE_TOOLTIP[resource.type]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </InputGroupAddon>
            <InputGroupInput readOnly value={resource.endpointOrPath} />
            {resource.type === "api" && (
              <InputGroupAddon align="inline-end">
                <Badge variant="secondary">GET</Badge>
              </InputGroupAddon>
            )}
          </InputGroup>

          {/* Example output */}
          {resource.exampleOutput && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                Example output
              </span>
              <div className="mt-1 rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-foreground leading-relaxed">
                {resource.exampleOutput}
              </div>
            </div>
          )}

          {/* Notes */}
          {resource.notes && resource.notes.length > 0 && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                Notes
              </span>
              <ul className="mt-1 space-y-0.5">
                {resource.notes.map((note, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                    · {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Resource row ──────────────────────────────────────────────────────────

function ResourceRow({
  resource,
  onClick,
}: {
  resource: Resource;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent/50 transition-colors group"
    >
      <ProviderIcon provider={resource.source} size={14} />
      <span className="text-[11px] text-muted-foreground flex-1 min-w-0 truncate">
        {resource.title}
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

// ── Source pill ────────────────────────────────────────────────────────────

function SourcePill({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
      <ProviderIcon provider={provider} size={12} />
      <span className="text-[10px] text-muted-foreground">{provider}</span>
    </span>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────

function ToolCard({
  tool,
  onResourceClick,
}: {
  tool: ToolDef;
  onResourceClick: (resource: Resource) => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 pt-3 pb-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono font-medium">{tool.name}</code>
          {tool.tags?.includes("required") && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Badge variant="outline">required</Badge>
                </TooltipTrigger>
                <TooltipContent side="right">Called every run — part of the fixed workflow sequence</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{tool.summary}</p>
        {tool.sources.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {tool.sources.map((s) => (
              <SourcePill key={s} provider={s} />
            ))}
          </div>
        )}
      </div>
      <Separator />
      <div className="px-1 py-1.5">
        {tool.resources.map((r, i) => (
          <ResourceRow key={i} resource={r} onClick={() => onResourceClick(r)} />
        ))}
      </div>
    </Card>
  );
}

// ── Tool card list ────────────────────────────────────────────────────────

export function ToolCardList() {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleResourceClick = useCallback((resource: Resource) => {
    setSelectedResource(resource);
    setDialogOpen(true);
  }, []);

  const grouped = STAGES
    .map((stage) => ({ stage, tools: getToolsByStage(stage) }))
    .filter((g) => g.tools.length > 0);

  return (
    <div className="space-y-5">
      {grouped.map(({ stage, tools }) => (
        <div key={stage} className="space-y-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{stage}</h3>
              <span className="text-xs text-muted-foreground">
                {tools.length} tool{tools.length !== 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              {STAGE_META[stage].summary}
            </p>
          </div>
          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} onResourceClick={handleResourceClick} />
            ))}
          </div>
        </div>
      ))}

      <ResourceDetailDialog
        resource={selectedResource}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
