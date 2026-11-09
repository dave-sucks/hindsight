"use client";

/**
 * The read, zoomed in: a thesis on the left, the explanation on the right.
 * Chips pick one of the five ways an agent reads a thesis; the fields that
 * read carries light up on the sheet and the rest fade. Under each field, a
 * row of badges says when it goes: Always, with a named situation (a bolt
 * for one a trigger firing starts, a bubble for one read off the facts), on
 * the review clock, or by name. Which field rides in which read is the one
 * builder's field map (lib/agent/row-for-model.ts ROW_FIELDS), read on the
 * server (lib/docs/read-grid.ts) and handed down; nothing here is
 * hand-written.
 */

import { useState } from "react";
import { Zap } from "lucide-react";
import { AnalystCards } from "@/components/domain/analyst-consensus";
import { ConvictionChip, StatusPill } from "@/components/domain/thesis-header";
import { StatGrid } from "@/components/stocks/StatGrid";
import { Badge } from "@/components/ui/badge";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { PriceChange } from "@/components/ui/price-change";
import { FlagNotificationIcon } from "@/components/ui/flag-notification-icon";
import {
  EXAMPLE_LINE,
  LINE_KEYS,
  READ_CASES,
  SHEET_FIELDS,
  WRITER_KEYS,
  fieldsLit,
  type FrameworkData,
  type ReadCase,
  type ReadGridRow,
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

/** The situation whose row the "In a situation" sample shows: the one most mornings have. */
const EXAMPLE_SITUATION = "PROTECTIVE_SALE";

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

/** The icon on a situation's badge: a filled bolt for one a trigger firing starts, the filled bubble for one read off the facts; both the badge's text color. */
function OriginIcon({ origin }: { origin: SituationOrigin }) {
  return origin === "trigger" ? <Zap className="size-3" fill="currentColor" /> : <FlagNotificationIcon className="size-3" dot="current" />;
}

/**
 * When a field goes, as the fact chips under the stock page's company line:
 * "Always", one badge per situation that sends it, "Review clock" on the
 * review-only fields, "By name" on the rest.
 */
function WhenRow({ row }: { row: ReadGridRow | undefined }) {
  if (!row) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {row.when === "always" ? (
        <Badge variant="fact" shape="square">Always</Badge>
      ) : row.when === "review" ? (
        <Badge variant="fact" shape="square">Review clock</Badge>
      ) : row.when === "named" ? (
        <Badge variant="fact" shape="square">By name</Badge>
      ) : (
        row.situations.map((sit) => (
          <Badge key={sit.code} variant="fact" shape="square">
            <OriginIcon origin={sit.origin} />
            {sit.name}
          </Badge>
        ))
      )}
    </div>
  );
}

export function ReadDemo({ data }: { data?: FrameworkData }) {
  const fromContext = useFrameworkData();
  const d = data ?? fromContext;
  const [caseId, setCaseId] = useState<ReadCase["id"]>(READ_CASES[0].id);
  const c = READ_CASES.find((x) => x.id === caseId) ?? READ_CASES[0];
  const read = d?.read;
  const grid = read?.grid ?? [];
  const gridRow = (fieldId: string) => grid.find((g) => g.fieldId === fieldId);
  const example = (d?.situations ?? []).find((s) => s.code === EXAMPLE_SITUATION);

  // The fields this read lights. In a situation: every field marked Always
  // and every field with a situation badge (each goes when its badge's
  // situation is on the stock). The rest from the server's key lists.
  const lit: Set<string> =
    c.id === "line" ? fieldsLit(LINE_KEYS)
    : c.id === "writer" ? fieldsLit(WRITER_KEYS)
    : c.id === "situation" ? new Set(grid.filter((g) => g.when === "always" || g.when === "situations").map((g) => g.fieldId))
    : c.id === "review" ? fieldsLit(read?.keys.review ?? [])
    : fieldsLit(read?.keys.named ?? []);
  const always = grid.filter((g) => g.when === "always").length;
  const bySituation = grid.filter((g) => g.when === "situations").length;
  const count =
    c.id === "situation"
      ? `${always} always · ${bySituation} by situation`
      : `${SHEET_FIELDS.filter((f) => lit.has(f.id)).length} of ${SHEET_FIELDS.length} fields sent`;

  const sample =
    c.id === "line" ? (read?.samples.line ?? EXAMPLE_LINE)
    : c.id === "situation" ? read?.samples.bySituation[EXAMPLE_SITUATION]
    : c.id === "review" ? read?.samples.review
    : c.id === "named" ? read?.samples.named
    : undefined;
  // The example's own fields, by label, so the sample's caption says what joined the standing ones.
  const exampleExtra = grid
    .filter((g) => g.when === "situations" && g.situations.some((s) => s.code === EXAMPLE_SITUATION))
    .map((g) => SHEET_FIELDS.find((f) => f.id === g.fieldId)?.label.toLowerCase() ?? g.fieldId);
  const instructions = c.id === "situation" ? example : c.id === "review" ? (d?.situations ?? []).find((s) => s.code === "REVIEW_DUE") : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ChipTabs
        options={READ_CASES.map((x) => ({ value: x.id, label: x.chip, title: x.title }))}
        value={c.id}
        onChange={(v) => { if (v != null) setCaseId(v); }}
        clearable={false}
      />

      <div
        className="grid gap-4 rounded-2xl border bg-muted/40 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        {/* The thesis, as the sheet shows it: one stack, every field, each
            with the badges that say when it goes. At desktop the card is
            taken out of the row's sizing (absolute in its cell) so the right
            column alone sets the height and the sheet scrolls inside it;
            stacked (under lg) it is a fixed height so the page doesn't grow
            by the whole sheet. */}
        <div className="relative min-h-0 min-w-0 lg:min-h-[28rem]">
          <div className="flex max-h-[32rem] min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm lg:absolute lg:inset-0 lg:max-h-none">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold text-foreground">C</span>
              <span className="text-sm font-medium text-foreground">CRWD</span>
              <span className="text-sm text-muted-foreground">CrowdStrike</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>
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
                        "flex flex-col gap-1.5 rounded-lg px-2.5 py-2",
                        on ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "opacity-40",
                      )}
                    >
                      <span className="text-xs text-muted-foreground">{f.label}</span>
                      <FieldBody f={f} />
                      <WhenRow row={gridRow(f.id)} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* The read: what it is, what goes, as the model reads it. */}
        <div className="flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-medium text-foreground">{c.title}</h3>
            <p className="text-sm text-muted-foreground">{c.body}</p>
          </div>

          <ul className="flex flex-col gap-1.5 text-sm text-foreground">
            {c.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              As the model reads it
              {c.id === "situation" && example ? (
                <span className="normal-case tracking-normal"> · for example, {example.name.toLowerCase()}: the Always fields plus {exampleExtra.join(", ")}</span>
              ) : null}
            </span>
            {/* Built from the row the sheet shows, through the one builder (lib/docs/read-sample.ts); the Writer's case is its own prompt block. */}
            {c.id === "line" ? (
              <Mono as="pre" className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
                {sample}
              </Mono>
            ) : (
              <Mono as="pre" className="max-h-40 overflow-hidden whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
                {sample ?? SHEET_FIELDS.filter((f) => lit.has(f.id)).map((f) => `${f.label.toLowerCase()}: ${f.value}`).join("\n")}
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

      <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        The badges under a field say when it goes: Always, with the named situation (
        <Zap className="inline size-3" fill="currentColor" aria-label="a bolt" /> one a trigger firing starts,{" "}
        <FlagNotificationIcon className="inline size-3" dot="current" /> one read off the stock&apos;s facts), on the review clock, or only by name.
        The review clock also sends every field marked Always or with a situation; a read by name sends all of them.
      </p>
    </div>
  );
}
