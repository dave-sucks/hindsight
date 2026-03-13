"use client";

import { ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { useState } from "react";

// ─── Provider metadata ──────────────────────────────────────────────────────

interface ProviderMeta {
  color: string;
  /** URL for the provider's favicon/logo. null = use color dot fallback */
  logo: string | null;
  /** Display domain for the favicon fallback */
  domain: string | null;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  finnhub: {
    color: "bg-blue-500",
    logo: "https://static2.finnhub.io/img/favicon.png",
    domain: "finnhub.io",
  },
  reddit: {
    color: "bg-orange-500",
    logo: "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png",
    domain: "reddit.com",
  },
  options: {
    color: "bg-purple-500",
    logo: null,
    domain: "cboe.com",
  },
  earnings: {
    color: "bg-amber-500",
    logo: null,
    domain: "earningswhispers.com",
  },
  technical: {
    color: "bg-cyan-500",
    logo: null,
    domain: null,
  },
  stocktwits: {
    color: "bg-green-500",
    logo: "https://www.google.com/s2/favicons?domain=stocktwits.com&sz=32",
    domain: "stocktwits.com",
  },
  fmp: {
    color: "bg-indigo-500",
    logo: "https://www.google.com/s2/favicons?domain=financialmodelingprep.com&sz=32",
    domain: "financialmodelingprep.com",
  },
  yahoo: {
    color: "bg-violet-500",
    logo: "https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32",
    domain: "finance.yahoo.com",
  },
  sec: {
    color: "bg-slate-500",
    logo: "https://www.google.com/s2/favicons?domain=sec.gov&sz=32",
    domain: "sec.gov",
  },
  twitter: {
    color: "bg-sky-500",
    logo: "https://www.google.com/s2/favicons?domain=x.com&sz=32",
    domain: "x.com",
  },
  x: {
    color: "bg-sky-500",
    logo: "https://www.google.com/s2/favicons?domain=x.com&sz=32",
    domain: "x.com",
  },
};

function getProviderMeta(provider: string): ProviderMeta {
  const key = provider.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(PROVIDER_META)) {
    if (key.includes(k)) return v;
  }
  return { color: "bg-muted-foreground/50", logo: null, domain: null };
}

/** Get a favicon URL from a source URL or provider domain */
function getFaviconUrl(sourceUrl?: string, providerDomain?: string | null): string | null {
  // Try to extract domain from the source URL first
  if (sourceUrl) {
    try {
      const domain = new URL(sourceUrl).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      // invalid URL
    }
  }
  if (providerDomain) {
    return `https://www.google.com/s2/favicons?domain=${providerDomain}&sz=32`;
  }
  return null;
}

// ─── ProviderIcon — favicon with color dot fallback ──────────────────────────

function ProviderIcon({
  provider,
  url,
  size = 14,
}: {
  provider: string;
  url?: string;
  size?: number;
}) {
  const meta = getProviderMeta(provider);
  const [imgError, setImgError] = useState(false);

  const faviconUrl = meta.logo ?? getFaviconUrl(url, meta.domain);

  if (!faviconUrl || imgError) {
    // Fallback: colored dot
    return (
      <span
        className={cn("rounded-full shrink-0", meta.color)}
        style={{ width: size * 0.6, height: size * 0.6 }}
      />
    );
  }

  return (
    <Image
      src={faviconUrl}
      alt={provider}
      width={size}
      height={size}
      className="rounded-sm shrink-0"
      unoptimized
      onError={() => setImgError(true)}
    />
  );
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
      <ProviderIcon provider={provider} url={url} size={14} />
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

// ─── Stacked favicon row (Perplexity-style overlapping icons) ────────────────

export function SourceIconStack({
  sources,
  max = 4,
  className,
}: {
  sources: SourceChipData[];
  max?: number;
  className?: string;
}) {
  if (sources.length === 0) return null;
  const shown = sources.slice(0, max);
  const remainder = sources.length - max;

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-1.5">
        {shown.map((s, i) => (
          <div
            key={`${s.provider}-${i}`}
            className="rounded-full border-2 border-background bg-muted flex items-center justify-center"
            style={{ width: 22, height: 22, zIndex: max - i }}
          >
            <ProviderIcon provider={s.provider} url={s.url} size={14} />
          </div>
        ))}
      </div>
      {remainder > 0 && (
        <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">
          +{remainder}
        </span>
      )}
    </div>
  );
}
