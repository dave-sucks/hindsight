"use client";

/**
 * InlineCitation — adapted from vercel/ai-elements.
 * Inline citation badges with hover tooltip using shadcn HoverCard.
 */

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    className={cn("group inline items-center gap-1", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    className={cn("transition-colors group-hover:bg-accent rounded-sm", className)}
    {...props}
  />
);

export interface InlineCitationBadgeProps {
  index?: number;
  label?: string;
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  provider?: string;
  className?: string;
}

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

export const InlineCitationBadge = ({
  index,
  label,
  title,
  url,
  domain,
  snippet,
  provider,
  className,
}: InlineCitationBadgeProps) => {
  const displayLabel = label ?? (index != null ? `${index}` : "?");
  const resolvedDomain =
    domain ??
    (url
      ? (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return "unknown";
          }
        })()
      : undefined);

  return (
    <HoverCard>
      <HoverCardTrigger
        openDelay={100}
        render={
          <Badge
            variant="secondary"
            className={cn(
              "cursor-pointer rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums align-super ml-0.5",
              className,
            )}
          />
        }
      >
        {displayLabel}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 space-y-2">
        <div className="flex items-center gap-2">
          {provider ? (
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                providerDotColor(provider),
              )}
            />
          ) : (
            <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {provider ?? resolvedDomain ?? "unknown"}
          </span>
          {url && (
            <ExternalLinkIcon className="size-2.5 shrink-0 ml-auto text-muted-foreground" />
          )}
        </div>
        {title && (
          <p className="text-sm font-medium">{title}</p>
        )}
        {snippet && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {snippet}
          </p>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="h-3 w-3" />
            View source
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};
