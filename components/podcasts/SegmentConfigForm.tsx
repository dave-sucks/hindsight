"use client";

/**
 * SegmentConfigForm — segment-level analog of AnalystConfigForm.
 *
 * TWO tabs:
 *   • Overview — name + description + editorial brief.
 *   • Settings — target duration + topic fence (topics + excludeTopics).
 *
 * One component, two surfaces:
 *   • SegmentConfigSheet (per-segment Settings on the podcast detail page).
 *   • PodcastConfigPreview's Segments tab (Builder/Editor right panel).
 *
 * The Sources + Search Queries lists left with the podcast's monitors
 * (2026-09-21): nothing had crawled or searched them since 2026-05-31, and a
 * segment run produces the same transcript without them.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Section,
  FieldGroup,
  RowLabel,
  GHOST_INPUT,
  FreeTextChipsCombobox,
} from "@/components/analysts/AnalystConfigForm";
import { cn } from "@/lib/utils";

// ─── Form value shape ────────────────────────────────────────────────────────

export type SegmentFormValues = {
  name: string;
  description?: string | null;
  segmentPrompt: string;
  targetSeconds: number;
  topics: string[];
  excludeTopics: string[];
};

export type SegmentFormChangeHandler = <K extends keyof SegmentFormValues>(
  field: K,
  value: SegmentFormValues[K],
) => void;

interface Props {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  hideName?: boolean;
  defaultTab?: "overview" | "settings";
  /** Optional inline action rendered in the segment header (e.g. "Remove segment"). */
  headerAction?: React.ReactNode;
}

export function SegmentConfigForm({
  values,
  onChange,
  hideName = false,
  defaultTab = "overview",
  headerAction,
}: Props) {
  return (
    <TooltipProvider>
      <Tabs defaultValue={defaultTab} className="flex flex-col h-full min-h-0">
        <div className="px-3 pt-1 shrink-0 flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          {headerAction}
        </div>

        <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <OverviewTab
              values={values}
              onChange={onChange}
              hideName={hideName}
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <SettingsTab values={values} onChange={onChange} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}

// ─── Overview tab — name + description + brief ──────────────────────────────
//
// One place that shows "what this segment is about" — its name, description
// and editorial brief, in the same scroll.

function OverviewTab({
  values,
  onChange,
  hideName,
}: {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  hideName: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="p-3 flex flex-col gap-4">
        {!hideName && (
          <FieldGroup label="Name">
            <Input
              defaultValue={values.name}
              placeholder="Segment name"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== values.name) onChange("name", next);
              }}
            />
          </FieldGroup>
        )}

        <FieldGroup
          label="Description"
          tooltip="One-line internal description shown in the segment list."
        >
          <Textarea
            defaultValue={values.description ?? ""}
            placeholder="What this segment covers, in one line."
            rows={2}
            className="resize-y"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (values.description ?? "")) onChange("description", next || null);
            }}
          />
        </FieldGroup>

        <BriefField
          value={values.segmentPrompt}
          onSave={(next) => onChange("segmentPrompt", next)}
        />
      </div>
    </div>
  );
}

// Editorial brief — Edit/Cancel/Save markdown editor. Same shape as
// AnalystConfigForm's StrategyField.
function BriefField({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const action = editing ? (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft(value);
          setEditing(false);
        }}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => {
          if (draft.trim() && draft !== value) onSave(draft.trim());
          setEditing(false);
        }}
      >
        Save
      </Button>
    </div>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      Edit
    </Button>
  );

  return (
    <FieldGroup
      label="Editorial brief"
      tooltip="The script's playbook — what to cover, the angle, what to skip. Markdown supported."
      action={action}
    >
      {editing ? (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[260px] text-xs font-mono resize-y"
          placeholder="Write the editorial brief for this segment. Markdown supported."
        />
      ) : value ? (
        <Markdown variant="compact" className="text-muted-foreground">
          {value}
        </Markdown>
      ) : (
        <p className="text-xs text-muted-foreground/60">
          No brief yet. Click Edit to write one, or use the AI chat.
        </p>
      )}
    </FieldGroup>
  );
}

function SettingsTab({
  values,
  onChange,
}: {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
}) {
  return (
    <div className="flex flex-col">
      <Section label="Format">
        <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
          <RowLabel
            label="Target seconds"
            tooltip="Approximate spoken length. Sum of all segments roughly equals episode length."
          />
          <Input
            type="number"
            defaultValue={values.targetSeconds}
            min={30}
            max={1800}
            step={30}
            className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n !== values.targetSeconds) {
                onChange("targetSeconds", Math.min(1800, Math.max(30, n)));
              }
            }}
          />
        </div>
      </Section>

      <Section label="Universe fence">
        <FieldGroup
          label="Topics"
          tooltip="What this segment covers. Free text — 3–6 specific topic tags."
        >
          <FreeTextChipsCombobox
            values={values.topics}
            placeholder="Free text — e.g. AI, venture capital, open source"
            onChange={(next) => onChange("topics", next)}
          />
        </FieldGroup>

        <FieldGroup
          label="Skip topics"
          tooltip="Topics to skip even if in scope (e.g. crypto, rumors)."
        >
          <FreeTextChipsCombobox
            values={values.excludeTopics}
            placeholder="Free text — e.g. crypto, rumor, leak"
            onChange={(next) => onChange("excludeTopics", next)}
          />
        </FieldGroup>
      </Section>
    </div>
  );
}
