'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MockThesis } from '@/lib/mock-data/research';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  Target,
  ShieldAlert,
  ArrowDownUp,
} from 'lucide-react';

interface ThesisCardProps {
  thesis: MockThesis;
  compact?: boolean;
}

function ConfidenceRing({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color =
    score >= 75 ? 'text-emerald-500' : score >= 55 ? 'text-amber-500' : 'text-red-500';
  const strokeColor =
    score >= 75 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={44} height={44} className="-rotate-90">
        <circle
          cx={22}
          cy={22}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          className="text-border"
        />
        <circle
          cx={22}
          cy={22}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={3}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn('absolute text-xs font-bold tabular-nums', color)}>
        {score}
      </span>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: MockThesis['direction'] }) {
  const map = {
    LONG: 'border-primary/50 text-primary',
    SHORT: 'border-amber-500/50 text-amber-500',
    NEUTRAL: 'border-muted-foreground/50 text-muted-foreground',
  };
  return (
    <Badge variant="outline" className={cn('text-xs font-semibold', map[direction])}>
      {direction}
    </Badge>
  );
}

export default function ThesisCard({ thesis, compact = false }: ThesisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleBullets = expanded ? thesis.bullets : thesis.bullets.slice(0, 3);

  return (
    <Card className="border-border w-full">
      <CardContent className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <ConfidenceRing score={thesis.confidenceScore} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-lg font-bold text-foreground tracking-tight">
                {thesis.ticker}
              </span>
              <DirectionBadge direction={thesis.direction} />
              <span className="text-xs text-muted-foreground">{thesis.holdDuration}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{thesis.companyName}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">R:R</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {thesis.riskReward.toFixed(2)}x
            </p>
          </div>
        </div>

        {/* Summary */}
        <p className="text-sm text-muted-foreground leading-relaxed">{thesis.summary}</p>

        {/* Thesis bullets */}
        <div className="space-y-1.5">
          {visibleBullets.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span className="text-foreground/80 leading-snug">{b.point}</span>
            </div>
          ))}
          {thesis.bullets.length > 3 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> +{thesis.bullets.length - 3} more
                </>
              )}
            </button>
          )}
        </div>

        {/* Risk flags */}
        {thesis.riskFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {thesis.riskFlags.map((r, i) => (
              <Badge
                key={i}
                variant="outline"
                className="border-amber-500/30 text-amber-500 text-xs gap-1"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {r.flag}
              </Badge>
            ))}
          </div>
        )}

        <Separator />

        {/* Entry / Target / Stop / R:R */}
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Entry', value: thesis.entryPrice, icon: ArrowDownUp },
            { label: 'Target', value: thesis.targetPrice, icon: Target },
            { label: 'Stop', value: thesis.stopPrice, icon: ShieldAlert },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="space-y-0.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                ${value.toFixed(2)}
              </p>
            </div>
          ))}
          <div className="space-y-0.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">R:R</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-500">
              {thesis.riskReward.toFixed(2)}x
            </p>
          </div>
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Link
            href={`/trades/${thesis.id}/thesis`}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
          >
            View Full Thesis <ExternalLink className="h-3 w-3" />
          </Link>
          <div className="ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    size="sm"
                    disabled
                    className="text-xs h-8 cursor-not-allowed opacity-50"
                  >
                    Place Paper Trade
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Available in M3 — AI agent integration</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
