"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { StockLogo } from "@/components/StockLogo";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";
import { GICS_SECTORS, GICS_INDUSTRIES } from "@/lib/universe/gics";
import { ROUTE_REASON_LABELS, type RouteReasonCode } from "./types";

// ── Public API ───────────────────────────────────────────────────────────────

export interface SignalFiltersValue {
  tickers: string[];
  sectors: string[];
  industries: string[];
  analystIds: string[];
  routeReasonCode: RouteReasonCode | null;
}

export interface AnalystOption {
  id: string;
  name: string;
}

export function emptySignalFilters(): SignalFiltersValue {
  return {
    tickers: [],
    sectors: [],
    industries: [],
    analystIds: [],
    routeReasonCode: null,
  };
}

export function hasActiveFilters(v: SignalFiltersValue): boolean {
  return (
    v.tickers.length > 0 ||
    v.sectors.length > 0 ||
    v.industries.length > 0 ||
    v.analystIds.length > 0 ||
    v.routeReasonCode != null
  );
}

/** Serialize to URLSearchParams-ready object for /api/intelligence/signals. */
export function toSignalQuery(v: SignalFiltersValue): Record<string, string> {
  const q: Record<string, string> = {};
  if (v.tickers.length) q.ticker = v.tickers.join(",");
  if (v.sectors.length) q.sector = v.sectors.join(",");
  if (v.industries.length) q.industry = v.industries.join(",");
  if (v.analystIds.length) q.analystId = v.analystIds.join(",");
  if (v.routeReasonCode) q.routeReasonCode = v.routeReasonCode;
  return q;
}

interface SignalFiltersProps {
  value: SignalFiltersValue;
  onChange: (next: SignalFiltersValue) => void;
  analystOptions?: AnalystOption[];
  showAnalyst?: boolean;
  showRoute?: boolean;
  tickerSuggestions?: string[];
}

export function SignalFilters({
  value,
  onChange,
  analystOptions = [],
  showAnalyst = false,
  showRoute = false,
  tickerSuggestions = [],
}: SignalFiltersProps) {
  const patch = <K extends keyof SignalFiltersValue>(
    k: K,
    next: SignalFiltersValue[K],
  ) => onChange({ ...value, [k]: next });

  const active = hasActiveFilters(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <TickerFilter
          values={value.tickers}
          suggestions={tickerSuggestions}
          onChange={(v) => patch("tickers", v)}
        />
        <StaticMultiFilter
          label="Sector"
          values={value.sectors}
          options={GICS_SECTORS as unknown as string[]}
          onChange={(v) => patch("sectors", v)}
        />
        <StaticMultiFilter
          label="Industry"
          values={value.industries}
          options={GICS_INDUSTRIES as unknown as string[]}
          onChange={(v) => patch("industries", v)}
        />
        {showAnalyst && (
          <AnalystFilter
            values={value.analystIds}
            options={analystOptions}
            onChange={(v) => patch("analystIds", v)}
          />
        )}
        {showRoute && (
          <RouteFilter
            value={value.routeReasonCode}
            onChange={(v) => patch("routeReasonCode", v)}
          />
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(emptySignalFilters())}
          >
            Clear
          </Button>
        )}
      </div>

      {active && (
        <div className="flex flex-wrap gap-1.5">
          {value.tickers.map((t) => (
            <ChipBadge
              key={`t-${t}`}
              label={t}
              onClear={() =>
                patch(
                  "tickers",
                  value.tickers.filter((x) => x !== t),
                )
              }
            />
          ))}
          {value.sectors.map((s) => (
            <ChipBadge
              key={`s-${s}`}
              label={s}
              onClear={() =>
                patch(
                  "sectors",
                  value.sectors.filter((x) => x !== s),
                )
              }
            />
          ))}
          {value.industries.map((i) => (
            <ChipBadge
              key={`i-${i}`}
              label={i}
              onClear={() =>
                patch(
                  "industries",
                  value.industries.filter((x) => x !== i),
                )
              }
            />
          ))}
          {value.analystIds.map((id) => {
            const a = analystOptions.find((o) => o.id === id);
            if (!a) return null;
            return (
              <ChipBadge
                key={`a-${id}`}
                label={a.name}
                onClear={() =>
                  patch(
                    "analystIds",
                    value.analystIds.filter((x) => x !== id),
                  )
                }
              />
            );
          })}
          {value.routeReasonCode && (
            <ChipBadge
              label={ROUTE_REASON_LABELS[value.routeReasonCode]}
              onClear={() => patch("routeReasonCode", null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ChipBadge({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Badge variant="secondary">
      <span>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        aria-label={`Remove ${label}`}
      >
        <X />
      </Button>
    </Badge>
  );
}

function triggerLabel(label: string, count: number): string {
  return count > 0 ? `${label} · ${count}` : label;
}

// ── Static multi combobox (Sector, Industry) ────────────────────────────────

function StaticMultiFilter({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(
      values.includes(v) ? values.filter((x) => x !== v) : [...values, v],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            {triggerLabel(label, values.length)}
            <ChevronsUpDown />
          </Button>
        }
      />
      <PopoverContent align="start" className="p-0">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => toggle(opt)}
                >
                  <Check
                    className={
                      values.includes(opt) ? "opacity-100" : "opacity-0"
                    }
                  />
                  {opt}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Analyst multi filter ────────────────────────────────────────────────────

function AnalystFilter({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: AnalystOption[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) =>
    onChange(
      values.includes(id) ? values.filter((x) => x !== id) : [...values, id],
    );

  if (options.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            {triggerLabel("Analyst", values.length)}
            <ChevronsUpDown />
          </Button>
        }
      />
      <PopoverContent align="start" className="p-0">
        <Command>
          <CommandInput placeholder="Search analysts…" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.name}
                  onSelect={() => toggle(o.id)}
                >
                  <Check
                    className={
                      values.includes(o.id) ? "opacity-100" : "opacity-0"
                    }
                  />
                  {o.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Route single-select ─────────────────────────────────────────────────────

const ROUTE_REASON_CODES: RouteReasonCode[] = [
  "DISCOVERY",
  "SECTOR_MATCH",
  "INDUSTRY_MATCH",
  "THEME_MATCH",
  "WATCHLIST",
  "POSITION",
  "DIRECT_TICKER",
  "CROSS_ANALYST",
];

function RouteFilter({
  value,
  onChange,
}: {
  value: RouteReasonCode | null;
  onChange: (next: RouteReasonCode | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            {value ? `Route · ${ROUTE_REASON_LABELS[value]}` : "Route"}
            <ChevronsUpDown />
          </Button>
        }
      />
      <PopoverContent align="start" className="p-0">
        <Command>
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="_all"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={value === null ? "opacity-100" : "opacity-0"}
                />
                All routes
              </CommandItem>
              {ROUTE_REASON_CODES.map((code) => (
                <CommandItem
                  key={code}
                  value={code}
                  onSelect={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={value === code ? "opacity-100" : "opacity-0"}
                  />
                  {ROUTE_REASON_LABELS[code]}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Ticker async multi filter ───────────────────────────────────────────────

function TickerFilter({
  values,
  suggestions,
  onChange,
}: {
  values: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ symbol: string; name: string }[]>(
    [],
  );

  const runSearch = async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const r = await searchStocks(query.trim());
      setResults(r.map((s) => ({ symbol: s.symbol, name: s.name })));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };
  const debouncedSearch = useDebounce(runSearch, 300);

  useEffect(() => {
    debouncedSearch();
  }, [query, debouncedSearch]);

  const toggle = (sym: string) =>
    onChange(
      values.includes(sym)
        ? values.filter((x) => x !== sym)
        : [...values, sym],
    );

  const suggestionOptions = suggestions.filter((s) => !values.includes(s));
  const showingSuggestions = !query.trim() && suggestionOptions.length > 0;
  const showingResults = !!query.trim() && results.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            {triggerLabel("Ticker", values.length)}
            <ChevronsUpDown />
          </Button>
        }
      />
      <PopoverContent align="start" className="p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search tickers…"
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Searching…
                </span>
              </div>
            )}
            {!loading &&
              !query.trim() &&
              values.length === 0 &&
              suggestionOptions.length === 0 && (
                <CommandEmpty>Type a ticker to search</CommandEmpty>
              )}
            {!loading && query.trim() && results.length === 0 && (
              <CommandEmpty>No results</CommandEmpty>
            )}

            {values.length > 0 && (
              <CommandGroup heading="Selected">
                {values.map((sym) => (
                  <CommandItem
                    key={`sel-${sym}`}
                    value={sym}
                    onSelect={() => toggle(sym)}
                  >
                    <Check className="opacity-100" />
                    <StockLogo ticker={sym} size="sm" />
                    <span className="font-medium">{sym}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showingSuggestions && (
              <CommandGroup heading="Your stocks">
                {suggestionOptions.map((sym) => (
                  <CommandItem
                    key={`sug-${sym}`}
                    value={sym}
                    onSelect={() => toggle(sym)}
                  >
                    <Check className="opacity-0" />
                    <StockLogo ticker={sym} size="sm" />
                    <span className="font-medium">{sym}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showingResults && (
              <CommandGroup heading="Results">
                {results.map((r) => (
                  <CommandItem
                    key={r.symbol}
                    value={r.symbol}
                    onSelect={() => toggle(r.symbol)}
                  >
                    <Check
                      className={
                        values.includes(r.symbol)
                          ? "opacity-100"
                          : "opacity-0"
                      }
                    />
                    <StockLogo ticker={r.symbol} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.symbol}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.name}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
