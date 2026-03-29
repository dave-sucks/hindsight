"use client";

import { useState, useCallback } from "react";
import { Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  WorkflowStepCard,
  FlowConnector,
  TeamSheetContent,
} from "@/components/domain/team-card";
import {
  TEAMS,
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

export default function AgentWorkflowPage() {
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);

  return (
    <div className="p-6 space-y-4 max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
          <p className="text-sm text-muted-foreground mt-1">
            5 teams run in a daily loop. Open any step to see its workflow and tools.
          </p>
        </div>
        <CopyMarkdownButton />
      </div>

      <Separator />

      {/* Steps */}
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

      {/* Sheet for selected team */}
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
