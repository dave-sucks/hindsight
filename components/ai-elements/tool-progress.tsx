"use client";

/**
 * ToolProgress — simplified tool execution display.
 * Replaces ChainOfThought for all tool UIs.
 * One level of collapse. Flat dot lists. No per-item icons.
 */

import { memo, useState, type ComponentProps, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";

// ── ToolProgress (root) ────────────────────────────────────────────────────

export type ToolProgressProps = ComponentProps<"div"> & {
  defaultOpen?: boolean;
};

export const ToolProgress = memo(
  ({ className, defaultOpen = false, children, ...props }: ToolProgressProps) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className={cn("not-prose w-full my-3", className)} data-open={open || undefined} {...props}>
          {children}
        </div>
      </Collapsible>
    );
  }
);
ToolProgress.displayName = "ToolProgress";

// ── Header (inline — chevron right after text, not full-width) ─────────────

export type ToolProgressHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
};

export const ToolProgressHeader = memo(
  ({ className, loading, icon: Icon, children, ...props }: ToolProgressHeaderProps) => (
    <CollapsibleTrigger
      className={cn(
        "inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span>{children}</span>
      {loading ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <ChevronRightIcon className="size-3 transition-transform [[data-open]_&]:rotate-90" />
      )}
    </CollapsibleTrigger>
  )
);
ToolProgressHeader.displayName = "ToolProgressHeader";

// ── Content ────────────────────────────────────────────────────────────────

export type ToolProgressContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolProgressContent = memo(
  ({ className, ...props }: ToolProgressContentProps) => (
    <CollapsibleContent
      className={cn("space-y-1.5 pt-1 pb-1", className)}
      {...props}
    />
  )
);
ToolProgressContent.displayName = "ToolProgressContent";

// ── Item (dot + text) ──────────────────────────────────────────────────────

export type ToolProgressItemProps = ComponentProps<"div"> & {
  active?: boolean;
};

export const ToolProgressItem = memo(
  ({ className, active, children, ...props }: ToolProgressItemProps) => (
    <div
      className={cn(
        "flex items-start gap-2 text-sm",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "mt-[7px] size-[5px] shrink-0 rounded-full",
          active ? "bg-foreground animate-pulse" : "bg-muted-foreground/40"
        )}
      />
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  )
);
ToolProgressItem.displayName = "ToolProgressItem";

// ── Ticker Item (inline: logo + $TICKER + (tag) + summary) ─────────────────

export type ToolProgressTickerItemProps = ComponentProps<"div"> & {
  ticker: string;
  tag?: string;
  children: ReactNode;
};

export const ToolProgressTickerItem = memo(
  ({ className, ticker, tag, children, ...props }: ToolProgressTickerItemProps) => (
    <div
      className={cn("flex items-start gap-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-muted-foreground/40" />
      <span className="flex-1 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://assets.parqet.com/logos/symbol/${ticker}`}
          alt=""
          width={14}
          height={14}
          className="size-3.5 shrink-0 rounded-sm inline-block align-text-bottom mr-1"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <span className="font-mono text-xs font-medium text-foreground">${ticker}</span>
        {tag && <span className="text-muted-foreground"> ({tag})</span>}
        <span className="text-muted-foreground"> — </span>
        {children}
      </span>
    </div>
  )
);
ToolProgressTickerItem.displayName = "ToolProgressTickerItem";

// ── Sources (inline favicon + domain) ──────────────────────────────────────

export type ToolProgressSourcesProps = ComponentProps<"div"> & {
  domains: string[];
};

export const ToolProgressSources = memo(
  ({ className, domains, ...props }: ToolProgressSourcesProps) => {
    if (domains.length === 0) return null;

    return (
      <div
        className={cn("flex items-center gap-3 pt-1", className)}
        {...props}
      >
        {domains.map((domain) => (
          <span key={domain} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
              alt=""
              width={12}
              height={12}
              className="size-3 shrink-0 rounded-sm"
              loading="lazy"
            />
            {domain}
          </span>
        ))}
      </div>
    );
  }
);
ToolProgressSources.displayName = "ToolProgressSources";
