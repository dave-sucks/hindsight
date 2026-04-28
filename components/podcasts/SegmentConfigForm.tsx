"use client";

/**
 * SegmentConfigForm — the segment analog of AnalystConfigForm.
 *
 * Same tabs (Brief / Monitors / Settings), same visual language, same
 * primitive building blocks. Only the field set differs because a segment
 * isn't a trading analyst.
 *
 * Reuses the exported helpers from AnalystConfigForm (Section,
 * FieldGroup, RowLabel, EmptyHint, GHOST_INPUT, EnumChipsCombobox,
 * FreeTextChipsCombobox) so the chrome stays byte-identical to the
 * analyst surface.
 */

import { useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Section,
  FieldGroup,
  RowLabel,
  EmptyHint,
  GHOST_INPUT,
  FreeTextChipsCombobox,
} from "@/components/analysts/AnalystConfigForm";

// ─── Form value shape ────────────────────────────────────────────────────────

export type SegmentMonitorView = {
  id: string;
  name: string;
  query: string;
};

export type SegmentFormValues = {
  name: string;
  description?: string | null;
  segmentPrompt: string;
  targetSeconds: number;
  topics: string[];
  sources: string[];
  excludeTopics: string[];
  monitors: SegmentMonitorView[];
};

export type SegmentFormChangeHandler = <K extends keyof SegmentFormValues>(
  field: K,
  value: SegmentFormValues[K],
) => void;

interface Props {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  /** Add a new search monitor (Sonar query). */
  onAddMonitor?: (input: { name: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
  hideName?: boolean;
  defaultTab?: "brief" | "monitors" | "settings";
}

export function SegmentConfigForm({
  values,
  onChange,
  onAddMonitor,
  onRemoveMonitor,
  hideName = false,
  defaultTab = "brief",
}: Props) {
  return (
    <TooltipProvider>
      <Tabs defaultValue={defaultTab} className="flex flex-col h-full min-h-0">
        <div className="px-3 pt-1 shrink-0">
          <TabsList>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            <TabsTrigger value="monitors">Monitors</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="brief" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <BriefTab values={values} onChange={onChange} hideName={hideName} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="monitors" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <MonitorsTab
              values={values}
              onAddMonitor={onAddMonitor}
              onRemoveMonitor={onRemoveMonitor}
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

// ─── Brief tab ───────────────────────────────────────────────────────────────

function BriefTab({
  values,
  onChange,
  hideName,
}: {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  hideName: boolean;
}) {
  return (
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
  );
}

// Editorial brief — markdown editor with Edit/Cancel/Save action slot.
// Mirrors AnalystConfigForm's StrategyField behavior 1:1.
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

// ─── Monitors tab ────────────────────────────────────────────────────────────
// Mirror of AnalystConfigForm's Monitors tab structure: a Sources section
// (omitted for podcasts in Phase 1 — domain monitors land in Phase 4) plus
// a Search Queries section with the same row layout.

function MonitorsTab({
  values,
  onAddMonitor,
  onRemoveMonitor,
}: {
  values: SegmentFormValues;
  onAddMonitor?: (input: { name: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedQuery = query.trim();
    if (!trimmedName || !trimmedQuery || !onAddMonitor) return;
    setBusy(true);
    try {
      await onAddMonitor({ name: trimmedName, query: trimmedQuery });
      setName("");
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <Section
        label="Search Queries"
        tooltip="Each is a Perplexity Sonar query that runs as part of the segment's signal pipeline."
      >
        <div className="flex flex-col gap-1">
          {values.monitors.length === 0 ? (
            <EmptyHint>No monitors yet — add one below.</EmptyHint>
          ) : (
            values.monitors.map((m) => (
              <Tooltip key={m.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="group flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8 text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onRemoveMonitor) void onRemoveMonitor(m.id);
                      }}
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-[10px] text-muted-foreground/60 opacity-0 group-hover:opacity-100">
                        Remove
                      </span>
                    </button>
                  }
                />
                <TooltipContent side="left" className="max-w-xs text-xs">
                  {m.query}
                </TooltipContent>
              </Tooltip>
            ))
          )}
        </div>

        {onAddMonitor && (
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end pt-2">
            <div className="flex flex-col gap-1">
              <RowLabel label="Name" />
              <Input
                value={name}
                placeholder="Indie game launches"
                className={cn(GHOST_INPUT)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <RowLabel label="Query" />
              <Input
                value={query}
                placeholder="indie game releases this week steam"
                className={cn(GHOST_INPUT)}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            <Button size="sm" disabled={busy} onClick={submit}>
              Add
            </Button>
          </div>
        )}
      </Section>

      <p className="px-3 py-3 text-[11px] text-muted-foreground/60 leading-relaxed">
        Plus any signal that hits this segment&apos;s topic fence is
        considered during a run.
      </p>
    </div>
  );
}

// ─── Settings tab ────────────────────────────────────────────────────────────

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
          label="Preferred sources"
          tooltip="Optional 2–4 domain hints the segment leans on (e.g. techcrunch.com)."
        >
          <FreeTextChipsCombobox
            values={values.sources}
            placeholder="Free text — e.g. techcrunch.com"
            onChange={(next) => onChange("sources", next)}
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
