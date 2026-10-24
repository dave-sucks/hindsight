import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TradeStatement } from "@/components/ui/trade-statement";
import { buildTradeSentence } from "@/lib/trade-statement";
import { getTradeStatusDisplay, humanizeCloseReason } from "@/lib/trade-status";
import { getThesisStatusDisplay } from "@/lib/thesis-status";
import { formatCurrency } from "@/lib/format";
import {
  pastThesisWord,
  positionGain,
  positionHref,
  tradeStatusKey,
  type ClosedTrade,
  type HistoryPosition,
  type HistoryThesis,
  type StockHistorySummary,
} from "@/lib/stock-history";
import { cn, pnlColor } from "@/lib/utils";

/**
 * StockHistoryCard — what this account has done on one stock: the open
 * position first, then a proposal waiting on you, the names watching it
 * now, every trade that closed, and every thesis that ended. The first few
 * of each list show; the rest open in place.
 */

const SHOWN = 3;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** The first few rows, then the rest behind one line. */
function Folded<T>({ items, render, noun }: { items: T[]; render: (x: T) => React.ReactNode; noun: string }) {
  const head = items.slice(0, SHOWN);
  const rest = items.slice(SHOWN);
  return (
    <div className="flex flex-col">
      {head.map(render)}
      {rest.length > 0 ? (
        <Collapsible>
          <CollapsibleContent className="flex flex-col">{rest.map(render)}</CollapsibleContent>
          <CollapsibleTrigger className="group flex w-full items-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <span className="group-data-[panel-open]:hidden">
              Show {rest.length} more {noun}
            </span>
            <span className="hidden group-data-[panel-open]:inline">Show fewer</span>
            <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
        </Collapsible>
      ) : null}
    </div>
  );
}

/** A held or proposed position: the one block on the card that stands out. */
function PositionBlock({ p, livePrice }: { p: HistoryPosition; livePrice: number | null }) {
  const key = tradeStatusKey(p);
  const display = getTradeStatusDisplay(key);
  const proposal = key === "PENDING";
  const sentence = proposal
    ? buildTradeSentence({ kind: "proposed-buy", qty: p.quantity, entry: p.avgCost, buyVerb: p.direction === "SHORT" ? "Short" : "Buy" })
    : buildTradeSentence({ kind: "holding", qty: p.quantity, entry: p.avgCost, current: livePrice });
  const gain = proposal ? null : positionGain(p, livePrice);
  return (
    <Link href={positionHref(p)} className="block rounded-lg border bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70">
      {/* The status and the gain on one line; the sentence wraps under it — a
          320px column is too narrow for both on one line. */}
      <TradeStatement label={display.label} dotClass={display.dotClass} sentence={null} gain={gain} />
      {sentence ? <p className="mt-1 text-sm tabular-nums text-foreground">{sentence}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {p.analystName ? `${p.analystName} · ` : ""}
        {proposal ? "proposed" : "opened"} {fmtDate(p.openedAt)}
        {" · "}
        <span className="underline-offset-2 hover:underline">Open thesis →</span>
      </p>
    </Link>
  );
}

function ClosedRow({ c }: { c: ClosedTrade }) {
  const display = getTradeStatusDisplay(tradeStatusKey(c));
  const exit = humanizeCloseReason(c.closeReason);
  return (
    <Link href={positionHref(c)} className="-mx-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
      <TradeStatement label={display.label} dotClass={display.dotClass} sentence={null} gain={c.gain} />
      <p className="mt-0.5 pl-3.5 text-sm tabular-nums text-foreground">
        {buildTradeSentence({ kind: "closed", qty: c.quantity, entry: c.avgCost, closePrice: c.closePrice })}
      </p>
      <p className="mt-0.5 pl-3.5 text-xs text-muted-foreground tabular-nums">
        {fmtDate(c.openedAt)}
        {c.closedAt ? ` → ${fmtDate(c.closedAt)}` : ""}
        {c.analystName ? ` · ${c.analystName}` : ""}
        {exit ? ` · ${exit}` : ""}
      </p>
    </Link>
  );
}

function ThesisRow({ t, meta }: { t: HistoryThesis; meta: string }) {
  const display = getThesisStatusDisplay(t.status);
  return (
    <Link href={`/theses/${t.id}`} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/60">
      <span className={cn("size-2 shrink-0 rounded-full", display.dotClass)} />
      <span className="min-w-0 flex-1 truncate font-medium">{t.analystName ?? "Thesis"}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
    </Link>
  );
}

function statsLine(s: StockHistorySummary["stats"]): string | null {
  if (s.buys === 0) return null;
  const parts = [`${s.buys} ${s.buys === 1 ? "buy" : "buys"}`];
  if (s.won) parts.push(`${s.won} won`);
  if (s.lost) parts.push(`${s.lost} lost`);
  return parts.join(" · ");
}

export function StockHistoryCard({ summary, livePrice }: { summary: StockHistorySummary; livePrice: number | null }) {
  const { open, proposed, closed, watching, past, neverBought, stats } = summary;
  const line = statsLine(stats);
  const empty = !open && !proposed && closed.length === 0 && watching.length === 0 && past.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        {line ? (
          <CardDescription className="tabular-nums">
            {line}
            {closed.length > 0 ? (
              <>
                {" · "}
                <span className={pnlColor(stats.realized)}>
                  {stats.realized >= 0 ? "+" : ""}
                  {formatCurrency(stats.realized)} realized
                </span>
              </>
            ) : null}
          </CardDescription>
        ) : (
          <CardDescription>{empty ? "Nothing on this stock yet." : "Never bought."}</CardDescription>
        )}
      </CardHeader>
      {empty ? null : (
        <CardContent>
          <div className="flex flex-col gap-4">
            {open ? <PositionBlock p={open} livePrice={livePrice} /> : null}
            {proposed ? <PositionBlock p={proposed} livePrice={livePrice} /> : null}

            {watching.length > 0 ? (
              <div className="flex flex-col gap-1">
                <SectionLabel>Watching now</SectionLabel>
                <Folded items={watching} noun="watching" render={(t) => <ThesisRow key={t.id} t={t} meta={`since ${fmtDate(t.createdAt)}`} />} />
              </div>
            ) : null}

            {closed.length > 0 ? (
              <div className="flex flex-col gap-1">
                <SectionLabel>Trades</SectionLabel>
                <Folded items={closed} noun="trades" render={(c) => <ClosedRow key={c.id} c={c} />} />
              </div>
            ) : null}

            {past.length > 0 ? (
              <div className="flex flex-col gap-1">
                <SectionLabel>
                  Past theses
                  {neverBought > 0 ? <span className="normal-case tracking-normal"> · {neverBought} never bought</span> : null}
                </SectionLabel>
                <Folded items={past} noun="theses" render={(t) => <ThesisRow key={t.id} t={t} meta={`${pastThesisWord(t)} · ${fmtDate(t.createdAt)}`} />} />
              </div>
            ) : null}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
