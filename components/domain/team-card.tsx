"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown } from "lucide-react";
import { ProviderIcon } from "@/components/chat/SourceChip";
import { cn } from "@/lib/utils";
import type { Team, ToolEntry, SubStep } from "@/lib/agent/workflow-registry";

// ── Tool row ───────────────────────────────────────────────────────────────

function ToolRow({ tool }: { tool: ToolEntry }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <ProviderIcon provider={tool.provider} size={14} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium font-mono">{tool.name}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {tool.summary}
        </p>
      </div>
    </div>
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

// ── Team card ──────────────────────────────────────────────────────────────

interface TeamCardProps {
  team: Team;
  /** Start expanded (for sheets) */
  defaultExpanded?: boolean;
  /** Hide the expand/collapse — always show content */
  alwaysExpanded?: boolean;
}

export function TeamCard({
  team,
  defaultExpanded = false,
  alwaysExpanded = false,
}: TeamCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || alwaysExpanded);
  const Icon = team.icon;

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => !alwaysExpanded && setExpanded((prev: boolean) => !prev)}
        className={cn(
          "flex items-start gap-3 w-full text-left px-4 py-3",
          !alwaysExpanded && "hover:bg-accent/30 transition-colors cursor-pointer"
        )}
        disabled={alwaysExpanded}
      >
        <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{team.title}</span>
            {team.model && (
              <Badge variant="secondary" className="text-[10px]">
                {team.model}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {team.schedule}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
            {team.summary}
          </p>
        </div>
        {!alwaysExpanded && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform mt-1",
              expanded && "rotate-180"
            )}
          />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <>
          <Separator />

          {/* Sub-steps */}
          <div className="px-4 py-3">
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
          <div className="px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-2">
              Tools
              <span className="ml-1.5 text-muted-foreground/40">
                {team.tools.length}
              </span>
            </p>
            <div className="space-y-0.5">
              {team.tools.map((tool, i) => (
                <ToolRow key={i} tool={tool} />
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Connector (for flow layouts) ───────────────────────────────────────────

export function FlowConnector() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-4 bg-border" />
      <div className="h-1.5 w-1.5 rounded-full border border-border bg-background" />
      <div className="w-px h-4 bg-border" />
    </div>
  );
}
