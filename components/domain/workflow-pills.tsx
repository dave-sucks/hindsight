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
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnForwardIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/chat/SourceChip";
import { getTeam, type TeamId } from "@/lib/agent/workflow-registry";
import { useWorkflowSheet } from "@/components/domain/workflow-sheet-context";

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

// ── DataFlowRow ─────────────────────────────────────────────────────────────
// Visual indicator that a step reads from (or writes to) a specific tool.
// Mirrors the "Using signals from Intelligence Pipeline" chip at the top of
// the sheet — same `ArrowTurnForwardIcon`, same minimal treatment — but
// inline inside step content. Clicking the row opens the tool's detail
// dialog (the one already used by the Tools section at the bottom of the
// sheet) via the WorkflowSheetContext.
//
// Authored in markdown as a fenced code block with language "reads" or
// "writes". The WorkflowMarkdown renderer parses each line of the fence
// as `<tool_name> — <condition>` and emits one DataFlowRow per line.

export function DataFlowRow({
  direction,
  toolName,
  provider = "internal",
  condition,
}: {
  direction: "read" | "write";
  toolName: string;
  provider?: string;
  condition?: string;
}) {
  const sheet = useWorkflowSheet();
  const clickable = !!sheet;

  function handleClick() {
    sheet?.openToolByName(toolName);
  }

  const verb = direction === "read" ? "Reads" : "Writes";

  const body = (
    <span className="inline-flex items-center gap-2 align-baseline">
      <HugeiconsIcon
        icon={ArrowTurnForwardIcon}
        className={cn(
          "size-3.5 shrink-0",
          direction === "read" ? "text-muted-foreground" : "text-foreground",
        )}
      />
      <span className="text-xs text-muted-foreground">{verb}</span>
      <span className="inline-flex items-center gap-1">
        <ProviderIcon provider={provider} size={12} />
        {/* eslint-disable-next-line no-restricted-syntax -- monospace is the correct affordance for a tool's machine name */}
        <code className="text-xs font-mono text-foreground">{toolName}</code>
      </span>
      {condition && (
        <span className="text-xs text-muted-foreground">— {condition}</span>
      )}
    </span>
  );

  return (
    <div className="my-1.5 leading-relaxed">
      {clickable ? (
        <button
          type="button"
          onClick={handleClick}
          className="block w-full rounded-md px-2 py-1.5 -mx-2 text-left transition-colors hover:bg-muted/40"
          title={`Open ${toolName} details`}
        >
          {body}
        </button>
      ) : (
        <div className="px-2 py-1.5 -mx-2">{body}</div>
      )}
    </div>
  );
}

// ── Parse a single fence line ───────────────────────────────────────────────
// Format: `<tool_name>[?provider=<key>] — <condition>`
//   tool_name : required, snake_case
//   provider  : optional, key recognised by ProviderIcon (finnhub, fmp, alpaca,
//               sec, perplexity, internal, …). Defaults to "internal".
//   condition : optional free text after an em-dash or hyphen.
//
// Examples (all valid):
//   read_signals
//   get_earnings_calendar?provider=finnhub — gated by EARNINGS_CALENDAR feed
//   get_market_movers?provider=fmp — gated by MARKET_MOVERS_* feeds
//   place_trade?provider=alpaca — only on immediate-buy path

export interface ParsedFlowLine {
  toolName: string;
  provider?: string;
  condition?: string;
}

export function parseFlowLine(line: string): ParsedFlowLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Split on em-dash or `--` first so we don't mangle hyphens in tool names.
  const dashMatch = trimmed.match(/^(.*?)\s+(?:—|--|–)\s+(.+)$/);
  const headRaw = dashMatch ? dashMatch[1].trim() : trimmed;
  const condition = dashMatch ? dashMatch[2].trim() : undefined;

  // headRaw is `tool_name` or `tool_name?provider=foo`.
  const [toolName, query] = headRaw.split("?");
  if (!toolName) return null;
  let provider: string | undefined;
  if (query) {
    const params = new URLSearchParams(query);
    const p = params.get("provider");
    if (p) provider = p;
  }

  return { toolName: toolName.trim(), provider, condition };
}
