"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TeamCard, FlowConnector } from "@/components/domain/team-card";
import { TEAMS, exportWorkflowAsMarkdown } from "@/lib/agent/workflow-registry";

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
  return (
    <div className="p-6 space-y-6 max-w-lg mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
          <p className="text-sm text-muted-foreground mt-1">
            5 teams run in a daily loop. Click any team to see its steps and tools.
          </p>
        </div>
        <CopyMarkdownButton />
      </div>

      <Separator />

      {/* Flow */}
      <div className="flex flex-col items-center gap-0">
        {TEAMS.map((team, i) => (
          <div key={team.id} className="flex flex-col items-center w-full">
            <TeamCard team={team} />
            {i < TEAMS.length - 1 && <FlowConnector />}
          </div>
        ))}
      </div>
    </div>
  );
}
