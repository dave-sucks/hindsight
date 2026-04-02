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
import { ChevronDownIcon, Loader2Icon } from "lucide-react";

// ── ToolProgress (root) ────────────────────────────────────────────────────

export type ToolProgressProps = ComponentProps<"div"> & {
  defaultOpen?: boolean;
};

export const ToolProgress = memo(
  ({ className, defaultOpen = false, children, ...props }: ToolProgressProps) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className={cn("not-prose w-full", className)} data-open={open || undefined} {...props}>
          {children}
        </div>
      </Collapsible>
    );
  }
);
ToolProgress.displayName = "ToolProgress";

// ── Header ─────────────────────────────────────────────────────────────────

export type ToolProgressHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
};

export const ToolProgressHeader = memo(
  ({ className, loading, icon: Icon, children, ...props }: ToolProgressHeaderProps) => (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span className="flex-1 text-left">{children}</span>
      {loading ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <ChevronDownIcon className="size-3.5 transition-transform [[data-open]_&]:rotate-180" />
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
      className={cn("space-y-1 pb-2", className)}
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
        "flex items-start gap-2.5 text-sm pl-1",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "mt-[7px] size-1 shrink-0 rounded-full",
          active ? "bg-foreground animate-pulse" : "bg-muted-foreground/50"
        )}
      />
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  )
);
ToolProgressItem.displayName = "ToolProgressItem";

// ── Ticker Item (logo + ticker + tag + summary) ────────────────────────────

export type ToolProgressTickerItemProps = ComponentProps<"div"> & {
  ticker: string;
  tag?: string;
  children: ReactNode;
};

export const ToolProgressTickerItem = memo(
  ({ className, ticker, tag, children, ...props }: ToolProgressTickerItemProps) => (
    <div className={cn("pl-1 space-y-0.5", className)} {...props}>
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://assets.parqet.com/logos/symbol/${ticker}`}
          alt=""
          width={16}
          height={16}
          className="size-4 shrink-0 rounded-sm"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <span className="text-xs font-mono font-medium">${ticker}</span>
        {tag && (
          <span className="text-[10px] text-muted-foreground">{tag}</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground pl-6">{children}</p>
    </div>
  )
);
ToolProgressTickerItem.displayName = "ToolProgressTickerItem";

// ── Sources (inline favicon + domain badges) ───────────────────────────────

export type ToolProgressSourcesProps = ComponentProps<"div"> & {
  domains: string[];
};

export const ToolProgressSources = memo(
  ({ className, domains, ...props }: ToolProgressSourcesProps) => {
    if (domains.length === 0) return null;

    return (
      <div
        className={cn("flex items-center gap-3 pt-1 pl-1", className)}
        {...props}
      >
        {domains.map((domain) => (
          <span key={domain} className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
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
