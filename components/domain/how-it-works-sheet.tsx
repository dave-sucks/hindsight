"use client";

import { useState, useCallback } from "react";
import { Globe, Copy, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToolCardList } from "@/components/domain/tool-cards";
import { Markdown } from "@/components/ui/markdown";
import { SYSTEM_PROMPT_TEMPLATE } from "@/lib/agent/system-prompt-template";
import { exportToolsAsMarkdown } from "@/lib/agent/tool-registry";
import {
  SOURCE_REGISTRY,
  ANALYST_BUILDER_STEPS,
  MANUAL_RUN_DETAILS,
  CRON_RUN_DETAILS,
  LEARNING_LOOP_DETAILS,
  CONTEXT_LOADING_DETAILS,
  INTELLIGENCE_PIPELINE_STEPS,
  INTELLIGENCE_PIPELINE_DETAILS,
  INTELLIGENCE_OVERVIEW_DETAILS,
  type FlowStep,
  type DetailSection,
} from "@/lib/agent/workflow-data";

// ── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ getText, label }: { getText: () => string; label: string }) {
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
        <TooltipTrigger render={<Button variant="outline" size="sm" onClick={handleCopy} />}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : label}
        </TooltipTrigger>
        <TooltipContent side="bottom">{copied ? "Copied to clipboard" : `Copy as markdown`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ name }: { name: string }) {
  const def = SOURCE_REGISTRY[name];
  const Icon = def?.icon ?? Globe;
  const description = def?.description ?? name;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Badge variant="secondary">
          <Icon className="h-3 w-3" data-icon="inline-start" />
          {name}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Flow diagram ────────────────────────────────────────────────────────────

function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  return (
    <TooltipProvider>
      <div className="relative flex flex-col items-center gap-0 py-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === steps.length - 1;
          return (
            <div key={i} className="flex flex-col items-center w-full">
              {step.phase && (
                <div className="mb-2 mt-1">
                  <Badge variant="outline">{step.phase}</Badge>
                </div>
              )}
              <Card className="w-full max-w-sm p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium">{step.title}</span>
                </div>
                <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                  {step.sources.map((s) => (
                    <SourceBadge key={s} name={s} />
                  ))}
                </div>
                <div className="border-t border-border/40">
                  <p className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                    {step.summary}
                  </p>
                </div>
              </Card>
              {!isLast && (
                <div className="flex flex-col items-center">
                  <div className="w-px h-4 bg-border" />
                  <div className="h-1.5 w-1.5 rounded-full border border-border bg-background" />
                  <div className="w-px h-4 bg-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

// ── Detail list (stacked label/value) ───────────────────────────────────────

function DetailList({ sections }: { sections: DetailSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map((section, i) => (
        <div key={i}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            {section.heading}
          </h3>
          <div className="space-y-3">
            {section.items.map((item, j) => (
              <div key={j}>
                <span className="text-xs font-medium text-foreground">
                  {item.label}
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          {i < sections.length - 1 && <Separator className="mt-4" />}
        </div>
      ))}
    </div>
  );
}

// ── Sheet config ────────────────────────────────────────────────────────────

export type FlowType = "agent-run" | "analyst-builder" | "manual-run" | "cron-run" | "learning-loop" | "context-loading" | "intelligence-pipeline";

interface FlowConfig {
  title: string;
  content:
    | { type: "flow"; steps: FlowStep[] }
    | { type: "details"; sections: DetailSection[] }
    | { type: "tabbed" }
    | { type: "intelligence" };
}

const FLOW_CONFIG: Record<FlowType, FlowConfig> = {
  "agent-run": {
    title: "Analyst Run Tools & Prompt",
    content: { type: "tabbed" },
  },
  "analyst-builder": {
    title: "How the Analyst Builder Works",
    content: { type: "flow", steps: ANALYST_BUILDER_STEPS },
  },
  "manual-run": {
    title: "Manual Run",
    content: { type: "details", sections: MANUAL_RUN_DETAILS },
  },
  "cron-run": {
    title: "Daily Cron",
    content: { type: "details", sections: CRON_RUN_DETAILS },
  },
  "learning-loop": {
    title: "Analyst Briefing (Memory)",
    content: { type: "details", sections: LEARNING_LOOP_DETAILS },
  },
  "context-loading": {
    title: "Context Loading",
    content: { type: "details", sections: CONTEXT_LOADING_DETAILS },
  },
  "intelligence-pipeline": {
    title: "How Intelligence Works",
    content: { type: "intelligence" },
  },
};

// ── Sheet export ────────────────────────────────────────────────────────────

export function HowItWorksSheet({
  flow,
  children,
}: {
  flow: FlowType;
  children: React.ReactNode;
}) {
  const config = FLOW_CONFIG[flow];
  const isTabbed = config.content.type === "tabbed";

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" />}>
        {children}
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-lg overflow-y-auto"
      >
        {isTabbed ? (
          <Tabs defaultValue="tools" className="flex flex-col flex-1 min-h-0">
            {/* Top bar: tabs left, close right — one row */}
            <div className="flex items-center justify-between px-4 pt-4">
              <TabsList>
                <TabsTrigger value="tools">Tools</TabsTrigger>
                <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
                <TabsTrigger value="prompt">Prompt</TabsTrigger>
              </TabsList>
              <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
                <X className="h-4 w-4" />
              </SheetClose>
            </div>

            {/* Title */}
            <div className="px-4 pt-3 pb-2">
              <SheetTitle>{config.title}</SheetTitle>
            </div>

            {/* Tools tab */}
            <TabsContent value="tools" className="px-4 pb-4">
              <div className="mb-3">
                <CopyButton getText={exportToolsAsMarkdown} label="Copy as markdown" />
              </div>
              <ToolCardList />
            </TabsContent>

            {/* Intelligence pipeline tab */}
            <TabsContent value="intelligence" className="px-4 pb-4 space-y-6">
              <p className="text-sm text-muted-foreground">
                Before your analyst runs, 5 background jobs gather intelligence:
              </p>
              <FlowDiagram steps={INTELLIGENCE_PIPELINE_STEPS} />
              <Separator />
              <p className="text-sm text-muted-foreground">
                The analyst reads this pre-gathered intelligence in Phase 1 instead of scanning the web from scratch.
              </p>
              <DetailList sections={INTELLIGENCE_PIPELINE_DETAILS} />
            </TabsContent>

            {/* Prompt tab */}
            <TabsContent value="prompt" className="px-4 pb-4">
              <div className="mb-3">
                <CopyButton getText={() => SYSTEM_PROMPT_TEMPLATE} label="Copy as markdown" />
              </div>
              <Markdown variant="compact">{SYSTEM_PROMPT_TEMPLATE}</Markdown>
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {/* Top bar: title left, close right — one row */}
            <div className="flex items-center justify-between px-4 pt-4">
              <SheetTitle>{config.title}</SheetTitle>
              <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
                <X className="h-4 w-4" />
              </SheetClose>
            </div>

            {/* Body */}
            <div className="px-4 pt-3 pb-4">
              {config.content.type === "flow" ? (
                <FlowDiagram steps={config.content.steps} />
              ) : config.content.type === "intelligence" ? (
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Five background jobs run every weekday morning before analysts wake up:
                  </p>
                  <FlowDiagram steps={INTELLIGENCE_PIPELINE_STEPS} />
                  <Separator />
                  <DetailList sections={INTELLIGENCE_OVERVIEW_DETAILS} />
                </div>
              ) : (
                <DetailList sections={config.content.sections} />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
