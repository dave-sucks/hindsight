"use client";

/**
 * ToolProgress — simplified tool execution display.
 * One level of collapse. Flat dot lists. No per-item icons.
 */

import { memo, useState, type ComponentProps, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ChevronRightIcon,
  DotIcon,
  PlusIcon,
  MinusIcon,
  EyeIcon,
  EyeOffIcon,
  CheckIcon,
  XIcon,
  BanIcon,
} from "lucide-react";

// ── Action icon overlay (used by ToolProgressTickerItem for action tools) ──

export type TickerActionIcon =
  | "buy"
  | "sell"
  | "watch"
  | "unwatch"
  | "closed-win"
  | "closed-loss"
  | "failed";

const ACTION_ICON_CONFIG: Record<
  TickerActionIcon,
  { Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  buy:           { Icon: PlusIcon,   className: "bg-emerald-500 text-white" },
  sell:          { Icon: MinusIcon,  className: "bg-red-500 text-white" },
  watch:         { Icon: EyeIcon,    className: "bg-muted-foreground text-background" },
  unwatch:       { Icon: EyeOffIcon, className: "bg-muted-foreground text-background" },
  "closed-win":  { Icon: CheckIcon,  className: "bg-emerald-500 text-white" },
  "closed-loss": { Icon: XIcon,      className: "bg-red-500 text-white" },
  failed:        { Icon: BanIcon,    className: "bg-muted text-muted-foreground" },
};

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

// ── Header (inline — chevron right after text) ─────────────────────────────

export type ToolProgressHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  /** Accepted for API compatibility; the header no longer renders its own
   *  spinner — the global breathing dot on the running assistant message is
   *  the single source of progress. */
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
};

export const ToolProgressHeader = memo(
  ({ className, loading: _loading, icon: Icon, children, ...props }: ToolProgressHeaderProps) => (
    <CollapsibleTrigger
      className={cn(
        "inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span>{children}</span>
      <ChevronRightIcon className="size-3 transition-transform [[data-open]_&]:rotate-90" />
    </CollapsibleTrigger>
  )
);
ToolProgressHeader.displayName = "ToolProgressHeader";

// ── Table ──────────────────────────────────────────────────────────────────
// Rows that all carry the same fields, lined up. The alternative is what this
// replaced: the same five facts written as a sentence, twenty-one times, with
// nothing in the same place twice.
//
// It knows nothing about what the columns are — a tool declares them.

export type ToolProgressTableProps = {
  columns: readonly string[];
  /** Column indexes to right-align, so numbers stack. */
  align?: readonly number[];
  rows: ReadonlyArray<{
    ticker?: string;
    cells: ReadonlyArray<string | { text: string; tone?: "pos" | "neg" }>;
  }>;
};

export const ToolProgressTable = memo(
  ({ columns, align, rows }: ToolProgressTableProps) => {
    const right = new Set(align ?? []);
    const hasTicker = rows.some((r) => r.ticker);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {hasTicker && <TableHead>Ticker</TableHead>}
            {columns.map((c, i) => (
              <TableHead key={c + i} className={right.has(i) ? "text-right" : undefined}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, ri) => (
            <TableRow key={(r.ticker ?? "") + ri}>
              {hasTicker && (
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {r.ticker ? <StockLogo ticker={r.ticker} size="xs" /> : null}
                    <span className="font-medium text-foreground">
                      {r.ticker ? `$${r.ticker}` : ""}
                    </span>
                  </span>
                </TableCell>
              )}
              {r.cells.map((cell, ci) => {
                const text = typeof cell === "string" ? cell : cell.text;
                const tone = typeof cell === "string" ? undefined : cell.tone;
                return (
                  <TableCell
                    key={ci}
                    className={cn(
                      "tabular-nums",
                      right.has(ci) && "text-right",
                      tone === "pos" && "text-positive",
                      tone === "neg" && "text-negative",
                    )}
                  >
                    {text}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  },
);
ToolProgressTable.displayName = "ToolProgressTable";

// ── Content ────────────────────────────────────────────────────────────────

export type ToolProgressContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolProgressContent = memo(
  ({ className, ...props }: ToolProgressContentProps) => (
    <CollapsibleContent
      className={cn("space-y-3 pt-2 pb-1", className)}
      {...props}
    />
  )
);
ToolProgressContent.displayName = "ToolProgressContent";

// ── Item (DotIcon + text — same pattern as Notion/Claude CoT) ──────────────

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
      <div className="size-4 shrink-0 mt-0.5 flex items-center justify-center">
        <DotIcon className="size-5" />
      </div>
      <span className={cn("flex-1 min-w-0", active && "shimmer-text")}>{children}</span>
    </div>
  )
);
ToolProgressItem.displayName = "ToolProgressItem";

// ── Ticker Item (logo replaces dot, same fixed-width slot) ─────────────────

export type ToolProgressTickerItemProps = ComponentProps<"div"> & {
  ticker: string;
  tag?: string;
  actionIcon?: TickerActionIcon;
  active?: boolean;
  children: ReactNode;
  /**
   * Trailing slot rendered to the right of the description text. Used by
   * the Trade-as-Proposal flow to drop inline [Approve][Reject] buttons
   * onto a ticker row without inventing a new component. See
   * docs/plans/TRADE_AS_PROPOSAL.md §6.1.
   */
  trailing?: ReactNode;
};

export const ToolProgressTickerItem = memo(
  ({ className, ticker, tag, actionIcon, active, children, trailing, ...props }: ToolProgressTickerItemProps) => {
    const overlay = actionIcon ? ACTION_ICON_CONFIG[actionIcon] : null;
    return (
      <div
        className={cn("flex items-start gap-2 text-sm text-muted-foreground", className)}
        {...props}
      >
        {/* The app's one ticker avatar. This used to be its own <img> with its
            own fallback: hide the image and add a `fallback-dot` class — a
            class that is defined nowhere, so a ticker the logo vendor doesn't
            have ($NVNI, $BTM and $QTEX all 404) rendered as an empty gap.
            StockLogo falls back to the ticker's initial on the same muted
            square every other surface uses. */}
        <div className="relative size-4 shrink-0 mt-0.5 flex items-center justify-center">
          <StockLogo ticker={ticker} size="xs" />
          {overlay && (
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-1 ring-background flex items-center justify-center",
                overlay.className,
              )}
              aria-hidden
            >
              <overlay.Icon className="size-1.5" />
            </span>
          )}
        </div>
        <span className={cn("flex-1 min-w-0", active && "shimmer-text")}>
          <span className="font-medium">${ticker}</span>
          {tag && <span> ({tag})</span>}
          <span> — </span>
          {children}
        </span>
        {trailing && <div className="shrink-0 ml-2">{trailing}</div>}
      </div>
    );
  }
);
ToolProgressTickerItem.displayName = "ToolProgressTickerItem";

