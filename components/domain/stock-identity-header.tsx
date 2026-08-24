import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";

/**
 * StockIdentityHeader — the ONE stock-identity header shared by the trade
 * detail page and the thesis sheet (and any future surface that leads with a
 * stock). Every trade has a thesis, so these two views must read identically:
 *
 *   [logo]  Company Full Name   [badges →]
 *           TICKER · EXCHANGE
 *
 * Both surfaces previously hand-rolled this block and drifted (h1 vs linked p,
 * linked vs unlinked name, different class order). Extracting it here makes
 * them literally the same markup. Badges are a per-surface slot — the trade
 * page passes its trade-status badge, the sheet passes StatusPill +
 * ConvictionBadge — because the status *taxonomies* legitimately differ; only
 * the layout + typography unify.
 */
interface StockIdentityHeaderProps {
  ticker: string;
  /** Big title — company full name, falling back to ticker (caller resolves). */
  displayName: string;
  exchange?: string | null;
  /** Rendered inline to the right of the name (StatusPill, ConvictionBadge, …). */
  badges?: ReactNode;
  /**
   * Icon-button strip on the far right of the whole header — pin, bookmark,
   * per-surface menus. A slot rather than per-page siblings so the trade page,
   * the stock page and the thesis sheet all put their buttons in the same
   * place at the same size instead of each arranging its own right edge.
   */
  actions?: ReactNode;
  /**
   * Where the logo + name link. Defaults to the stock page `/stocks/[ticker]`.
   * Pass `null` to render the identity unlinked.
   */
  href?: string | null;
  className?: string;
}

export function StockIdentityHeader({
  ticker,
  displayName,
  exchange,
  badges,
  actions,
  href,
  className,
}: StockIdentityHeaderProps) {
  const link = href === undefined ? `/stocks/${ticker}` : href;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {link ? (
        <Link href={link} className="shrink-0">
          <StockLogo ticker={ticker} size="lg" />
        </Link>
      ) : (
        <span className="shrink-0">
          <StockLogo ticker={ticker} size="lg" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        {/* Name left, badges pushed to the far right (justify-between). On a
            narrow screen the name truncates and the badges stay pinned right. */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          {link ? (
            <Link href={link} className="group/stocklink min-w-0">
              <p className="text-xl font-semibold truncate group-hover/stocklink:underline underline-offset-4">
                {displayName}
              </p>
            </Link>
          ) : (
            <p className="text-xl font-semibold truncate">{displayName}</p>
          )}
          {badges ? (
            <div className="flex items-center gap-1.5 shrink-0">{badges}</div>
          ) : null}
        </div>
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mt-0.5">
          {ticker}
          {exchange ? ` · ${exchange}` : ""}
        </p>
      </div>
      {actions ? (
        <div className="flex items-center gap-0.5 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
