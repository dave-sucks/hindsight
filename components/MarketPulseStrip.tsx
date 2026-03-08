import { isMarketOpen } from '@/lib/market-hours';
import { mockMarketIndices, type MarketIndex } from '@/lib/mock-data/market-pulse';

// ─── Mini sparkline ───────────────────────────────────────────────────────────

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 60;
  const h = 20;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = positive ? '#10b981' : '#ef4444';
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
    </svg>
  );
}

// ─── Single index item ────────────────────────────────────────────────────────

function IndexItem({ ticker, label, price, changePct, sparkline }: MarketIndex) {
  const positive = changePct >= 0;
  const sign = positive ? '+' : '';
  const priceStr = ticker === 'BTC'
    ? price.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : ticker === 'VIX'
    ? price.toFixed(2)
    : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs font-medium text-muted-foreground hidden sm:block">{label}</span>
      <span className="text-xs font-medium text-foreground tabular-nums">{priceStr}</span>
      <Sparkline points={sparkline} positive={positive} />
      <span className={`text-xs tabular-nums font-medium ${positive ? 'text-emerald-500' : 'text-red-500'}`}>
        {sign}{changePct.toFixed(2)}%
      </span>
    </div>
  );
}

// ─── Market status pill ───────────────────────────────────────────────────────

function MarketStatusPill({ open }: { open: boolean }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {open ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      ) : (
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
      )}
      <span className={`text-xs font-medium tabular-nums ${open ? 'text-emerald-500' : 'text-muted-foreground'}`}>
        {open ? 'Markets OPEN' : 'Markets CLOSED'} · {dateStr}
      </span>
    </div>
  );
}

// ─── Main strip ───────────────────────────────────────────────────────────────

export default function MarketPulseStrip() {
  const open = isMarketOpen();

  return (
    <div className="h-9 flex items-center gap-5 border-b px-4 overflow-x-auto bg-background shrink-0">
      {mockMarketIndices.map((index) => (
        <IndexItem key={index.ticker} {...index} />
      ))}
      <div className="ml-auto pl-4">
        <MarketStatusPill open={open} />
      </div>
    </div>
  );
}
