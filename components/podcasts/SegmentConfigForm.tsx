"use client";

/**
 * SegmentConfigForm — segment-level analog of AnalystConfigForm.
 *
 * TWO tabs:
 *   • Overview — name + description + editorial brief + Sources list +
 *     Search Queries list. The brief and the monitors live together
 *     because they're both "what this segment is about."
 *   • Settings — target duration + topic fence (topics + excludeTopics).
 *
 * Monitor list rendering matches AnalystConfigForm's MonitorsTab
 * byte-for-byte (favicon + name rows, search-icon + query rows). Same
 * Monitor table the analyst surface uses, just split by Monitor.type.
 *
 * One component, two surfaces:
 *   • SegmentConfigSheet (per-segment Settings on the podcast detail
 *     page) — onAdd/onRemove call server actions.
 *   • PodcastConfigPreview's Segments tab (Builder/Editor right panel)
 *     — onAdd/onRemove mutate the in-memory SuggestedPodcastConfig.
 *
 * Inline add forms live under each Sources/Queries section so the user
 * can edit monitors directly from either surface without going through
 * the AI chat.
 */

import { useState } from "react";
import { Search, Plus, X } from "lucide-react";

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
import { cn } from "@/lib/utils";

// ─── Form value shape ────────────────────────────────────────────────────────

export type SegmentDomainSource = {
  id: string;
  name: string;
  domain: string;
};

export type SegmentSearchQuery = {
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
  excludeTopics: string[];
  domainMonitors: SegmentDomainSource[];
  searchMonitors: SegmentSearchQuery[];
};

export type SegmentFormChangeHandler = <K extends keyof SegmentFormValues>(
  field: K,
  value: SegmentFormValues[K],
) => void;

interface Props {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  /** Add a new monitor to the segment — type-aware. */
  onAddDomainMonitor?: (input: { name: string; domain: string }) => Promise<void> | void;
  onAddSearchMonitor?: (input: { name?: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
  hideName?: boolean;
  defaultTab?: "overview" | "settings";
  /** Optional inline action rendered in the segment header (e.g. "Remove segment"). */
  headerAction?: React.ReactNode;
}

export function SegmentConfigForm({
  values,
  onChange,
  onAddDomainMonitor,
  onAddSearchMonitor,
  onRemoveMonitor,
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
              onAddDomainMonitor={onAddDomainMonitor}
              onAddSearchMonitor={onAddSearchMonitor}
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

// ─── Overview tab — name + description + brief + monitors ───────────────────
//
// Collapses what used to be two tabs (Brief + Monitors). The user wants
// one place that shows "what this segment is about" — its name, description,
// editorial brief, and the sources/queries it watches. All four belong
// together in the same scroll.

function OverviewTab({
  values,
  onChange,
  hideName,
  onAddDomainMonitor,
  onAddSearchMonitor,
  onRemoveMonitor,
}: {
  values: SegmentFormValues;
  onChange: SegmentFormChangeHandler;
  hideName: boolean;
  onAddDomainMonitor?: (input: { name: string; domain: string }) => Promise<void> | void;
  onAddSearchMonitor?: (input: { name?: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
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

      {/* Monitors — Sources + Search Queries.
          Same pattern AnalystConfigForm uses on its Monitors tab. */}
      <MonitorsSections
        values={values}
        onAddDomainMonitor={onAddDomainMonitor}
        onAddSearchMonitor={onAddSearchMonitor}
        onRemoveMonitor={onRemoveMonitor}
      />
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

// ─── Monitors sections — Sources + Search Queries ───────────────────────────
// Mirror of AnalystConfigForm's MonitorsTab. Two sections: Sources (DOMAIN
// monitors, favicon + name rows) and Search Queries (SEARCH monitors,
// Search-icon + query rows). Display rows match the analyst sheet exactly.
//
// Inline add forms live below each section so the user can edit monitors
// directly without going through an AI chat. The same callbacks work for
// both surfaces (server actions vs in-memory mutators).

function MonitorsSections({
  values,
  onAddDomainMonitor,
  onAddSearchMonitor,
  onRemoveMonitor,
}: {
  values: SegmentFormValues;
  onAddDomainMonitor?: (input: { name: string; domain: string }) => Promise<void> | void;
  onAddSearchMonitor?: (input: { name?: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
}) {
  return (
    <div className="flex flex-col">
      <Section
        label="Sources"
        tooltip="Websites the intelligence pipeline crawls daily for this segment. Same Sonar + Firecrawl pipeline as analyst monitors."
      >
        {values.domainMonitors.length > 0 ? (
          <div className="flex flex-col gap-1">
            {values.domainMonitors.map((s) => (
              <div
                key={s.id}
                className="group/row flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                  alt=""
                  width={14}
                  height={14}
                  className="size-3.5 rounded-sm shrink-0"
                />
                <span className="truncate flex-1">{s.name}</span>
                {onRemoveMonitor && (
                  <button
                    type="button"
                    onClick={() => onRemoveMonitor(s.id)}
                    className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    aria-label="Remove source"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyHint>None — add a domain below.</EmptyHint>
        )}

        {onAddDomainMonitor && <AddDomainForm onAdd={onAddDomainMonitor} />}
      </Section>

      <Section
        label="Search Queries"
        tooltip="Daily Sonar queries that surface new material for this segment. Same Monitor table the analyst surface uses."
      >
        <div className="flex flex-col gap-1">
          {values.searchMonitors.length === 0 ? (
            <EmptyHint>None — add a query below.</EmptyHint>
          ) : (
            values.searchMonitors.map((q) => (
              <div
                key={q.id}
                className="group/row flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8"
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{q.query || q.name}</span>
                {onRemoveMonitor && (
                  <button
                    type="button"
                    onClick={() => onRemoveMonitor(q.id)}
                    className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    aria-label="Remove query"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {onAddSearchMonitor && <AddSearchForm onAdd={onAddSearchMonitor} />}
      </Section>

      <p className="px-3 py-3 text-[11px] text-muted-foreground/60 leading-relaxed">
        Plus any signal that hits this segment&apos;s topic fence is
        considered during a run.
      </p>
    </div>
  );
}

function AddDomainForm({
  onAdd,
}: {
  onAdd: (input: { name: string; domain: string }) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!trimmedDomain) return;
    setBusy(true);
    try {
      await onAdd({ name: name.trim() || trimmedDomain, domain: trimmedDomain });
      setName("");
      setDomain("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end pt-2">
      <Input
        value={name}
        placeholder="Source name (optional)"
        className={cn(GHOST_INPUT, "text-xs h-8")}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        value={domain}
        placeholder="domain.com"
        className={cn(GHOST_INPUT, "text-xs h-8")}
        onChange={(e) => setDomain(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Button size="sm" disabled={busy} onClick={submit}>
        <Plus className="h-3 w-3" />
        Add
      </Button>
    </div>
  );
}

function AddSearchForm({
  onAdd,
}: {
  onAdd: (input: { name?: string; query: string }) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onAdd({ query: trimmed });
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-end pt-2">
      <Input
        value={query}
        placeholder="Search query — e.g. indie game launches this week steam"
        className={cn(GHOST_INPUT, "text-xs h-8")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Button size="sm" disabled={busy} onClick={submit}>
        <Plus className="h-3 w-3" />
        Add
      </Button>
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
