"use client";

/**
 * The read, zoomed in: a thesis on the left, the explanation on the right.
 * Chips pick one of the five ways an agent reads a thesis; in a situation,
 * a second pick names the situation. The fields that read carries light up
 * on the sheet and the rest fade. Under it, the grid: every field, when it
 * is sent. Which field rides in which read is the one builder's field map
 * (lib/agent/row-for-model.ts ROW_FIELDS), read on the server
 * (lib/docs/read-grid.ts) and handed down; nothing here is hand-written.
 */

import { useState } from "react";
import { AnalystCards } from "@/components/domain/analyst-consensus";
import { ConvictionChip, StatusPill } from "@/components/domain/thesis-header";
import { StatGrid } from "@/components/stocks/StatGrid";
import { Badge } from "@/components/ui/badge";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { PriceChange } from "@/components/ui/price-change";
import { FlagNotificationIcon } from "@/components/ui/flag-notification-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon, FlashIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EXAMPLE_LINE,
  LINE_KEYS,
  READ_CASES,
  READ_SIZES,
  SHEET_FIELDS,
  WRITER_KEYS,
  fieldsLit,
  type FrameworkData,
  type ReadCase,
  type ReadGridRow,
  type ReadWhen,
  type SheetField,
  type SituationOrigin,
} from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { useFrameworkData } from "../tool-catalog";
import { Mono } from "../primitives";

/** The Street on CRWD, in the shape the stock page's two cards take. */
const STREET = {
  ticker: "CRWD",
  consensus: { buy: 23, hold: 7, sell: 0, unknown: 0, total: 30, period: "2026-10-16" },
  priceTargets: { low: 380, average: 451, median: 450, high: 520, numAnalysts: 30, asOf: "2026-10-16" },
  eps: { nextQuarter: 1.04, up: 6, down: 1 },
};

/** The chart numbers, in the stock page's stat grid. */
const CHART_STATS = [
  [
    { label: "20-day", value: "$402" },
    { label: "50-day", value: "$388" },
    { label: "200-day", value: "$351" },
  ],
  [
    { label: "RSI", value: "64" },
    { label: "vs the S&P, 3M", value: "+9%" },
  ],
];

/** The sheet's own drawing of a field, where it has one; the label + text stack otherwise. */
function FieldBody({ f }: { f: SheetField }) {
  switch (f.id) {
    case "stock":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status="HOLDING" />
          <Badge variant="secondary" className="font-normal">Long</Badge>
          <Badge variant="secondary" className="font-normal">PEAD</Badge>
          <ConvictionChip conviction="MEDIUM" />
        </div>
      );
    case "price":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold tabular-nums text-foreground">$418.20</span>
            <PriceChange dollarChange={26.62} percentChange={6.8} size="sm" />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">2.1% from the buy</span>
        </div>
      );
    case "position":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-foreground tabular-nums">Bought 14 shares at $404.10, now trading at $418.20</span>
          <div className="flex items-center gap-2">
            <PnlBadge value={3.49} />
            <span className="text-xs text-muted-foreground tabular-nums">since Oct 15</span>
          </div>
        </div>
      );
    case "triggers":
      return (
        <div className="flex flex-wrap gap-1.5">
          {["Sell · below $384 on the close", "Review · above 10% from our entry", "Review · above the Street average", "Review · 5 days before earnings", "Review · every 30 days"].map((t) => (
            <Badge key={t} variant="secondary" className="font-normal tabular-nums">{t}</Badge>
          ))}
        </div>
      );
    case "proposal_waiting":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
            Sell 14 shares
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">placed 10-16 09:31 ET · expires 10-17</span>
        </div>
      );
    case "situations":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">Add or near target</Badge>
          <Badge variant="secondary" className="font-normal">Review due</Badge>
          <span className="text-xs text-muted-foreground">fired again, 3rd day</span>
        </div>
      );
    case "street":
      return (
        <div className="flex flex-col gap-2">
          <AnalystCards coverage={STREET} currentPrice={418.2} entry={404.1} />
        </div>
      );
    case "chart":
      return <StatGrid columns={CHART_STATS} />;
    default:
      return <span className="line-clamp-2 text-sm text-foreground">{f.value}</span>;
  }
}

/** The icon on a situation's badge: the sheet's bolt for a trigger firing, its flag for a flag read off the facts. */
function OriginIcon({ origin }: { origin: SituationOrigin }) {
  return origin === "trigger" ? <HugeiconsIcon icon={FlashIcon} className="size-3" /> : <FlagNotificationIcon className="size-3" />;
}

/**
 * When a field is sent, as the stock page's chips under the company line:
 * one badge per situation that sends it (filled while that situation is the
 * one picked), "Review clock" on the review-only fields, "By name" on the
 * rest; nothing on a field every flagged stock gets.
 */
function WhenBadges({ row, activeCode }: { row: ReadGridRow | undefined; activeCode: string | null }) {
  if (!row || row.when === "always") return null;
  if (row.when === "review") {
    return (
      <Badge variant={activeCode === "REVIEW_DUE" ? "default" : "secondary"}>
        <HugeiconsIcon icon={Clock01Icon} className="size-3" />
        <span className="font-normal">Review clock</span>
      </Badge>
    );
  }
  if (row.when === "named") {
    return (
      <Badge variant={activeCode === "NAMED" ? "default" : "secondary"}>
        <HugeiconsIcon icon={Search01Icon} className="size-3" />
        <span className="font-normal">By name</span>
      </Badge>
    );
  }
  return (
    <>
      {row.situations.map((sit) => (
        <Badge key={sit.code} variant={activeCode === sit.code ? "default" : "secondary"}>
          <OriginIcon origin={sit.origin} />
          <span className="font-normal">{sit.name}</span>
        </Badge>
      ))}
    </>
  );
}

const WHEN_WORDS: Record<ReadWhen, string> = {
  always: "Always",
  situations: "Depends",
  review: "Review clock",
  named: "By name",
};

/** The situation the picker starts on: the one most mornings have. */
const FIRST_SITUATION = "PROTECTIVE_SALE";

export function ReadDemo({ data }: { data?: FrameworkData }) {
  const fromContext = useFrameworkData();
  const d = data ?? fromContext;
  const [caseId, setCaseId] = useState<ReadCase["id"]>(READ_CASES[0].id);
  const [code, setCode] = useState<string>(FIRST_SITUATION);
  const c = READ_CASES.find((x) => x.id === caseId) ?? READ_CASES[0];
  const read = d?.read;
  const situations = d?.situations ?? [];
  const situation = situations.find((s) => s.code === code) ?? situations[0];

  // The keys this read sends, from the server's map; without it (a guide page with no data) the two fixed reads only.
  const keys: readonly string[] =
    c.id === "line" ? LINE_KEYS
    : c.id === "writer" ? WRITER_KEYS
    : c.id === "situation" ? (read?.keys.bySituation[situation?.code ?? ""] ?? [])
    : c.id === "review" ? (read?.keys.review ?? [])
    : (read?.keys.named ?? []);
  const lit = fieldsLit(keys);
  const carried = SHEET_FIELDS.filter((f) => lit.has(f.id));
  const sample =
    c.id === "line" ? (read?.samples.line ?? EXAMPLE_LINE)
    : c.id === "situation" ? read?.samples.bySituation[situation?.code ?? ""]
    : c.id === "review" ? read?.samples.review
    : c.id === "named" ? read?.samples.named
    : undefined;
  // In a situation: the fields beyond the standing nine, named for the picked situation.
  const standing = new Set((read?.grid ?? []).filter((g) => g.when === "always").map((g) => g.fieldId));
  const extra = c.id === "situation" ? carried.filter((f) => !standing.has(f.id)) : [];
  const sizeWords =
    c.size === "line" ? `One line, ${READ_SIZES.line}.`
    : c.size === "short" ? `The row, ${READ_SIZES.short}.`
    : c.size === "full" ? `The full row, ${READ_SIZES.full}.`
    : "The existing thesis, in the Writer's own prompt.";
  const instructions = c.id === "situation" ? situation : c.id === "review" ? situations.find((s) => s.code === "REVIEW_DUE") : undefined;
  // The badge that is "met" in this read: the picked situation, the review clock, or a read by name.
  const activeCode = c.id === "situation" ? (situation?.code ?? null) : c.id === "review" ? "REVIEW_DUE" : c.id === "named" ? "NAMED" : null;
  const gridRow = (fieldId: string) => read?.grid.find((g) => g.fieldId === fieldId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChipTabs
          options={READ_CASES.map((x) => ({ value: x.id, label: x.chip, title: x.title }))}
          value={c.id}
          onChange={(v) => { if (v != null) setCaseId(v); }}
          clearable={false}
        />
        {c.id === "situation" && situations.length > 0 ? (
          <Select value={situation?.code ?? ""} onValueChange={(v) => { if (v) setCode(v); }}>
            <SelectTrigger size="sm" aria-label="The situation">
              <SelectValue>{situation?.name ?? "the situation"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {situations.map((s) => (
                <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div
        className="grid gap-4 rounded-2xl border bg-muted/40 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        {/* The thesis, as the sheet shows it: one stack, every field. At
            desktop the card is taken out of the row's sizing (absolute in its
            cell) so the right column alone sets the height and the sheet
            scrolls inside it; stacked (under lg) it is a fixed height so the
            page doesn't grow by the whole sheet. */}
        <div className="relative min-h-0 min-w-0 lg:min-h-[28rem]">
          <div className="flex max-h-[32rem] min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm lg:absolute lg:inset-0 lg:max-h-none">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold text-foreground">C</span>
              <span className="text-sm font-medium text-foreground">CRWD</span>
              <span className="text-sm text-muted-foreground">CrowdStrike</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {carried.length} of {SHEET_FIELDS.length} fields sent
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:none]">
              <div className="flex flex-col gap-1">
                {SHEET_FIELDS.map((f) => {
                  const on = lit.has(f.id);
                  return (
                    <div
                      key={f.id}
                      data-lit={on ? "true" : undefined}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg px-2.5 py-2",
                        on ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "opacity-40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{f.label}</span>
                        <WhenBadges row={gridRow(f.id)} activeCode={activeCode} />
                      </div>
                      <FieldBody f={f} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* The scenario: what is going on, what is sent, why that much. */}
        <div className="flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-medium text-foreground">{c.title}</h3>
            <p className="text-sm text-muted-foreground">{c.body}</p>
          </div>

          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What is going on</span>
              <p className="text-foreground">{c.when}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What the agent is sent</span>
              <p className="text-foreground">{sizeWords} {c.how}</p>
              {c.id === "situation" && situation ? (
                <p className="text-foreground">
                  With <span className="font-medium">{situation.name}</span>:{" "}
                  {extra.length ? extra.map((f) => f.label.toLowerCase()).join(" · ") : "the standing fields only"}.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why that much</span>
              <p className="text-foreground">{c.why}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">As the model reads it</span>
            {/* Built from the row the sheet shows, through the one builder (lib/docs/read-sample.ts); the Writer's case is its own prompt block. */}
            {c.id === "line" ? (
              <Mono as="pre" className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
                {sample}
              </Mono>
            ) : (
              <Mono as="pre" className="max-h-40 overflow-hidden whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
                {sample ?? carried.map((f) => `${f.label.toLowerCase()}: ${f.value}`).join("\n")}
              </Mono>
            )}
            {instructions ? (
              <div className="flex flex-col gap-1 rounded-lg border border-dashed border-sky-400 bg-sky-400/10 p-3">
                <span className="text-xs font-medium text-foreground">
                  + the situation&apos;s instructions, once: {instructions.name}{" "}
                  <span className="text-muted-foreground">· {instructions.chars.toLocaleString("en-US")} characters, from the situations table</span>
                </span>
                <span className="text-sm text-muted-foreground">&ldquo;{instructions.opening}&rdquo;</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* The grid: every field, when it is sent on a stock in a situation. Read off the builder's field map on the server. */}
      {read ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Every field on the sheet and when a stock in a situation sends it. A bolt is a situation a trigger firing puts the stock in, a flag one read off the stock&apos;s facts. The review clock and a read by name carry every field above them too; a quiet stock sends only its line.
          </p>
          <div className="overflow-x-auto rounded-xl border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>With which situations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {read.grid.map((g) => {
                  const f = SHEET_FIELDS.find((x) => x.id === g.fieldId);
                  return (
                    <TableRow key={g.fieldId}>
                      <TableCell className="text-foreground">{f?.label ?? g.fieldId}</TableCell>
                      <TableCell>
                        <Badge variant={g.when === "always" ? "default" : "secondary"} className="font-normal">{WHEN_WORDS[g.when]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {g.when === "situations" ? (
                          <div className="flex flex-wrap gap-1.5">
                            <WhenBadges row={g} activeCode={activeCode} />
                          </div>
                        ) : g.when === "review" ? "the review clock, and by name" : g.when === "named" ? "only when asked for by name" : "every stock in a situation"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
