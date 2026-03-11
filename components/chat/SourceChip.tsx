"use client";

import { ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Provider color map ─────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  finnhub: "bg-blue-500",
  reddit: "bg-orange-500",
  options: "bg-purple-500",
  earnings: "bg-amber-500",
  technical: "bg-cyan-500",
  stocktwits: "bg-green-500",
  fmp: "bg-indigo-500",
};

function providerDotColor(provider: string): string {
  const key = provider.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(PROVIDER_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "bg-muted-foreground/50";
}

// ─── SourceChip ────────────────────────────────────────────────────────────────

export type SourceChipData = {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
};

export function SourceChip({
  provider,
  title,
  url,
  excerpt,
}: SourceChipData) {
  const dotColor = providerDotColor(provider);

  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
        url && "cursor-pointer"
      )}
      onClick={
        url
          ? () => window.open(url, "_blank", "noopener,noreferrer")
          : undefined
      }
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
      <span className="truncate max-w-[180px]">{title || provider}</span>
      {url && <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />}
    </span>
  );

  if (!excerpt) return chip;

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger>{chip}</TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs text-xs leading-relaxed"
        >
          <p className="font-medium mb-0.5">{provider}</p>
          <p className="text-muted-foreground">{excerpt}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── SourceChipRow — renders multiple chips inline ──────────────────────────

export function SourceChipRow({
  sources,
  className,
}: {
  sources: SourceChipData[];
  className?: string;
}) {
  if (sources.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {sources.map((s, i) => (
        <SourceChip key={`${s.provider}-${i}`} {...s} />
      ))}
    </div>
  );
}
