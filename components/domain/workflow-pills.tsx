"use client";

/**
 * Workflow page inline pill components.
 *
 * Rendered from markdown link prefixes by `<WorkflowMarkdown>`:
 *   [Discovery Run](agent:discovery)     → <AgentPill teamId="discovery">
 *   [`get_stock_data`](tool:get_stock_data) → <ToolPill name="get_stock_data">
 *   [Thesis](entity:thesis)              → <EntityPill name="thesis">
 *
 * Pills carry the visual vocabulary for cross-references inside workflow
 * docs. Each pill is link-shaped (clickable) when there's a destination
 * to open, plain inline-pill otherwise.
 *
 * See app/(root)/agent-workflow/content/<id>.md for the authoring side.
 */

import { Database, FileText, Layers, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/chat/SourceChip";
import { getTeam, type TeamId } from "@/lib/agent/workflow-registry";

// ── Pill primitive ──────────────────────────────────────────────────────────
// Shared shell so all three pills share spacing + hover behavior. Inline-block
// to keep them flowing inside paragraphs.

function PillShell({
  onClick,
  className,
  title,
  children,
}: {
  onClick?: () => void;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex items-center gap-1 align-baseline rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-xs leading-none",
    onClick && "cursor-pointer hover:bg-muted/70 hover:border-border transition-colors",
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} title={title}>
        {children}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

// ── AgentPill ───────────────────────────────────────────────────────────────
// Cross-reference to another agent's card. Renders the agent's display
// name (resolved from the registry) prefixed with the agent's icon. Clicking
// scrolls/jumps to that card on the /agent-workflow page. The label override
// lets authors write [Discovery](agent:discovery) where "Discovery" is the
// shortened display label they actually want inline.

export function AgentPill({
  teamId,
  label,
}: {
  teamId: string;
  label?: string;
}) {
  const team = getTeam(teamId as TeamId);
  const displayLabel = label ?? team?.title ?? teamId;
  const Icon = team?.icon ?? Layers;

  function handleClick() {
    if (typeof window === "undefined") return;
    const el = document.getElementById(`team-${teamId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <PillShell
      onClick={team ? handleClick : undefined}
      title={team ? `Jump to ${team.title}` : undefined}
      className="text-foreground"
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="font-medium">{displayLabel}</span>
    </PillShell>
  );
}

// ── ToolPill ────────────────────────────────────────────────────────────────
// Inline ref to an agent tool. Renders the tool name in mono prefixed with
// the data provider's logo (Finnhub / FMP / Alpaca / SEC / Perplexity /
// Hindsight-internal). When the tool has multiple providers, the first one
// wins as the lead avatar — the rest live in the tool's detail dialog
// (reached by clicking the tool row at the bottom of the sheet).
//
// `provider` defaults to "internal" — most tools that don't pass it are
// our own (record_thesis, update_thesis, complete_run, etc.) and "internal"
// renders the Hindsight mark, which reads naturally for those.

export function ToolPill({
  name,
  provider = "internal",
  label,
}: {
  name: string;
  provider?: string;
  label?: string;
}) {
  const displayLabel = label ?? name;
  return (
    <PillShell title={`Tool: ${name} (${provider})`}>
      <ProviderIcon provider={provider} size={12} />
      {/* eslint-disable-next-line no-restricted-syntax -- monospace is the correct affordance for a tool's machine name */}
      <code className="text-xs font-mono">{displayLabel}</code>
    </PillShell>
  );
}

// ── EntityPill ──────────────────────────────────────────────────────────────
// Inline ref to a data model. Plain icon + name. Clicking is a no-op until
// the entity docs land in their own sheets (Thesis schema doc, Position
// schema doc, etc.) — leaving the hook in place so we can wire later
// without changing the markdown source.

const ENTITY_ICONS: Record<string, typeof Database> = {
  thesis: FileText,
  position: Database,
  signal: Layers,
  trade: Wrench,
  run: Layers,
  default: Database,
};

export function EntityPill({
  name,
  label,
}: {
  name: string;
  label?: string;
}) {
  const key = name.toLowerCase();
  const Icon = ENTITY_ICONS[key] ?? ENTITY_ICONS.default;
  const displayLabel = label ?? name;
  return (
    <PillShell title={`Entity: ${name}`} className="text-foreground">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="font-medium">{displayLabel}</span>
    </PillShell>
  );
}
