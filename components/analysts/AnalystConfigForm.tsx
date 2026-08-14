"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Search, ArrowRight, Plus, X, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WatchlistRow, AddStockRow } from "@/components/ui/trade-row";
import { StockSearch } from "@/components/stocks/StockSearch";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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

import { LevelTriggersSection } from "@/components/settings/LevelTriggersSection";
import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";
import { positionBand } from "@/lib/agent/position-sizing";
import { FEEDS, feedLabel } from "@/lib/universe/feeds";

// ─── Form value shape ────────────────────────────────────────────────────────
// Canonical shape both wrappers normalize into. The form is presentation-only
// and emits onChange<K>(field, value) — wrappers decide where the value goes
// (DB save vs. local state).

export type FormSource = {
  /** Monitor row id — present for persisted monitors so add/remove can target them. Absent on transient/preview rows. */
  id?: string;
  name: string;
  domain: string;
  reason?: string;
};

export type FormQuery = {
  /** Monitor row id — present for persisted monitors so add/remove can target them. Absent on transient/preview rows. */
  id?: string;
  query: string;
  reason?: string;
};

export type FormPolicy = {
  holdingsAttention?: number;
  watchlistAttention?: number;
  discoveryAttention?: number;
  maxSignalsPerRun?: number;
  allowLiveSearch?: boolean;
};

export type FormValues = {
  name: string;
  description?: string | null;
  analystPrompt?: string | null;

  // Monitors
  watchlist: string[];
  sources: FormSource[];
  searchQueries: FormQuery[];

  // Trading rules
  directionBias: "LONG" | "SHORT" | "BOTH";
  holdDurations: string[];
  minConfidence: number;
  maxOpenPositions: number;
  // Position-size BAND — floor and ceiling, both enforced in place_trade.
  // minPositionSize of 0 means no floor.
  minPositionSize: number;
  maxPositionSize: number;

  // Live trading — set by the Promote dialog (PromoteAnalystDialog), surfaced
  // here so the promotion cap isn't invisible/uneditable after promotion. Both
  // are LIVE-only: realMaxPosition is ignored while PAPER (paper uses the plain
  // band). tradingEnvironment is read-only context here — promotion / demotion
  // runs through the Promote dialog, not this form.
  tradingEnvironment?: "PAPER" | "LIVE";
  realMaxPosition?: number;

  // Entry style — how this analyst reads its own entryPrice on a watching
  // thesis. See docs/plans/ENTRY_TRIGGER_SEMANTICS.md.
  entryTriggerMode?: "BREAKOUT" | "DIP";

  // Schedule — ISO weekdays (1=Mon..5=Fri) the daily morning run executes on.
  // Empty = every weekday (the cron reads empty defensively as "all weekdays").
  runDaysOfWeek?: number[];

  // Notifications — owner email opt-out, live across every email path.
  emailAlerts?: boolean;

  // Signal attention (read-only — set by Builder)
  intelligencePolicy?: FormPolicy | null;

  // Universe
  sectors: string[];
  industries: string[];
  themes: string[];
  feeds: string[];
  marketCapMin: number | null;
  marketCapMax: number | null;
  exclusionList: string[];
};

export type FormChangeHandler = <K extends keyof FormValues>(
  field: K,
  value: FormValues[K],
) => void;

// ─── Public form component ───────────────────────────────────────────────────

export interface AnalystConfigFormProps {
  values: FormValues;
  onChange: FormChangeHandler;
  /** When true, Brief tab hides the name field (the wrapper renders it in a header). */
  hideName?: boolean;
  defaultTab?: "brief" | "watchlist" | "monitors" | "triggers" | "settings";
  /**
   * AgentConfig id. When supplied, a Triggers tab renders this analyst's
   * standing rules (the ANALYST level of the trigger cascade). Omitted on
   * the builder, where the analyst doesn't exist yet and so has nothing
   * to hang rules on.
   */
  analystId?: string;
  /** Symbol → live price, used by the watchlist rows. */
  livePrices?: Record<string, number>;
  /** When true, expose a Watchlist tab. Sheet hides it; builder/editor shows it. */
  showWatchlist?: boolean;
  /**
   * Optional add/remove handlers for monitors. When supplied, the Monitors
   * tab renders inline add rows and per-row delete affordances — same
   * pattern as the podcast SegmentConfigForm. When omitted, the tab stays
   * read-only (preview / builder-driven surfaces).
   */
  onAddDomainMonitor?: (input: { name: string; domain: string }) => Promise<void> | void;
  onAddSearchMonitor?: (input: { name?: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
}

export function AnalystConfigForm({
  values,
  analystId,
  onChange,
  hideName = false,
  defaultTab = "brief",
  livePrices,
  showWatchlist = false,
  onAddDomainMonitor,
  onAddSearchMonitor,
  onRemoveMonitor,
}: AnalystConfigFormProps) {
  return (
    <TooltipProvider>
      <Tabs defaultValue={defaultTab} className="flex flex-col h-full min-h-0">
        <div className="px-3 pt-1 shrink-0">
          <TabsList>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            {showWatchlist && <TabsTrigger value="watchlist">Watchlist</TabsTrigger>}
            <TabsTrigger value="monitors">Monitors</TabsTrigger>
            {analystId && <TabsTrigger value="triggers">Triggers</TabsTrigger>}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="brief" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <BriefTab values={values} onChange={onChange} hideName={hideName} />
          </ScrollArea>
        </TabsContent>

        {showWatchlist && (
          <TabsContent value="watchlist" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <WatchlistTab values={values} onChange={onChange} livePrices={livePrices} />
            </ScrollArea>
          </TabsContent>
        )}

        <TabsContent value="monitors" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <MonitorsTab
              values={values}
              onChange={onChange}
              onAddDomainMonitor={onAddDomainMonitor}
              onAddSearchMonitor={onAddSearchMonitor}
              onRemoveMonitor={onRemoveMonitor}
            />
          </ScrollArea>
        </TabsContent>

        {analystId && (
          <TabsContent value="triggers" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <div className="space-y-4 p-3">
                <div className="space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Entry style
                  </span>
                  <Select
                    value={values.entryTriggerMode ?? "BREAKOUT"}
                    onValueChange={(v) => {
                      if (v === "BREAKOUT" || v === "DIP") {
                        onChange("entryTriggerMode", v);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {values.entryTriggerMode === "DIP"
                          ? "Buy the dip — enter when price falls to my level"
                          : "Buy confirmation — enter when price breaks above my level"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BREAKOUT">
                        Buy confirmation — enter when price breaks above my level
                      </SelectItem>
                      <SelectItem value="DIP">
                        Buy the dip — enter when price falls to my level
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Decides which way a watching thesis&apos;s entry trigger
                    compares against its entry price. Applies to new and
                    re-generated entry rungs.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground">
                  Standing rules for every thesis this analyst covers. Anything
                  not set here falls through to your account rules and the app
                  defaults; a single thesis can still override any of them. The
                  full ladder in force on a name is on its thesis.
                </p>
                <LevelTriggersSection level="analyst" ownerId={analystId} />
              </div>
            </ScrollArea>
          </TabsContent>
        )}

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
  values: FormValues;
  onChange: FormChangeHandler;
  hideName: boolean;
}) {
  return (
    <div className="p-3 flex flex-col gap-4">
      {!hideName && (
        <FieldGroup label="Name">
          <Input
            defaultValue={values.name}
            placeholder="Untitled Analyst"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== values.name) onChange("name", next);
            }}
          />
        </FieldGroup>
      )}

      <FieldGroup label="Description" tooltip="Short summary of what this analyst trades.">
        <Textarea
          defaultValue={values.description ?? ""}
          placeholder="Describe what this analyst trades…"
          rows={2}
          className="resize-y"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== (values.description ?? "")) onChange("description", next || null);
          }}
        />
        <p className="text-xs text-muted-foreground/60">
          Recommended: 150–200 characters — shown on the analyst card.
        </p>
      </FieldGroup>

      <StrategyField
        value={values.analystPrompt ?? ""}
        onSave={(next) => onChange("analystPrompt", next || null)}
      />
    </div>
  );
}

// Strategy field: FieldGroup with an inline Edit/Cancel/Save action slot.
function StrategyField({
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
          if (draft !== value) onSave(draft);
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
      label="Strategy"
      tooltip="The analyst's playbook — how it picks trades. Markdown supported."
      action={action}
    >
      {editing ? (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[320px] text-xs font-mono resize-y"
          placeholder="Write the analyst's strategy playbook here. Markdown supported."
        />
      ) : value ? (
        <Markdown variant="compact" className="text-muted-foreground">
          {value}
        </Markdown>
      ) : (
        <p className="text-xs text-muted-foreground/60">
          No strategy yet. Click Edit to write one, or use the AI chat.
        </p>
      )}
    </FieldGroup>
  );
}

// ─── Watchlist tab ───────────────────────────────────────────────────────────
// Lives behind the form's `showWatchlist` prop. Builder/editor expose it; the
// settings sheet hides it (a watchlist isn't really a "setting").

function WatchlistTab({
  values,
  onChange,
  livePrices,
}: {
  values: FormValues;
  onChange: FormChangeHandler;
  livePrices?: Record<string, number>;
}) {
  return (
    <div className="flex flex-col">
      <Section
        label="Watchlist"
        tooltip="Tickers this analyst monitors first. Bypasses the Universe fence."
      >
        <div className="flex flex-col -mx-3">
          {values.watchlist.map((symbol) => (
            <WatchlistRow
              key={symbol}
              ticker={symbol}
              currentPrice={livePrices?.[symbol]}
              onRemove={() =>
                onChange(
                  "watchlist",
                  values.watchlist.filter((s) => s !== symbol),
                )
              }
            />
          ))}
          <StockSearch
            excludeSymbols={values.watchlist}
            trigger={<AddStockRow />}
            onSelect={(symbol) => {
              if (values.watchlist.includes(symbol)) return;
              onChange("watchlist", [...values.watchlist, symbol]);
            }}
          />
        </div>
      </Section>
    </div>
  );
}

// ─── Monitors tab ────────────────────────────────────────────────────────────
//
// When add/remove handlers are supplied, this tab matches the podcast
// SegmentConfigForm's MonitorsSections 1:1 — same Section labels, same
// row layout, same hover-X delete affordance, same ghost-row inline add
// at the bottom. Without handlers, it falls back to a read-only tooltip
// view (used by preview surfaces that don't have a backing analystId).

function MonitorsTab({
  values,
  onAddDomainMonitor,
  onAddSearchMonitor,
  onRemoveMonitor,
}: {
  values: FormValues;
  onChange: FormChangeHandler;
  onAddDomainMonitor?: (input: { name: string; domain: string }) => Promise<void> | void;
  onAddSearchMonitor?: (input: { name?: string; query: string }) => Promise<void> | void;
  onRemoveMonitor?: (monitorId: string) => Promise<void> | void;
}) {
  return (
    <div className="flex flex-col">
      <Section
        label="Sources"
        tooltip="Websites monitored daily by Perplexity Sonar + Firecrawl. Add a domain or use the AI chat."
      >
        <div className="flex flex-col gap-1">
          {values.sources.map((s, i) => (
            <div
              key={s.id ?? `${s.domain}-${i}`}
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
              {onRemoveMonitor && s.id && (
                <button
                  type="button"
                  onClick={() => onRemoveMonitor(s.id!)}
                  className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                  aria-label="Remove source"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {onAddDomainMonitor && <AddDomainRow onAdd={onAddDomainMonitor} />}
          {!onAddDomainMonitor && values.sources.length === 0 && (
            <EmptyHint>None — use the AI chat to suggest sources.</EmptyHint>
          )}
        </div>
      </Section>

      <Section
        label="Search Queries"
        tooltip="Daily Sonar queries that route results to this analyst. Add a query or use the AI chat."
      >
        <div className="flex flex-col gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">Positions and Watchlist</span>
                </div>
              }
            />
            <TooltipContent side="left">
              Built-in. Every run queries each held position for latest news and catalysts, and each watchlist ticker for setups within this analyst's strategy.
            </TooltipContent>
          </Tooltip>
          {values.searchQueries.map((q, i) => (
            <div
              key={q.id ?? `${q.query}-${i}`}
              className="group/row flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{q.query}</span>
              {onRemoveMonitor && q.id && (
                <button
                  type="button"
                  onClick={() => onRemoveMonitor(q.id!)}
                  className="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                  aria-label="Remove query"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {onAddSearchMonitor && <AddSearchRow onAdd={onAddSearchMonitor} />}
          {!onAddSearchMonitor && values.searchQueries.length === 0 && (
            <EmptyHint>No additional queries — use the AI chat to suggest some.</EmptyHint>
          )}
        </div>
      </Section>

      <p className="px-3 py-3 text-[11px] text-muted-foreground/60 leading-relaxed">
        Plus any signal that hits this analyst&apos;s Universe fence
        (Sectors / Industries / Themes / Feeds) is routed here automatically.
      </p>
    </div>
  );
}

// ─── Ghost-row add UI ───────────────────────────────────────────────────────
//
// Copied verbatim from components/podcasts/SegmentConfigForm.tsx so the two
// surfaces are visually + behaviorally identical. Both Sources and Search
// Queries follow the same pattern: at the bottom of each list there's an
// extra "row" that pretends to be a real monitor row but with muted colors
// and a leading + icon. Clicking flips it into edit mode — the row layout
// and height stay identical, just the trailing span becomes a bare input.
// Pressing Enter commits via onAdd(); blur with empty input quietly returns
// to the ghost state. ESC also cancels.

function AddDomainRow({
  onAdd,
}: {
  onAdd: (input: { name: string; domain: string }) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = async () => {
    const trimmed = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onAdd({ name: trimmed, domain: trimmed });
      setDomain("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground/55 hover:text-foreground",
          "border-b border-border pb-1 last:border-0 min-h-8 w-full text-left",
          "transition-colors cursor-pointer",
        )}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Add a source</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 min-h-8">
      <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        value={domain}
        placeholder="domain.com"
        disabled={busy}
        onChange={(e) => setDomain(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDomain("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!domain.trim() && !busy) setEditing(false);
        }}
        className={cn(
          "flex-1 bg-transparent border-none outline-none text-sm",
          "placeholder:text-muted-foreground/55",
        )}
      />
    </div>
  );
}

function AddSearchRow({
  onAdd,
}: {
  onAdd: (input: { name?: string; query: string }) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onAdd({ query: trimmed });
      setQuery("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground/55 hover:text-foreground",
          "border-b border-border pb-1 last:border-0 min-h-8 w-full text-left",
          "transition-colors cursor-pointer",
        )}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Add a search query</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 min-h-8">
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        value={query}
        placeholder="e.g. AI tech capex announcements Q3 2026"
        disabled={busy}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setQuery("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!query.trim() && !busy) setEditing(false);
        }}
        className={cn(
          "flex-1 bg-transparent border-none outline-none text-sm",
          "placeholder:text-muted-foreground/55",
        )}
      />
    </div>
  );
}

// ─── Settings tab ────────────────────────────────────────────────────────────

function SettingsTab({
  values,
  onChange,
}: {
  values: FormValues;
  onChange: FormChangeHandler;
}) {
  const policy = values.intelligencePolicy;

  const holdings = clampShare(policy?.holdingsAttention);
  const watchlist = clampShare(policy?.watchlistAttention);
  const discovery = clampShare(policy?.discoveryAttention);
  const total = holdings + watchlist + discovery;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <div className="flex flex-col">
      {/* Trading rules ─────────────────────────────────────────── */}
      <Section label="Trading rules">
        <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
          <RowLabel
            label="Direction"
            tooltip="Bias the agent can take: Long only, Short only, or Both."
          />
          {/* Wrapper is load-bearing: base-ui Select.Root renders the trigger
              PLUS a visually-hidden form <input> as a SIBLING (see
              @base-ui/react SelectRoot: `children: [children, input]`). Without
              this div those are TWO direct grid children, throwing off the
              parent's `nth-child(even)` right-align count and shoving the NEXT
              row's label (Hold Duration) to the right. Keep the div. */}
          <div className="justify-self-end">
            <Select
              value={values.directionBias}
              onValueChange={(val) =>
                onChange("directionBias", val as FormValues["directionBias"])
              }
            >
              <SelectTrigger size="sm" variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LONG">Long</SelectItem>
                <SelectItem value="SHORT">Short</SelectItem>
                <SelectItem value="BOTH">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <RowLabel
            label="Hold Duration"
            tooltip="Day (intraday), Swing (days–weeks), Position (weeks–months)."
          />
          {/* Wrapped for the same base-ui hidden-input reason as Direction above. */}
          <div className="justify-self-end">
            <Select
              value={values.holdDurations[0] ?? "SWING"}
              onValueChange={(val) => {
                if (typeof val === "string") onChange("holdDurations", [val]);
              }}
            >
              <SelectTrigger size="sm" variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day</SelectItem>
                <SelectItem value="SWING">Swing</SelectItem>
                <SelectItem value="POSITION">Position</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {values.runDaysOfWeek !== undefined && (
            <>
              <RowLabel
                label="Daily run days"
                tooltip="ISO weekdays the 8 AM ET morning run executes for this analyst. Fewer days = lower cost. Intraday triggers are unaffected."
              />
              {/* Wrapper is load-bearing: base-ui DropdownMenu injects
                  data-base-ui-focus-guard <span>s as in-flow SIBLINGS of the
                  trigger while open. Without this div those guards become
                  direct children of the grid, shifting the nth-child(even)
                  alignment count and reflowing every row (the whole sheet
                  "jumps right" on open). The div keeps the trigger + its
                  guards as ONE stable grid cell. */}
              <div className="justify-self-end">
                <RunDaysControl
                  value={values.runDaysOfWeek}
                  onChange={(next) => onChange("runDaysOfWeek", next)}
                />
              </div>
            </>
          )}

          <RowLabel
            label="Min Confidence"
            tooltip="Lowest thesis confidence (0–100) that can place a trade. Enforced."
          />
          <Input
            type="number"
            defaultValue={values.minConfidence}
            min={0}
            max={100}
            className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n !== values.minConfidence) {
                onChange("minConfidence", Math.min(100, Math.max(0, n)));
              }
            }}
          />

          <RowLabel
            label="Max Positions"
            tooltip="Most concurrent open positions this analyst can hold. Enforced."
          />
          <Input
            type="number"
            defaultValue={values.maxOpenPositions}
            min={1}
            max={20}
            className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n !== values.maxOpenPositions) {
                onChange("maxOpenPositions", Math.min(20, Math.max(1, n)));
              }
            }}
          />

          {/* Position size is a BAND. The floor is the half that was missing:
              without it nothing stopped a $14k-ceiling analyst from opening a
              $3.5k position, and the only workaround was prose rules in the
              analyst prompt. Floor sits above Ceiling so the pair reads as one
              range. See lib/agent/position-sizing.ts. */}
          <RowLabel
            label="Position Size Floor"
            tooltip="Smallest single trade this analyst may open. An entry below this is rejected, not resized — the analyst commits real size or skips the name. 0 = no floor."
          />
          <Input
            type="number"
            defaultValue={values.minPositionSize}
            min={0}
            step={100}
            className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
            onBlur={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n !== values.minPositionSize) {
                onChange("minPositionSize", Math.max(0, n));
              }
            }}
          />

          <RowLabel
            label="Position Size Ceiling"
            tooltip="Biggest single trade this analyst can open. Enforced."
          />
          <Input
            type="number"
            defaultValue={values.maxPositionSize}
            min={0}
            step={100}
            className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
            onBlur={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n !== values.maxPositionSize) {
                onChange("maxPositionSize", Math.max(0, n));
              }
            }}
          />

          {/* Live promotion cap — a temporary throttle set at promotion so a
              freshly-live analyst trades small with real money, NOT a second
              ceiling. Raise it toward the band ceiling as the seat proves out.
              Paper runs ignore it entirely. */}
          {values.tradingEnvironment === "LIVE" && (
            <>
              <RowLabel
                label="Live promotion cap"
                tooltip="Temporary throttle on live orders, set at promotion so a newly-live analyst trades small with real money. Live orders cap at the lower of this and the ceiling. Raise it toward the ceiling as the seat proves out. Ignored while paper."
              />
              <Input
                type="number"
                defaultValue={values.realMaxPosition}
                min={0}
                step={100}
                className={cn(GHOST_INPUT, "w-24 text-right tabular-nums")}
                onBlur={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n) && n !== values.realMaxPosition) {
                    onChange("realMaxPosition", Math.max(0, n));
                  }
                }}
              />
            </>
          )}

          {typeof policy?.allowLiveSearch === "boolean" && (
            <>
              <RowLabel
                label="Live search"
                tooltip="When on, the agent can call live Perplexity Sonar mid-run. Set by the AI."
              />
              <Switch checked={policy.allowLiveSearch} disabled />
            </>
          )}
        </div>

        {/* Effective band — shown whenever either half is non-trivial, so a
            floor or a promotion cap below the visible boxes is never silent. */}
        {(values.minPositionSize > 0 ||
          (values.tradingEnvironment === "LIVE" &&
            values.realMaxPosition != null)) && (
          <PositionBandNote
            minPositionSize={values.minPositionSize}
            maxPositionSize={values.maxPositionSize}
            realMaxPosition={values.realMaxPosition}
            tradingEnvironment={values.tradingEnvironment}
          />
        )}

        {/* Signal attention — same label style as the rows above */}
        {policy && total > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <RowLabel
              label="Signal attention"
              tooltip="How the signal router splits the analyst's daily signal budget across holdings, watchlist, and new discovery."
            />
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div style={{ width: `${pct(holdings)}%` }} className="bg-positive" />
              <div style={{ width: `${pct(watchlist)}%` }} className="bg-positive/40" />
              <div
                style={{ width: `${pct(discovery)}%` }}
                className="bg-muted-foreground/50"
              />
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <LegendDot className="bg-positive" label="Holdings" pct={pct(holdings)} />
              <LegendDot
                className="bg-positive/40"
                label="Watchlist"
                pct={pct(watchlist)}
              />
              <LegendDot
                className="bg-muted-foreground/50"
                label="Discovery"
                pct={pct(discovery)}
              />
            </div>
          </div>
        )}
      </Section>

      {/* Universe ──────────────────────────────────────────────── */}
      <Section label="Universe">
        <FieldGroup
          label="Sectors"
          tooltip="GICS top-level sectors. AND-joined with Industries and Themes."
        >
          <EnumChipsCombobox
            values={values.sectors}
            options={SECTORS}
            placeholder="Add a sector…"
            onChange={(next) => onChange("sectors", next)}
          />
        </FieldGroup>

        <FieldGroup
          label="Industries"
          tooltip="Narrower than Sectors. AND-joined with Sectors and Themes."
        >
          <EnumChipsCombobox
            values={values.industries}
            options={INDUSTRIES}
            placeholder="Add an industry…"
            onChange={(next) => onChange("industries", next)}
          />
        </FieldGroup>

        <FieldGroup
          label="Themes"
          tooltip="Analyst-defined narratives. Signals tagged with any enter the fence."
        >
          <FreeTextChipsCombobox
            values={values.themes}
            placeholder="Free text — e.g. AI infrastructure, GLP-1, EV transition"
            onChange={(next) => onChange("themes", next)}
          />
        </FieldGroup>

        <FieldGroup
          label="Feeds"
          tooltip="Firm-aggregate firehoses (earnings calendar, top movers). Subscribed analysts get the full feed in their morning brief."
        >
          <EnumChipsCombobox
            values={values.feeds}
            options={FEEDS as readonly string[]}
            placeholder="Add a feed…"
            renderItem={feedLabel}
            onChange={(next) => onChange("feeds", next)}
          />
        </FieldGroup>

        <FieldGroup
          label="Exclusion list"
          tooltip="Hard-blocked tickers. Rejected even when held or on the watchlist."
        >
          <FreeTextChipsCombobox
            values={values.exclusionList}
            placeholder="Ticker to block"
            uppercase
            onChange={(next) => onChange("exclusionList", next)}
          />
        </FieldGroup>

        <MarketCapRange
          min={values.marketCapMin}
          max={values.marketCapMax}
          onChange={(field, v) => onChange(field, v)}
        />
      </Section>

      {/* Notifications ─────────────────────────────────────────── */}
      {typeof values.emailAlerts === "boolean" && (
        <Section label="Notifications">
          <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
            <RowLabel
              label="Email alerts"
              tooltip="Email the account owner on new trades, fills, and approval requests for this analyst."
            />
            <Switch
              checked={values.emailAlerts}
              onCheckedChange={(v) => onChange("emailAlerts", v)}
            />
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Run days control ────────────────────────────────────────────────────────
// Dropdown multi-select (Mon–Fri) driving AgentConfig.runDaysOfWeek (ISO
// weekdays 1=Mon..5=Fri). The morning-research cron gates on this array; the
// 5-min trigger cron ignores it, so intraday reactivity fires every day.
//
// Visually a peer of the Direction / Hold-Duration trading-rule dropdowns —
// a ghost-button trigger + chevron summarizing the current selection, with a
// checkbox menu (check on the RIGHT via DropdownMenuCheckboxItem, stays open
// on toggle so multiple days can be picked in one pass).
//
// An empty stored value means "all weekdays" (the cron's defensive default),
// so a null/empty/unset value renders as all five selected. To keep the stored
// value unambiguous, the control refuses to deselect the final remaining day —
// there's always at least one run day.
const RUN_DAYS: ReadonlyArray<{ iso: number; label: string }> = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
];

function RunDaysControl({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  // null/empty = all weekdays (cron semantics) → treat as all five selected.
  const selected =
    !value || value.length === 0 ? RUN_DAYS.map((d) => d.iso) : value;

  const summary =
    selected.length === RUN_DAYS.length
      ? "Every weekday"
      : RUN_DAYS.filter((d) => selected.includes(d.iso))
          .map((d) => d.label)
          .join(", ");

  const toggle = (iso: number, checked: boolean) => {
    const set = new Set(selected);
    if (checked) {
      set.add(iso);
    } else {
      // Never allow zero days — an empty array would be read as "all
      // weekdays", the opposite of what deselecting the last day looks like.
      if (set.size <= 1) return;
      set.delete(iso);
    }
    onChange([...set].sort((a, b) => a - b));
  };

  return (
    // modal={false}: a modal menu locks scroll + compensates for the
    // scrollbar on open, which shifts the whole config sheet sideways
    // (the Select-based Direction/Hold-Duration dropdowns are non-modal and
    // don't). Non-modal matches them and keeps the panel from reflowing.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm">
            {summary}
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {RUN_DAYS.map((day) => (
          <DropdownMenuCheckboxItem
            key={day.iso}
            checked={selected.includes(day.iso)}
            onCheckedChange={(checked) => toggle(day.iso, checked === true)}
          >
            {day.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Effective position-band note ────────────────────────────────────────────
// Restates the band place_trade will actually enforce, resolved by the SAME
// pure helper the tool gate uses (lib/agent/position-sizing.ts) so the number
// on screen can't drift from the number that rejects a trade. Two things it
// makes non-silent: a live promotion cap sitting below the ceiling, and a
// promotion cap sitting below the floor (band collapses to a single size).
function PositionBandNote({
  minPositionSize,
  maxPositionSize,
  realMaxPosition,
  tradingEnvironment,
}: {
  minPositionSize: number;
  maxPositionSize: number;
  realMaxPosition?: number;
  tradingEnvironment?: "PAPER" | "LIVE";
}) {
  const band = positionBand({
    environment: tradingEnvironment,
    minPositionSize,
    maxPositionSize,
    realMaxPosition,
  });
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const isLive = tradingEnvironment === "LIVE";
  const throttled =
    isLive && band.ceiling != null && band.ceiling < maxPositionSize;

  if (band.floorClampedByCeiling) {
    return (
      <p className="text-xs text-muted-foreground">
        The live promotion cap sits at or below the floor, so every live entry
        is sized exactly{" "}
        <span className="tabular-nums text-foreground">{fmt(band.floor)}</span>.
        Raise the cap to reopen the band.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      {isLive ? "Live entries" : "Entries"} land between{" "}
      <span className="tabular-nums text-foreground">{fmt(band.floor)}</span>{" "}
      and{" "}
      <span className="tabular-nums text-foreground">
        {band.ceiling != null ? fmt(band.ceiling) : "no ceiling"}
      </span>
      {throttled ? (
        <>
          {" "}— the promotion cap, below the{" "}
          <span className="tabular-nums">{fmt(maxPositionSize)}</span> ceiling
          above, so live trades stop there.
        </>
      ) : (
        <>. Anything outside the band is rejected, not resized.</>
      )}
    </p>
  );
}

// ─── Shared building blocks ──────────────────────────────────────────────────
// Exported so podcast / segment config forms can reuse the EXACT same visual
// language. Don't fork these. If you need a new variant, add a prop here and
// share it across analyst + podcast surfaces.

export function Section({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 border-b last:border-b-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium">{label}</p>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              <Info className="h-3 w-3 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

export function FieldGroup({
  label,
  tooltip,
  action,
  children,
}: {
  label: string;
  tooltip?: React.ReactNode;
  /** Optional element rendered on the right side of the label row. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {action ? (
        <div className="flex items-center justify-between">
          <RowLabel label={label} tooltip={tooltip} />
          {action}
        </div>
      ) : (
        <RowLabel label={label} tooltip={tooltip} />
      )}
      {children}
    </div>
  );
}

// Single label component shared by Trading-rules rows and Universe field groups
// so they read at the same size/weight.
export function RowLabel({ label, tooltip }: { label: string; tooltip?: React.ReactNode }) {
  return (
    <span className="text-sm text-muted-foreground flex items-center gap-1">
      {label}
      {tooltip && (
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-help inline-flex items-center" />}>
            <Info className="h-3 w-3 text-muted-foreground/70" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// Ghost input override: no border/bg until hover/focus. The user explicitly
// granted this exception — keep the className local so the shadcn Input
// primitive itself stays untouched.
export const GHOST_INPUT =
  "border-transparent bg-transparent shadow-none dark:bg-transparent hover:bg-accent/50 hover:border-input focus-visible:bg-background focus-visible:border-ring";

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/60">{children}</p>;
}

// ─── Chip combobox wrappers ──────────────────────────────────────────────────
// Pure shadcn Combobox (multiple) — exactly the docs example. Long labels are
// truncated by slicing the displayed string (a string concern, not CSS) so the
// shadcn primitives stay byte-identical to the registry.

const CHIP_MAX_CHARS = 22;
const truncateChip = (s: string) =>
  s.length > CHIP_MAX_CHARS ? s.slice(0, CHIP_MAX_CHARS - 1) + "…" : s;

function EnumChipsCombobox({
  values,
  options,
  onChange,
  placeholder,
  renderItem,
}: {
  values: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  renderItem?: (value: string) => string;
}) {
  const anchor = useComboboxAnchor();
  const display = (v: string) => (renderItem ? renderItem(v) : v);
  return (
    <Combobox
      multiple
      autoHighlight
      items={options as string[]}
      value={values}
      onValueChange={(next) => onChange((next as string[]) ?? [])}
    >
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {(selected: unknown) => (
            <>
              {(selected as string[]).map((v) => (
                <ComboboxChip key={v}>{truncateChip(display(v))}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder={values.length === 0 ? placeholder : ""} />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No items found.</ComboboxEmpty>
        <ComboboxList>
          {(item: unknown) => (
            <ComboboxItem key={item as string} value={item as string}>
              {display(item as string)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export { EnumChipsCombobox, FreeTextChipsCombobox };

function FreeTextChipsCombobox({
  values,
  onChange,
  placeholder,
  uppercase,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  uppercase?: boolean;
}) {
  const anchor = useComboboxAnchor();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const normalized = uppercase ? trimmed.toUpperCase() : trimmed;
    if (!values.includes(normalized)) onChange([...values, normalized]);
    setDraft("");
  };

  return (
    <Combobox
      multiple
      items={values}
      value={values}
      onValueChange={(next) => onChange((next as string[]) ?? [])}
      inputValue={draft}
      onInputValueChange={(v) => setDraft(v)}
    >
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {(selected: unknown) => (
            <>
              {(selected as string[]).map((v) => (
                <ComboboxChip key={v}>{truncateChip(v)}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={values.length === 0 ? placeholder : ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    e.preventDefault();
                    commit();
                  }
                }}
                onBlur={commit}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
    </Combobox>
  );
}


// ─── Market cap input ────────────────────────────────────────────────────────
// Stores dollars internally; displays in millions.

function MarketCapRange({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (field: "marketCapMin" | "marketCapMax", v: number | null) => void;
}) {
  const display = (v: number | null) =>
    v != null && Number.isFinite(v) ? Math.round(v / 1_000_000) : "";

  const commit = (
    field: "marketCapMin" | "marketCapMax",
    raw: string,
    current: number | null,
  ) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (current !== null) onChange(field, null);
      return;
    }
    const millions = parseFloat(trimmed);
    if (!Number.isFinite(millions)) return;
    const dollars = Math.round(millions * 1_000_000);
    if (dollars !== current) onChange(field, dollars);
  };

  return (
    <FieldGroup
      label="Market cap range"
      tooltip="Floor and ceiling in $M. Tickers outside the range are rejected from the fence. Blank = no bound."
    >
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupInput
            type="number"
            defaultValue={display(min)}
            min={0}
            step={100}
            placeholder="Min"
            onBlur={(e) => commit("marketCapMin", e.target.value, min)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>M</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <ArrowRight className="size-4 text-muted-foreground shrink-0" />
        <InputGroup className="flex-1">
          <InputGroupInput
            type="number"
            defaultValue={display(max)}
            min={0}
            step={100}
            placeholder="Max"
            onBlur={(e) => commit("marketCapMax", e.target.value, max)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>M</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </FieldGroup>
  );
}

// ─── Signal-attention legend dot ─────────────────────────────────────────────

function LegendDot({
  className,
  label,
  pct,
}: {
  className: string;
  label: string;
  pct: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", className)} />
      <span>{label}</span>
      <span className="tabular-nums">{pct}%</span>
    </span>
  );
}

function clampShare(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

