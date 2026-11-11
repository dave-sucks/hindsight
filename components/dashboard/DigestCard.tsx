'use client';

/**
 * The homepage digest card: Portfolio | Market. The Portfolio Digest is
 * written at 8 PM ET; the Market Digest at 7:30 AM ET. The card shows the
 * chosen one's date and the start of its text; a click opens the dialog on
 * the same tab, where each digest reads in full under its own date.
 */

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { LatestDigest } from '@/lib/actions/digest.actions';
import { DigestMarkdown } from '@/components/ui/ticker-markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TickBar, type Tick } from '@/components/ui/gauge';
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from '@/components/ui/tooltip';

export type DigestTab = 'portfolio' | 'market';

const TABS: ReadonlyArray<{ value: DigestTab; label: string; title: string; empty: string }> = [
  { value: 'portfolio', label: 'Portfolio', title: 'Portfolio Digest', empty: 'No digest yet — generates after close.' },
  { value: 'market', label: 'Market', title: 'Market Digest', empty: 'No market digest has been written yet. The first is written at 7:30 AM ET on a weekday.' },
];

function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // **bold**
    .replace(/\*([^*]+)\*/g, '$1')            // *italic*
    .replace(/^#+\s/gm, '')                    // headings
    .replace(/`[^`]*`/g, '')                   // code
    .trim();
}

/** "Today, 4:32 PM" / "Yesterday, 4:32 PM" / "Mon Oct 26, 4:32 PM" — the
 *  trading day the digest covers (a UTC-midnight date) against today in ET,
 *  with the time it was written. */
export function formatDigestStamp(digest: LatestDigest, now: Date = new Date()): string {
  const day = digest.date.slice(0, 10);
  const etDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayLabel =
    day === etDay(now)
      ? 'Today'
      : day === etDay(yesterday)
        ? 'Yesterday'
        : new Date(digest.date).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
          }).replace(',', '');
  const written = new Date(digest.createdAt);
  if (Number.isNaN(written.getTime())) return dayLabel;
  const time = written.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
  return `${dayLabel}, ${time}`;
}

/** Win rate as ten ticks; the tooltip trigger is the ticks alone so hovering
 *  beside them does nothing. */
function WinRateTicks({ winRate }: { winRate: number | null }) {
  return (
    <UITooltipProvider>
      <UITooltip>
        <UITooltipTrigger render={<span className="inline-flex cursor-default" />}>
          <TickBar
            height={12}
            ticks={Array.from({ length: 10 }, (_, i): Tick => ({
              color: winRate != null && i < Math.round(winRate * 10)
                ? 'bg-foreground'
                : 'bg-muted-foreground/25',
            }))}
            className="w-12"
          />
        </UITooltipTrigger>
        <UITooltipContent side="bottom" align="end">
          <div className="text-xs">
            {winRate != null ? `${Math.round(winRate * 100)}% win rate` : 'No closed trades yet'}
          </div>
        </UITooltipContent>
      </UITooltip>
    </UITooltipProvider>
  );
}

function DigestTabsList() {
  return (
    <TabsList size="sm">
      {TABS.map((t) => (
        <TabsTrigger key={t.value} value={t.value}>
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

const STAMP = 'text-[10px] font-mono uppercase tracking-wide text-muted-foreground';

export function DigestCard({
  portfolio,
  market,
  winRate,
  initialTab = 'portfolio',
}: {
  portfolio: LatestDigest | null | undefined;
  market: LatestDigest | null | undefined;
  winRate: number | null;
  initialTab?: DigestTab;
}) {
  const [tab, setTab] = useState<DigestTab>(initialTab);
  const [open, setOpen] = useState(false);
  // Neither prop given: the page has no digests to show.
  if (portfolio === undefined && market === undefined) return null;

  const digests: Record<DigestTab, LatestDigest | null> = { portfolio: portfolio ?? null, market: market ?? null };
  const active = TABS.find((t) => t.value === tab) ?? TABS[0];
  const digest = digests[tab];
  // The Market tab leads with its brief; the Portfolio tab with its text. Slice
  // generously so it fills the taller desktop card; the line-clamp + bottom
  // fade handle the visual cutoff at either size.
  const preview = digest ? stripMarkdown(digest.brief || digest.narrative).slice(0, 700) : null;
  const onTab = (v: unknown) => setTab(v === 'market' ? 'market' : 'portfolio');

  return (
    <>
      {/* lg:h-[390px] matches the chart card so the two columns align; the
          tabs and the preview are siblings, so no control sits in another. */}
      <div className="w-full rounded-lg border bg-card p-3 mb-3 flex flex-col overflow-hidden lg:h-[390px]">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <Tabs value={tab} onValueChange={onTab}>
            <DigestTabsList />
          </Tabs>
          <WinRateTicks winRate={winRate} />
        </div>
        <button
          type="button"
          onClick={() => digest && setOpen(true)}
          disabled={!digest}
          className={cn(
            'relative flex-1 min-h-0 overflow-hidden text-left flex flex-col',
            digest ? 'hover:brightness-[0.98] transition-all cursor-pointer' : 'cursor-default',
          )}
        >
          {digest && preview ? (
            <>
              <p className={cn(STAMP, 'mb-1 shrink-0')}>{formatDigestStamp(digest)}</p>
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <p className="text-base font-medium leading-relaxed line-clamp-6 lg:line-clamp-none">{preview}</p>
                {/* Subtle fade so the clamped narrative trails off into the card. */}
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-card to-transparent pointer-events-none" />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{active.empty}</p>
          )}
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl p-0">
          <Tabs value={tab} onValueChange={onTab}>
            <DialogHeader className="px-5 pt-5 pb-3 border-b">
              <div>
                <DigestTabsList />
              </div>
              <p className={STAMP}>{digest ? formatDigestStamp(digest) : 'Not written yet'}</p>
              <DialogTitle className="text-base font-semibold">{active.title}</DialogTitle>
            </DialogHeader>
            {TABS.map((t) => {
              const d = digests[t.value];
              return (
                <TabsContent key={t.value} value={t.value}>
                  <div className="max-h-[65vh] overflow-y-auto px-5 py-4 space-y-3">
                    {d?.numbers?.length ? (
                      // Printed by code from what the run read; the words below are the Market Reviewer's.
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Market numbers</p>
                        <ul className="space-y-0.5">
                          {d.numbers.map((line) => (
                            <li key={line} className="text-sm text-muted-foreground tabular-nums">{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {d ? <DigestMarkdown>{d.narrative}</DigestMarkdown> : <p className="text-sm text-muted-foreground">{t.empty}</p>}
                    {d?.runId ? (
                      <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/runs/${d.runId}`} />}>
                        See what it read and did
                      </Button>
                    ) : null}
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
