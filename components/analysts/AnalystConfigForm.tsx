"use client";

import { useState } from "react";
import { Info, Search, ArrowRight } from "lucide-react";

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

import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";
import { FEEDS, feedLabel } from "@/lib/universe/feeds";

// ─── Form value shape ────────────────────────────────────────────────────────
// Canonical shape both wrappers normalize into. The form is presentation-only
// and emits onChange<K>(field, value) — wrappers decide where the value goes
// (DB save vs. local state).

export type FormSource = {
  name: string;
  domain: string;
  reason?: string;
};

export type FormQuery = {
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
  maxPositionSize: number;

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
  defaultTab?: "brief" | "watchlist" | "monitors" | "settings";
  /** Symbol → live price, used by the watchlist rows. */
  livePrices?: Record<string, number>;
  /** When true, expose a Watchlist tab. Sheet hides it; builder/editor shows it. */
  showWatchlist?: boolean;
}

export function AnalystConfigForm({
  values,
  onChange,
  hideName = false,
  defaultTab = "brief",
  livePrices,
  showWatchlist = false,
}: AnalystConfigFormProps) {
  return (
    <TooltipProvider>
      <Tabs defaultValue={defaultTab} className="flex flex-col h-full min-h-0">
        <div className="px-3 pt-1 shrink-0">
          <TabsList>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            {showWatchlist && <TabsTrigger value="watchlist">Watchlist</TabsTrigger>}
            <TabsTrigger value="monitors">Monitors</TabsTrigger>
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
            <MonitorsTab values={values} onChange={onChange} />
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

function MonitorsTab({
  values,
  onChange,
}: {
  values: FormValues;
  onChange: FormChangeHandler;
}) {
  const hasAny =
    values.sources.length > 0 || values.searchQueries.length > 0;

  return (
    <div className="flex flex-col">
      <Section
        label="Sources"
        tooltip="Websites monitored daily by Perplexity Sonar + Firecrawl. Edit via the AI chat."
      >
        {values.sources.length > 0 ? (
          <div className="flex flex-col gap-1">
            {values.sources.map((s) => (
              <Tooltip key={s.domain}>
                <TooltipTrigger
                  render={
                    <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                        alt=""
                        width={14}
                        height={14}
                        className="size-3.5 rounded-sm shrink-0"
                      />
                      <span className="truncate flex-1">{s.name}</span>
                    </div>
                  }
                />
                {s.reason && <TooltipContent side="left">{s.reason}</TooltipContent>}
              </Tooltip>
            ))}
          </div>
        ) : (
          <EmptyHint>None — use the AI chat to suggest sources.</EmptyHint>
        )}
      </Section>

      <Section
        label="Search Queries"
        tooltip="Daily Sonar queries that route results to this analyst. Edit via the AI chat."
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
            <Tooltip key={`${q.query}-${i}`}>
              <TooltipTrigger
                render={
                  <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default min-h-8">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{q.query}</span>
                  </div>
                }
              />
              {q.reason && <TooltipContent side="left">{q.reason}</TooltipContent>}
            </Tooltip>
          ))}
          {values.searchQueries.length === 0 && (
            <EmptyHint>No additional queries — use the AI chat to suggest some.</EmptyHint>
          )}
        </div>
      </Section>

      <p className="px-3 py-3 text-[11px] text-muted-foreground/60 leading-relaxed">
        Plus any signal that hits this analyst's Universe fence
        (Sectors / Industries / Themes / Feeds) is routed here automatically.
      </p>

      {!hasAny && (
        <div className="text-xs text-muted-foreground/40 py-6 text-center">
          No monitors yet.
        </div>
      )}
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

          <RowLabel
            label="Hold Duration"
            tooltip="Day (intraday), Swing (days–weeks), Position (weeks–months)."
          />
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

          <RowLabel
            label="Max Position Size"
            tooltip="Biggest single trade (paper dollars) this analyst can open. Enforced."
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
    </div>
  );
}

// ─── Shared building blocks ──────────────────────────────────────────────────

function Section({
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

function FieldGroup({
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
function RowLabel({ label, tooltip }: { label: string; tooltip?: React.ReactNode }) {
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
const GHOST_INPUT =
  "border-transparent bg-transparent shadow-none dark:bg-transparent hover:bg-accent/50 hover:border-input focus-visible:bg-background focus-visible:border-ring";

function EmptyHint({ children }: { children: React.ReactNode }) {
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

