'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Sub-nav ──────────────────────────────────────────────────────────────────

function SettingsNav() {
  const pathname = usePathname();
  const links = [
    { href: '/settings', label: 'General' },
    { href: '/settings/agent', label: 'Agent Rules' },
  ];
  return (
    <div className="flex gap-1 border-b pb-0 mb-6">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            pathname === href
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

// ─── Toggle chip ──────────────────────────────────────────────────────────────

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
      )}
    >
      {label}
    </button>
  );
}

// ─── Config state type ────────────────────────────────────────────────────────

const ALL_SECTORS = ['Tech', 'Finance', 'Healthcare', 'Energy', 'Consumer', 'Industrials'];
const ALL_SIGNALS = ['Earnings Beat', 'Sector Rotation', 'Technical Breakout', 'News Catalyst', 'Short Squeeze', 'Options Flow'];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentRulesPage() {
  // Market Universe
  const [markets, setMarkets] = useState({ equities: true, crypto: true, etfs: false });
  const [exchanges, setExchanges] = useState({ nasdaq: true, nyse: true });
  const [sectors, setSectors] = useState<Set<string>>(new Set(['Tech', 'Finance']));
  const [watchlistInput, setWatchlistInput] = useState('NVDA, TSLA, AAPL, MSFT');
  const [exclusionInput, setExclusionInput] = useState('SPCE, AMC');

  // Risk Parameters
  const [maxPosition, setMaxPosition] = useState('500');
  const [maxOpenPositions, setMaxOpenPositions] = useState('5');
  const [minConfidence, setMinConfidence] = useState(70);
  const [maxRisk, setMaxRisk] = useState('2');
  const [dailyLossLimit, setDailyLossLimit] = useState('200');

  // Trade Style
  const [holdDuration, setHoldDuration] = useState<'day' | 'swing' | 'position'>('swing');
  const [directionBias, setDirectionBias] = useState<'long' | 'short' | 'both'>('both');
  const [signals, setSignals] = useState<Set<string>>(new Set(['Earnings Beat', 'Short Squeeze']));
  const [minMarketCap, setMinMarketCap] = useState('Large ($10B+)');

  function toggleSector(s: string) {
    setSectors((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  function toggleSignal(s: string) {
    setSignals((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  // Live preview summary
  const preview = useMemo(() => {
    const mktList = [
      markets.equities && 'US Equities',
      markets.crypto && 'Crypto',
      markets.etfs && 'ETFs',
    ].filter(Boolean).join(' and ');
    const exchList = [exchanges.nasdaq && 'NASDAQ', exchanges.nyse && 'NYSE'].filter(Boolean).join('/') || 'all exchanges';
    const holdLabel = holdDuration === 'day' ? 'day trades (intraday)' : holdDuration === 'swing' ? 'swing trades (3–10 days)' : 'position trades (weeks)';
    const sectorList = sectors.size > 0 ? Array.from(sectors).join(' and ') : 'all sectors';
    const signalList = signals.size > 0 ? Array.from(signals).join(' and ') : 'all signals';
    const dir = directionBias === 'long' ? 'long-only' : directionBias === 'short' ? 'short-only' : 'long and short';
    return `With these settings, the agent will scan ${exchList} for ${holdLabel} in ${sectorList} using ${signalList} signals, ${dir} direction, with ${minConfidence}%+ confidence and max $${maxPosition}/trade across ${mktList}.`;
  }, [markets, exchanges, holdDuration, sectors, signals, directionBias, minConfidence, maxPosition]);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <SettingsNav />

      {/* ── Card 1: Market Universe ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Market Universe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Markets</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {([
                { key: 'equities', label: 'US Equities' },
                { key: 'crypto', label: 'Crypto' },
                { key: 'etfs', label: 'ETFs' },
              ] as const).map(({ key, label }) => (
                <ToggleChip key={key} label={label} active={markets[key]} onClick={() => setMarkets((m) => ({ ...m, [key]: !m[key] }))} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exchanges</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {([
                { key: 'nasdaq', label: 'NASDAQ' },
                { key: 'nyse', label: 'NYSE' },
              ] as const).map(({ key, label }) => (
                <ToggleChip key={key} label={label} active={exchanges[key]} onClick={() => setExchanges((e) => ({ ...e, [key]: !e[key] }))} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sectors</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {ALL_SECTORS.map((s) => (
                <ToggleChip key={s} label={s} active={sectors.has(s)} onClick={() => toggleSector(s)} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Watchlist (focus tickers)</Label>
            <Input
              value={watchlistInput}
              onChange={(e) => setWatchlistInput(e.target.value)}
              placeholder="NVDA, TSLA, AAPL..."
              className="font-mono text-sm h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exclusions</Label>
            <Input
              value={exclusionInput}
              onChange={(e) => setExclusionInput(e.target.value)}
              placeholder="SPCE, AMC..."
              className="font-mono text-sm h-8"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Card 2: Risk Parameters ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Risk Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: 'Max Position Size', value: maxPosition, set: setMaxPosition, suffix: 'per trade', prefix: '$' },
            { label: 'Max Open Positions', value: maxOpenPositions, set: setMaxOpenPositions, suffix: 'simultaneous' },
            { label: 'Max Risk Per Trade', value: maxRisk, set: setMaxRisk, suffix: '% of portfolio' },
            { label: 'Daily Loss Limit', value: dailyLossLimit, set: setDailyLossLimit, suffix: 'pause agent if exceeded', prefix: '$' },
          ].map(({ label, value, set, suffix, prefix }) => (
            <div key={label} className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
              <div className="flex items-center gap-2">
                <div className="relative w-32">
                  {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
                  <Input
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className={cn('h-8 text-sm tabular-nums', prefix && 'pl-6')}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{suffix}</span>
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Min Confidence to Trade</Label>
              <span className="text-sm font-semibold tabular-nums">{minConfidence}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={90}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50% (permissive)</span>
              <span>90% (strict)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Card 3: Trade Style Rules ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Trade Style Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hold Duration</Label>
            <div className="flex gap-2 pt-1">
              {(['day', 'swing', 'position'] as const).map((d) => (
                <ToggleChip
                  key={d}
                  label={d === 'day' ? 'Day Trade' : d === 'swing' ? 'Swing' : 'Position'}
                  active={holdDuration === d}
                  onClick={() => setHoldDuration(d)}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Direction Bias</Label>
            <div className="flex gap-2 pt-1">
              {(['long', 'short', 'both'] as const).map((d) => (
                <ToggleChip
                  key={d}
                  label={d === 'both' ? 'Both' : d === 'long' ? 'Long Only' : 'Short Only'}
                  active={directionBias === d}
                  onClick={() => setDirectionBias(d)}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Signal Types</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {ALL_SIGNALS.map((s) => (
                <ToggleChip key={s} label={s} active={signals.has(s)} onClick={() => toggleSignal(s)} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Min Market Cap</Label>
            <div className="flex gap-2 pt-1">
              {(['Small ($300M+)', 'Mid ($2B+)', 'Large ($10B+)', 'Mega ($200B+)'] as const).map((cap) => (
                <ToggleChip key={cap} label={cap} active={minMarketCap === cap} onClick={() => setMinMarketCap(cap)} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Preview ── */}
      <Card className="border-border bg-muted/30">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Agent Preview</p>
          <p className="text-sm text-foreground leading-relaxed">{preview}</p>
        </CardContent>
      </Card>

      {/* ── Save ── */}
      <div className="flex justify-end">
        <Button
          onClick={() => toast.info('Saved (activation in M5)')}
          size="sm"
        >
          Save Agent Rules
        </Button>
      </div>
    </div>
  );
}
