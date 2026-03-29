"use client";

import { useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
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
import { Zap, Globe, Database, Cpu, Copy, Check, ChevronDown } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
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
  const single = tool.resources[0];
  const singleMeta = RESOURCE_TYPE_META[single.type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {hasMultiple ? (
          <>
            {/* Multi-resource: tool header + tabs */}
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <ProviderIcon provider={tool.provider} size={16} />
                <code className="text-sm font-mono font-medium">{tool.name}</code>
              </div>
              <DialogTitle className="sr-only">{tool.name}</DialogTitle>
              <DialogDescription>{tool.summary}</DialogDescription>
            </DialogHeader>
            <Tabs defaultValue={tool.resources[0].title}>
              <TabsList>
                {tool.resources.map((r) => (
                  <TabsTrigger key={r.title} value={r.title} className="text-xs">
                    {r.title}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tool.resources.map((r) => (
                <TabsContent key={r.title} value={r.title}>
                  <ResourceTabContent resource={r} />
                </TabsContent>
              ))}
            </Tabs>
          </>
        ) : (
          <>
            {/* Single resource: old-style layout */}
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <ProviderIcon provider={single.source} size={16} />
                <span className="text-sm font-medium">{single.source}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {singleMeta.label}
                </Badge>
              </div>
              <DialogTitle>{single.title}</DialogTitle>
              <DialogDescription>{single.description}</DialogDescription>
            </DialogHeader>
            <ResourceEndpoint resource={single} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** For multi-resource tabs: description + endpoint */
function ResourceTabContent({ resource }: { resource: Resource }) {
  return (
    <div className="space-y-3 pt-1">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {resource.description}
      </p>
      <ResourceEndpoint resource={resource} />
    </div>
  );
}

/** Endpoint bar + example + notes (shared between single and tabbed views) */
function ResourceEndpoint({ resource }: { resource: Resource }) {
  const meta = RESOURCE_TYPE_META[resource.type];
  const TypeIcon = meta.icon;

  return (
    <div className="space-y-3">
      {/* Endpoint bar */}
      <div className="rounded-md border bg-muted/30 px-2.5 py-2 flex items-center gap-1.5">
        <TypeIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <code className="text-[11px] text-foreground break-all flex-1">
          {resource.endpointOrPath}
        </code>
        {resource.type === "api" && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            GET
          </Badge>
        )}
      </div>

      {/* Example */}
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
  onClick,
}: {
  tool: ToolEntry;
  onClick?: () => void;
}) {
  const hasDetail = tool.resources && tool.resources.length > 0;

  // Collect unique providers from resources (or fall back to tool.provider)
  const providers = tool.resources?.length
    ? [...new Set(tool.resources.map((r) => r.source))]
    : [tool.provider];

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={onClick}
        className="w-full text-left px-3 py-2.5 space-y-1.5 hover:bg-accent/30 transition-colors disabled:hover:bg-transparent"
      >
        <code className="text-xs font-mono font-medium">{tool.name}</code>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {tool.summary}
        </p>
        <div className="flex items-center gap-1 flex-wrap pt-0.5">
          {providers.map((p) => (
            <SourcePill key={p} provider={p} />
          ))}
        </div>
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
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  // Lazy-load prompt when collapsible opens
  useEffect(() => {
    if (promptOpen && promptText === null && team.getPrompt) {
      team.getPrompt().then(setPromptText);
    }
  }, [promptOpen, promptText, team]);

  const handleToolClick = useCallback((tool: ToolEntry) => {
    setSelectedTool(tool);
    setDialogOpen(true);
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Prompt (collapsible) */}
      {(team.getPrompt || team.promptSource) && (
        <>
          <Separator />
          <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-2 w-full text-left py-1 group"
                />
              }
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 flex-1">
                System Prompt
                {team.promptSource && (
                  <span className="ml-1.5 normal-case tracking-normal font-normal text-muted-foreground/40">
                    {team.promptSource}
                  </span>
                )}
              </p>
              <ChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform ${promptOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {team.getPrompt ? (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (promptText) {
                          navigator.clipboard.writeText(promptText);
                          setPromptCopied(true);
                          setTimeout(() => setPromptCopied(false), 2000);
                        }
                      }}
                      disabled={!promptText}
                    >
                      {promptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {promptCopied ? "Copied" : "Copy prompt"}
                    </Button>
                  </div>
                  {promptText ? (
                    <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2">
                      <Markdown variant="compact">{promptText}</Markdown>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Loading prompt...</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">
                  Prompt defined in <code className="text-[11px]">{team.promptSource}</code>
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      <ToolDetailDialog
        tool={selectedTool}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

// ── Workflow step card (for /agent-workflow page) ──────────────────────────

export function WorkflowStepCard({
  team,
  onOpenSheet,
}: {
  team: Team;
  onOpenSheet: () => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{team.title}</span>
            {team.model && (
              <Badge variant="secondary" className="text-[10px]">{team.model}</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">{team.schedule}</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
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
                  className="shrink-0 p-1.5 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground mt-0.5"
                />
              }
            >
              <SidebarOpenIcon />
            </TooltipTrigger>
            <TooltipContent side="left">View details</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  );
}

// ── Flow connector ─────────────────────────────────────────────────────────

export function FlowConnector() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-4 bg-border" />
      <div className="h-1.5 w-1.5 rounded-full border border-border bg-background" />
      <div className="w-px h-4 bg-border" />
    </div>
  );
}
