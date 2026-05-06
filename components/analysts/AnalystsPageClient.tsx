"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { TradeRow } from "@/components/ui/trade-row";
import { deleteAnalyst } from "@/lib/actions/analyst.actions";
import type { AnalystListItem } from "@/lib/actions/analyst.actions";
import { BuilderShowcaseTrigger, BuilderShowcaseButton } from "@/components/domain/run-showcase-trigger";
import { ChatEntryComposer } from "@/components/assistant-ui/chat-entry-composer";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";

// ── AnalystCard ───────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+.+$/gm, '')    // Remove entire heading lines
    .replace(/\*\*[\s\S]+?\*\*/g, (m) => m.slice(2, -2))
    .replace(/\*[\s\S]+?\*/g, (m) => m.slice(1, -1))
    .replace(/`(.+?)`/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

function AnalystCard({ analyst, onDelete }: { analyst: AnalystListItem; onDelete: (id: string) => void }) {
  const router = useRouter();
  const rawPrompt = analyst.analystPrompt || analyst.description || null;
  const promptText = rawPrompt ? stripMarkdown(rawPrompt) : null;

  const openCount = analyst.openTrades.length;
  const winRatePct = analyst.winRate != null ? Math.round(analyst.winRate * 100) : null;

  return (
    <Card className="gap-0 h-full overflow-hidden shadow-none py-0 min-w-0">
      <Link
        href={`/analysts/${analyst.id}`}
        className="block hover:bg-muted/20 transition-colors"
      >
        {/* ── Header, name, description ── */}
        <div className="p-3 flex flex-col gap-2 min-w-0">
          {/* Row 1: badges left · 3-dot right */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {openCount > 0 && (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
                  {openCount} open
                </span>
              )}
              {winRatePct != null && (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
                  {winRatePct}% win
                </span>
              )}
              {analyst.totalPnl !== 0 && (
                <PnlBadge value={analyst.totalPnl} format="currency" />
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent/60 transition-colors text-muted-foreground shrink-0"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => router.push(`/analysts/${analyst.id}`)}>
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push(`/analysts/${analyst.id}/edit`)}>
                  Edit config
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-negative focus:text-negative"
                  onSelect={() => onDelete(analyst.id)}
                >
                  Delete analyst
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Row 2: name — unified header style */}
          <h2 className="text-sm font-medium text-foreground leading-tight truncate">
            {analyst.name}
          </h2>

          {/* Row 3: description */}
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {promptText ?? (
              <span className="text-muted-foreground/60 not-italic">No prompt set</span>
            )}
          </p>
        </div>
      </Link>

      {/* ── Active trades ── */}
      {analyst.openTrades.length > 0 && (
        <div className="border-t">
          {analyst.openTrades.map((trade) => (
            <TradeRow
              key={trade.id}
              id={trade.id}
              ticker={trade.ticker}
              currentPrice={trade.currentPrice}
              entryPrice={trade.entryPrice}
              shares={trade.shares}
              pnl={trade.pnl}
              pnlPct={trade.pnlPct}
              status={trade.status}
              openedAt={trade.openedAt}
              priceSource={trade.priceSource}
              priceUpdatedAt={trade.priceUpdatedAt}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ── New Analyst card ──────────────────────────────────────────────────────────

function NewAnalystCard() {
  return (
    <Link href="/analysts/new">
      <Card className="h-full border-dashed hover:bg-muted/20 transition-colors cursor-pointer shadow-none py-0">
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[180px] text-muted-foreground p-4">
          <div className="h-8 w-8 rounded-full border-2 border-dashed border-current flex items-center justify-center">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">New Analyst</p>
          <p className="text-xs text-center">Describe what you want to find</p>
        </div>
      </Card>
    </Link>
  );
}

// ── Template suggestions ─────────────────────────────────────────────────────

const TEMPLATES = [
  {
    title: "Momentum Trader",
    description: "Watches for intraday breakouts on high-volume tech stocks. Uses RSI, volume spikes, and moving average crossovers to time entries.",
    prompt:
      "Build me a momentum trader that catches breakouts on high-volume stocks using RSI, volume spikes, and moving average crossovers.",
  },
  {
    title: "Earnings Analyst",
    description: "Trades the run-up before earnings announcements and rides post-earnings drift. Tracks EPS surprises and guidance changes.",
    prompt:
      "I want an analyst that trades around earnings — catches the run-up before announcements and rides post-earnings momentum.",
  },
  {
    title: "Value Swing Trader",
    description: "Buys oversold dips on quality large-cap stocks when technicals hit extremes. Targets a bounce back to the moving average.",
    prompt:
      "Create a swing trader that uses mean reversion — buys oversold dips on quality large-cap stocks when RSI drops below 30.",
  },
];

// ── Template card that sends prompt into the thread ──────────────────────────

function TemplateCard({ title, description, prompt }: typeof TEMPLATES[number]) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        router.push(`/analysts/new?prompt=${encodeURIComponent(prompt)}`);
      }}
      className="text-left"
    >
      <Card className="p-4 h-full hover:bg-muted/50 transition-colors cursor-pointer shadow-none ring-0 border">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {description}
        </p>
      </Card>
    </button>
  );
}

// ── Empty state — template cards + standalone composer ───────────────────────

function AnalystsEmptyState() {
  return (
    <div className="flex flex-col h-[calc(100dvh-12rem)]">
      {/* Spacer pushes cards toward bottom */}
      <div className="flex-1" />

      {/* Template cards — carousel on mobile, grid on desktop */}
      <div className="mb-4">
        <Carousel opts={{ align: "start" }}>
          <CarouselContent className="-ml-3 sm:grid sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <CarouselItem key={t.title} className="pl-3 basis-[80%] sm:basis-auto">
                <TemplateCard {...t} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>

      {/* Standalone entry composer — navigates to /analysts/new on send */}
      <ChatEntryComposer
        targetUrl="/analysts/new"
        features={{
          placeholder: "Describe any strategy, sector, or style…",
        }}
        tooltip={{
          title: "Build any analyst",
          description: "Describe a strategy, sector, or style and I'll create a custom analyst for you.",
          storageKey: "analyst-composer",
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystsPageClient({
  analysts,
}: {
  analysts: AnalystListItem[];
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const targetAnalyst = analysts.find((a) => a.id === deleteTarget);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAnalyst(deleteTarget);
      toast.success("Analyst deleted");
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete analyst");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (analysts.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
        <BuilderShowcaseTrigger />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Analysts</h1>
            <BuilderShowcaseButton />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Describe any industry, sector, or strategy and we&apos;ll build an autonomous trading analyst for you.
          </p>
        </div>
        <AnalystsEmptyState />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analysts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI trading personas that research stocks and place paper trades autonomously
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {analysts.map((analyst) => (
          <AnalystCard key={analyst.id} analyst={analyst} onDelete={setDeleteTarget} />
        ))}
        <NewAnalystCard />
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete {targetAnalyst?.name ?? "Analyst"}</DialogTitle>
            <DialogDescription>
              This will permanently delete this analyst and all associated data:
              runs, theses, trades, events, and briefings. Any open Alpaca
              positions will be closed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="gap-2"
            >
              {deleteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleteLoading ? "Deleting…" : "Delete Analyst"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
