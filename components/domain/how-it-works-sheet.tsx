"use client";

import { useState, useCallback } from "react";
import { Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { TeamCard, FlowConnector } from "@/components/domain/team-card";
import {
  TEAMS,
  getTeam,
  exportWorkflowAsMarkdown,
  type TeamId,
} from "@/lib/agent/workflow-registry";

// ── Copy button ────────────────────────────────────────────────────────────

function CopyButton({
  getText,
  label,
}: {
  getText: () => string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [getText]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" size="sm" onClick={handleCopy} />
          }
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : label}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {copied ? "Copied to clipboard" : "Copy as markdown"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── FlowType (backwards compat for pages that import it) ───────────────────

export type FlowType = TeamId;

// ── Sheet ──────────────────────────────────────────────────────────────────

export function HowItWorksSheet({
  flow,
  children,
}: {
  flow: FlowType;
  children: React.ReactNode;
}) {
  const team = getTeam(flow);

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" />}>
        {children}
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-md overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <SheetTitle>{team.title}</SheetTitle>
          <div className="flex items-center gap-1.5">
            <CopyButton
              getText={() => exportWorkflowAsMarkdown()}
              label="Copy"
            />
            <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </div>

        {/* Team card, always expanded */}
        <div className="px-4 pb-4">
          <TeamCard team={team} alwaysExpanded />
        </div>

        {/* Context: where this fits in the full flow */}
        <Separator />
        <div className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-3">
            Full workflow
          </p>
          <div className="flex flex-col items-center">
            {TEAMS.map((t, i) => (
              <div key={t.id} className="flex flex-col items-center w-full">
                <TeamCard
                  team={t}
                  defaultExpanded={false}
                />
                {i < TEAMS.length - 1 && <FlowConnector />}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
