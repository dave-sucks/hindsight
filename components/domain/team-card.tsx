"use client";

import { useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Zap, Globe, Database, Cpu, Copy, Check } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnForwardIcon } from "@hugeicons/core-free-icons";
import { Markdown } from "@/components/ui/markdown";
import { ProviderIcon } from "@/components/chat/SourceChip";
import { WorkflowMarkdown } from "@/components/domain/workflow-markdown";
import { WorkflowSheetProvider } from "@/components/domain/workflow-sheet-context";
import { loadWorkflowDoc } from "@/lib/actions/workflow-doc.actions";
import type { Team, ToolEntry, SubStep, Resource, ResourceType, RegistryTool, ToolCategory, TeamId } from "@/lib/agent/workflow-registry";
import { TOOL_REGISTRY, getTeam } from "@/lib/agent/workflow-registry";

// ── Team label map ─────────────────────────────────────────────────────────

const TEAM_LABELS: Partial<Record<TeamId, string>> = {
  builder:      "Builder",
  agent:        "Research Agent",
  intelligence: "Intel Pipeline",
  briefing:     "Briefing Agent",
  evaluation:   "Evaluation",
};

// ── Resource type config ──────────────────────────────────────────────────

// ── GPT logo ───────────────────────────────────────────────────────────────

function GptLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="currentColor" className={className}>
      <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z" />
    </svg>
  );
}

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
  agents,
}: {
  tool: ToolEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Always-shown: which workflow agents have this tool active */
  agents?: TeamId[];
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  // Reset to first resource when tool changes
  useEffect(() => { setActiveIdx(0); }, [tool]);

  if (!tool || !tool.resources?.length) return null;

  const hasMultiple = tool.resources.length > 1;
  const single = tool.resources[0];
  const singleMeta = RESOURCE_TYPE_META[single.type];
  const active = tool.resources[activeIdx] ?? single;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {hasMultiple ? (
          <>
            {/* Multi-resource: tool header + badge selectors */}
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <ProviderIcon provider={tool.provider} size={16} />
                <code className="text-sm font-mono font-medium">{tool.name}</code>
              </div>
              <DialogTitle className="sr-only">{tool.name}</DialogTitle>
              <DialogDescription>{tool.summary}</DialogDescription>
            </DialogHeader>

            {/* Badge row — scrollable for many resources */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
              {tool.resources.map((r, i) => (
                <button
                  key={r.title}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    i === activeIdx
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent text-muted-foreground border-border hover:bg-accent/50"
                  }`}
                >
                  {r.title}
                </button>
              ))}
            </div>

            <ResourceTabContent resource={active} />
          </>
        ) : (
          <>
            {/* Single resource: source header layout */}
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
        {/* Active in — always shown when agents are known */}
        {agents && agents.length > 0 && (
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
              Active in
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {agents.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                >
                  {TEAM_LABELS[id] ?? id}
                </span>
              ))}
            </div>
          </div>
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

export function ToolCard({
  tool,
  onClick,
  agents,
}: {
  tool: ToolEntry;
  onClick?: () => void;
  /** When provided, agent badges are shown below the provider pills */
  agents?: TeamId[];
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
        <span className="text-xs font-medium">{tool.name}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {tool.summary}
        </p>
        <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {providers.map((p) => (
              <SourcePill key={p} provider={p} />
            ))}
          </div>
          {agents && agents.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {agents.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                >
                  {TEAM_LABELS[id] ?? id}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    </Card>
  );
}

// ── Sub-step row ───────────────────────────────────────────────────────────

function SubStepRow({ step, index }: { step: SubStep; index: number }) {
  return (
    <div className="py-1.5 space-y-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          Step {index + 1}: {step.title}
        </span>
        {step.time && (
          <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
            {step.time}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {step.summary}
      </p>
    </div>
  );
}

// ── Prompt banner + dialog ──────────────────────────────────────────────────

function PromptBanner({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Lazy-load prompt when dialog opens
  useEffect(() => {
    if (open && promptText === null && team.getPrompt) {
      team.getPrompt().then(setPromptText);
    }
  }, [open, promptText, team]);

  const handleCopy = useCallback(() => {
    if (promptText) {
      navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [promptText]);

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-3 w-full text-left px-3 py-2.5 hover:bg-accent/30 transition-colors"
        >
          {/* GPT icon in rounded square */}
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <GptLogo className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{team.title} Prompt</span>
              {team.model && (
                <Badge variant="secondary" className="text-[10px]">{team.model}</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {team.getPrompt
                ? "View the full system prompt sent to the agent"
                : `Defined in ${team.promptSource}`}
            </p>
          </div>
        </button>
      </Card>

      {/* Prompt dialog — full-screen-ish like finding detail */}
      {team.getPrompt && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <GptLogo className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-sm">{team.title} Prompt</DialogTitle>
                    {team.model && (
                      <Badge variant="secondary" className="text-[10px]">{team.model}</Badge>
                    )}
                  </div>
                  {team.promptSource && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      <code>{team.promptSource}</code>
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={!promptText}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <DialogDescription className="sr-only">
                System prompt for {team.title}
              </DialogDescription>
            </DialogHeader>

            {/* Scrollable prompt content */}
            <div className="-mx-4 no-scrollbar max-h-[60vh] overflow-y-auto px-4">
              {promptText ? (
                <div className="rounded-lg border bg-muted/20 px-4 py-3">
                  <Markdown variant="compact">{promptText}</Markdown>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">Loading prompt...</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Team sheet content ─────────────────────────────────────────────────────
// Renders a team's full content for use inside a sheet.

export function TeamSheetContent({ team }: { team: Team }) {
  const [selectedTool, setSelectedTool] = useState<ToolEntry | null>(null);
  const [selectedToolAgents, setSelectedToolAgents] = useState<TeamId[] | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Markdown doc (Notion-style content per agent). When this returns non-null
  // for the team's id, the sheet renders the doc body in place of the legacy
  // description + substeps blocks. Migration is per-agent — the legacy path
  // still works for any team without a markdown file yet.
  const [doc, setDoc] = useState<{ body: string; summary: string | null } | null>(null);
  const [docLoaded, setDocLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadWorkflowDoc(team.id).then((result) => {
      if (cancelled) return;
      setDoc(result);
      setDocLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [team.id]);

  const upstreamSource = team.upstream ? getTeam(team.upstream.teamId) : null;
  const showSchedule = isMeaningfulSchedule(team.schedule);
  const hasMetadata = showSchedule || upstreamSource !== null;

  // Default to true until the doc fetch lands; once we know whether a doc
  // exists, swap the legacy blocks for the rendered markdown.
  const usingMarkdownDoc = docLoaded && doc !== null;

  return (
    <div className="space-y-5">
      {/* Header — title is rendered by the parent SheetTitle, so don't
          duplicate it. Layout: metadata row (schedule + relation chip) →
          subhead (one font size smaller than the title) → description. */}
      <div className="space-y-3">
        {hasMetadata && (
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {showSchedule && (
              <span className="text-foreground">{team.schedule}</span>
            )}
            {upstreamSource && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <HugeiconsIcon icon={ArrowTurnForwardIcon} className="size-3.5 shrink-0" />
                {team.upstream!.verb} {upstreamSource.title}
              </span>
            )}
          </div>
        )}
        <p className="text-sm font-medium leading-snug">
          {usingMarkdownDoc && doc?.summary
            ? doc.summary
            : team.summary}
        </p>
        {/* Legacy description — only rendered when no markdown doc is
            available for this team. The doc body, when present, supplies
            the equivalent narrative below the prompt banner. */}
        {!usingMarkdownDoc && (
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {team.description}
          </p>
        )}
      </div>

      {/* Prompt banner */}
      {(team.getPrompt || team.promptSource) && (
        <PromptBanner team={team} />
      )}

      <Separator />

      {usingMarkdownDoc ? (
        // ── Markdown doc body ─────────────────────────────────────────────
        // Replaces the legacy description + substeps blocks. Inline pill
        // references (agent / tool / entity) are rendered by the custom
        // link-handler inside <WorkflowMarkdown>. The provider lets
        // reads/writes data-flow rows open the same tool-detail dialog
        // used by the Tools section at the bottom of the sheet.
        <WorkflowSheetProvider
          value={{
            openToolByName: (toolName) => {
              const rt = TOOL_REGISTRY.find((rt) => rt.name === toolName);
              if (rt) {
                setSelectedTool(toToolEntry(rt));
                setSelectedToolAgents(rt.agents);
                setDialogOpen(true);
              }
            },
          }}
        >
          <WorkflowMarkdown>{doc!.body}</WorkflowMarkdown>
        </WorkflowSheetProvider>
      ) : (
        // ── Legacy substeps ───────────────────────────────────────────────
        // Used for any team that hasn't been migrated to the markdown
        // authoring path yet.
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Steps
          </p>
          <div className="space-y-2">
            {(team.substeps ?? []).map((step, i) => (
              <SubStepRow key={i} step={step} index={i} />
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Tools */}
      {(() => {
        const teamTools = TOOL_REGISTRY.filter((rt) => rt.agents.includes(team.id as TeamId));
        if (teamTools.length === 0) return null;
        return (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Tools
              <span className="ml-1.5 text-muted-foreground/60">{teamTools.length}</span>
            </p>
            <div className="space-y-1.5">
              {teamTools.map((rt) => (
                <ToolCard
                  key={rt.name}
                  tool={toToolEntry(rt)}
                  onClick={rt.resources?.length ? () => {
                    setSelectedTool(toToolEntry(rt));
                    setSelectedToolAgents(rt.agents);
                    setDialogOpen(true);
                  } : undefined}
                />
              ))}
            </div>
          </div>
        );
      })()}

      <ToolDetailDialog
        tool={selectedTool}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agents={selectedToolAgents}
      />
    </div>
  );
}

// ── Workflow step card (for /agent-workflow page) ──────────────────────────

// Schedule values that aren't real clock times — suppress in the time slot.
// "Hourly / EOD / Weekly + on every close" was on Evaluation and read as
// noise — multiple distinct cadences belong to multiple jobs and the
// substeps inside the sheet carry the per-job timing.
const NON_TIME_SCHEDULES = new Set([
  "On demand",
  "Event-driven",
  "After every run",
  "Hourly / EOD / Weekly + on every close",
]);

function isMeaningfulSchedule(schedule: string | undefined): boolean {
  return Boolean(schedule && !NON_TIME_SCHEDULES.has(schedule));
}

export function WorkflowStepCard({
  team,
  onOpenSheet,
}: {
  team: Team;
  onOpenSheet: () => void;
}) {
  const upstreamSource = team.upstream ? getTeam(team.upstream.teamId) : null;
  const showSchedule = isMeaningfulSchedule(team.schedule);
  return (
    <Card className="p-0 gap-0 py-0 shadow-none overflow-hidden">
      {/* Section 1: title row + description */}
      <div className="p-3 flex flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {team.title}
          </span>
          {showSchedule && (
            <span className="text-xs text-foreground shrink-0">
              {team.schedule}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          {team.summary}
        </p>
      </div>
      {/* Section 2: bordered bottom row — relation chip left, View button right */}
      <div className="flex items-center justify-between gap-3 p-3 border-t">
        <div className="flex-1 min-w-0">
          {upstreamSource && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              <HugeiconsIcon icon={ArrowTurnForwardIcon} className="size-3.5 shrink-0" />
              <span className="truncate">
                {team.upstream!.verb} {upstreamSource.title}
              </span>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onOpenSheet}>
          View
        </Button>
      </div>
    </Card>
  );
}

// ── Analysts card (phase 1: dual-button card for Builder + Editor) ────────
// Mirrors WorkflowStepCard's layout exactly — title row + description +
// bordered bottom row — but the bottom row carries TWO View buttons
// (one each for builder and editor) instead of one.

export function AnalystsCard({
  onOpenBuilder,
  onOpenEditor,
}: {
  onOpenBuilder: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <Card className="p-0 gap-0 py-0 shadow-none overflow-hidden">
      {/* Section 1: title + description */}
      <div className="p-3 flex flex-col gap-2 min-w-0">
        <span className="text-sm font-medium text-foreground">Analysts</span>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          Create a new analyst persona through a guided interview, or refine an existing one.
        </p>
      </div>
      {/* Section 2: bordered bottom row — two View buttons on the right */}
      <div className="flex items-center justify-end gap-2 p-3 border-t">
        <Button variant="outline" size="sm" onClick={onOpenBuilder}>
          View Builder
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenEditor}>
          View Editor
        </Button>
      </div>
    </Card>
  );
}

// ── Tools Registry sheet content ──────────────────────────────────────────
// Renders all tools from TOOL_REGISTRY grouped by category using the
// existing ToolCard / ToolDetailDialog components.

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  intelligence: "Intelligence",
  research:     "Research",
  action:       "Action",
  system:       "System",
};

const CATEGORY_ORDER: ToolCategory[] = ["intelligence", "research", "action", "system"];

function toToolEntry(rt: RegistryTool): ToolEntry {
  return {
    name: rt.name,
    provider: rt.providers[0] ?? "internal",
    summary: rt.summary,
    resources: rt.resources,
  };
}

export function ToolsRegistrySheetContent() {
  const [selectedRT, setSelectedRT] = useState<RegistryTool | null>(null);

  const handleToolClick = useCallback((rt: RegistryTool) => {
    setSelectedRT(rt);
  }, []);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold">Tools Registry</h2>
          <Badge variant="outline" className="text-[10px]">{TOOL_REGISTRY.length} tools</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          All tools available to agents. Click any tool with a data source to see endpoint details.
        </p>
      </div>

      <Separator />

      {CATEGORY_ORDER.map((cat) => {
        const tools = TOOL_REGISTRY.filter((t) => t.category === cat);
        if (tools.length === 0) return null;
        return (
          <div key={cat}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              {CATEGORY_LABELS[cat]}
              <span className="ml-1.5 text-muted-foreground/60">{tools.length}</span>
            </p>
            <div className="space-y-1.5">
              {tools.map((rt) => {
                const entry = toToolEntry(rt);
                return (
                  <ToolCard
                    key={rt.name}
                    tool={entry}
                    agents={rt.agents}
                    onClick={entry.resources?.length ? () => handleToolClick(rt) : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <ToolDetailDialog
        tool={selectedRT ? toToolEntry(selectedRT) : null}
        agents={selectedRT?.agents}
        open={selectedRT !== null}
        onOpenChange={(open) => { if (!open) setSelectedRT(null); }}
      />
    </div>
  );
}

// ── Promotion sheet ────────────────────────────────────────────────────────
// Documents the PAPER→LIVE promotion flow + the PROMOTED thesis state.
// Lives outside the team registry because promotion is not a "team" — it's
// a discrete user-initiated transition between two operating modes.

export function PromotionSheetContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <div className="space-y-3">
        <p className="font-medium">
          Promotion graduates one analyst from paper trading to real money.
          New analysts default to paper. When you&apos;re convinced an analyst
          earns its keep, you promote it.
        </p>
        <p className="text-muted-foreground">
          Each analyst has its own <span className="font-mono">tradingEnvironment</span>
          {" "}flag — PAPER or LIVE. Promotion is per-analyst, so you can run
          some analysts live and keep others in paper for tweaks or fresh
          ideas. Both modes share the same intelligence pipeline, the same
          signal routing, the same crons. The only thing that differs is
          which Alpaca account a trade lands in.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What happens at promotion
        </p>
        <ol className="space-y-2 list-decimal pl-4 text-muted-foreground">
          <li>
            <span className="text-foreground">Live credentials validated.</span>
            {" "}The action calls <span className="font-mono">getAccount</span> against
            the live Alpaca host first. If the key isn&apos;t saved or doesn&apos;t
            authenticate, promotion fails before touching anything.
          </li>
          <li>
            <span className="text-foreground">Concurrent-run guard.</span>
            {" "}If a research run is currently RUNNING for the analyst, promotion
            refuses. Wait it out, then retry.
          </li>
          <li>
            <span className="text-foreground">Paper positions force-closed.</span>
            {" "}Every open paper position for the analyst is closed at market
            in the paper Alpaca account, one at a time. Each close commits
            individually — if Alpaca rejects the third one, the first two
            stay closed and you can retry without re-closing them.
          </li>
          <li>
            <span className="text-foreground">
              Theses flip to PROMOTED with conviction context.
            </span>
            {" "}For each closed position&apos;s thesis (and any ACTIVE-orphan
            theses with no position), the status becomes PROMOTED and four
            new fields freeze on the row: <span className="font-mono">promotedAt</span>,
            {" "}<span className="font-mono">paperTenureDays</span>,
            {" "}<span className="font-mono">paperRealizedPnl</span>,
            {" "}<span className="font-mono">paperReviewCount</span>. The agent
            reads these on the first live run.
          </li>
          <li>
            <span className="text-foreground">Environment flips to LIVE.</span>
            {" "}AgentConfig.tradingEnvironment = LIVE. From this moment forward
            every tool call on this analyst routes to the live Alpaca account.
          </li>
        </ol>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          The PROMOTED state
        </p>
        <p className="text-muted-foreground">
          PROMOTED is a first-class thesis status, not an ACTIVE-without-position
          edge case. It means: the analyst was holding this name in paper with
          intact conviction, the paper position was force-closed, and the next
          live run must explicitly act. Exactly two legal exits:
        </p>
        <div className="space-y-1.5">
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-foreground">
              <span className="font-medium">PROMOTED → ACTIVE</span>
              {" "}<span className="text-muted-foreground">(re-enter live)</span>
            </p>
            <p className="text-xs text-muted-foreground">
              The default. Agent calls <span className="font-mono">place_trade</span>;
              the trade itself auto-transitions the thesis. Cleaner: agent
              calls <span className="font-mono">update_thesis(change_status: &quot;ACTIVE&quot;)</span>
              {" "}with recomputed target/stop first, then place_trade.
            </p>
          </div>
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-foreground">
              <span className="font-medium">PROMOTED → WATCHING</span>
              {" "}<span className="text-muted-foreground">(opt out, keep tracking)</span>
            </p>
            <p className="text-xs text-muted-foreground">
              The only legal alternative. Used when the original target has
              already been captured, or new evidence invalidates the thesis.
              The conviction context fields stay on the row for reference.
            </p>
          </div>
        </div>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Forbidden, rejected at the tool layer:</span>
          {" "}PROMOTED → INVALIDATED and PROMOTED → CLOSED. The analyst held this
          name yesterday; killing it without a position is the wrong shape. If
          you truly believe the thesis is dead, downgrade to WATCHING first.
          Reasoning-only <span className="font-mono">update_thesis</span> calls
          on a PROMOTED row are also rejected — PROMOTED requires explicit
          resolution every run until it&apos;s gone.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          First live run
        </p>
        <p className="text-muted-foreground">
          Structurally different from every later run. By construction there
          are zero ACTIVE theses (nothing&apos;s been bought live yet), N PROMOTED
          theses (everything you were holding), and M WATCHING theses
          (everything you were waiting on). The agent&apos;s whole job is
          deciding which PROMOTED + WATCHING graduate to live positions.
          Run 2 onward looks like a normal daily run with all three statuses
          mixed.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Demoting
        </p>
        <p className="text-muted-foreground">
          You can demote LIVE → PAPER, but only after every open live position
          is closed. The demote dialog offers a one-click &quot;close all and
          demote&quot; that flattens the live book at market. Any PROMOTED
          theses still sitting on the row are reverted to WATCHING with an
          audit entry — the conviction context fields remain so you can see
          the paper-era track record.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Where to find this in the UI
        </p>
        <ul className="space-y-1.5 list-disc pl-4 text-muted-foreground">
          <li>
            Settings → API Keys — two stacked Alpaca forms (Paper + Live).
            Add your live key there before promoting.
          </li>
          <li>
            Analyst detail → ⋯ menu → <span className="font-medium text-foreground">Promote to live</span>
            {" "}/{" "}<span className="font-medium text-foreground">Demote to paper</span>.
            The promote dialog requires typing the analyst name to confirm.
          </li>
          <li>
            Analyst header — LIVE badge appears when the analyst is in live mode;
            an &quot;N promoted&quot; chip shows the PROMOTED count.
          </li>
          <li>
            Thesis cards / table — PROMOTED rows render with an amber pulse
            and the label <span className="font-medium text-foreground">Promoted</span>.
          </li>
        </ul>
      </div>
    </div>
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
