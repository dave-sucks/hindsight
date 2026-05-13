"use client";

import { useState, useCallback } from "react";
import { Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  WorkflowStepCard,
  AnalystsCard,
  FlowConnector,
  TeamSheetContent,
  ToolsRegistrySheetContent,
  PromotionSheetContent,
} from "@/components/domain/team-card";
import {
  TEAMS,
  TOOL_REGISTRY,
  PHASE_LABELS,
  PHASE_ORDER,
  LAST_VERIFIED_AT,
  getTeam,
  exportWorkflowAsMarkdown,
  type Team,
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

// ── Page ─────────────────────────────────────────────────────────────────────

type SheetTarget = Team | "tools-registry" | "promotion" | null;

export default function AgentWorkflowPage() {
  const [activeSheet, setActiveSheet] = useState<SheetTarget>(null);

  const builderTeam = getTeam("builder");
  const editorTeam = getTeam("editor");

  return (
    <div className="p-6 space-y-6 max-w-xl mx-auto">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
          <CopyMarkdownButton />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The canonical map of what Hindsight runs today — every team, cron, tool, and prompt
          that drives the daily portfolio loop. Open any card to see its workflow and tools.
        </p>
        <p className="text-xs text-muted-foreground">
          Last verified against codebase:{" "}
          <span className="tabular-nums text-foreground">{LAST_VERIFIED_AT}</span>
          {" · "}See also <span className="font-mono">docs/VISION.md</span> (target state)
          {" and "}<span className="font-mono">docs/GAPS.md</span> (known gaps).
        </p>
      </div>

      <Separator />

      {/* Phase-grouped cards */}
      {PHASE_ORDER.map((phase, phaseIdx) => {
        const phaseTeams = TEAMS.filter((t) => t.phase === phase);
        if (phaseTeams.length === 0) return null;

        return (
          <div key={phase} className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {phaseIdx + 1}. {PHASE_LABELS[phase]}
            </p>
            <div>
              {phase === "build" ? (
                <AnalystsCard
                  onOpenBuilder={() => setActiveSheet(builderTeam)}
                  onOpenEditor={() => setActiveSheet(editorTeam)}
                />
              ) : (
                phaseTeams.map((team, i) => (
                  <div key={team.id}>
                    <WorkflowStepCard
                      team={team}
                      onOpenSheet={() => setActiveSheet(team)}
                    />
                    {i < phaseTeams.length - 1 && <FlowConnector />}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}

      <Separator />

      {/* Tools Registry — same card layout as the team cards above */}
      <Card className="p-0 gap-0 py-0 shadow-none overflow-hidden">
        <div className="p-3 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              Tools Registry
            </span>
            <span className="text-xs text-foreground shrink-0">
              {TOOL_REGISTRY.length} tools
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            All tools available to agents — intelligence, research, action, and system lifecycle.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 p-3 border-t">
          <Button variant="outline" size="sm" onClick={() => setActiveSheet("tools-registry")}>
            View
          </Button>
        </div>
      </Card>

      {/* Promotion — paper→live graduation flow. Lives outside the team
          registry because it's a user-initiated transition, not a team. */}
      <Card className="p-0 gap-0 py-0 shadow-none overflow-hidden">
        <div className="p-3 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              Promotion
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              Paper → Live
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            How an analyst graduates from paper trading to real money — per-analyst,
            reversible, with explicit conviction-pause state for held names.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 p-3 border-t">
          <Button variant="outline" size="sm" onClick={() => setActiveSheet("promotion")}>
            View
          </Button>
        </div>
      </Card>

      {/* Sheet */}
      <Sheet
        open={activeSheet !== null}
        onOpenChange={(open: boolean) => { if (!open) setActiveSheet(null); }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:max-w-md overflow-y-auto"
        >
          {activeSheet && (
            <>
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <SheetTitle>
                  {activeSheet === "tools-registry"
                    ? "Tools Registry"
                    : activeSheet === "promotion"
                      ? "Promotion"
                      : activeSheet.title}
                </SheetTitle>
                <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
              <div className="px-4 pb-6">
                {activeSheet === "tools-registry" ? (
                  <ToolsRegistrySheetContent />
                ) : activeSheet === "promotion" ? (
                  <PromotionSheetContent />
                ) : (
                  <TeamSheetContent team={activeSheet} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
