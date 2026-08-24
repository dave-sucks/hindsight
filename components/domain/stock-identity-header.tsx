import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";

/**
 * StockIdentityHeader — the ONE stock-identity header shared by the trade
 * detail page and the thesis sheet (and any future surface that leads with a
 * stock). Every trade has a thesis, so these two views must read identically:
 *
 *   [badges]
 *   [logo]  Company Full Name              [icon buttons →]
 *           TICKER · EXCHANGE
 *
 * Badges sit on their OWN row above the identity, not inline right of the
 * name. The right edge of the header is reserved for the icon-button strip
 * (`actions`) — pin, bookmark, per-surface menus — and that has to be the same
 * place on every surface. Badges competing for the same edge is what made the
 * thesis sheet read differently from the trade page.
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
  /** Pill row above the identity (StatusPill, ConvictionBadge, trade status …). */
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
  const logo = <StockLogo ticker={ticker} size="lg" />;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Badge row — wraps rather than squeezing the identity when a surface
          carries several. */}
      {badges ? (
        <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
      ) : null}
      <div className="flex items-center gap-3">
        {link ? (
          <Link href={link} className="shrink-0">
            {logo}
          </Link>
        ) : (
          <span className="shrink-0">{logo}</span>
        )}
        <div className="flex-1 min-w-0">
          {link ? (
            <Link href={link} className="group/stocklink min-w-0">
              <p className="text-xl font-semibold truncate group-hover/stocklink:underline underline-offset-4">
                {displayName}
              </p>
            </Link>
          ) : (
            <p className="text-xl font-semibold truncate">{displayName}</p>
          )}
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mt-0.5">
            {ticker}
            {exchange ? ` · ${exchange}` : ""}
          </p>
        </div>
        {/* The one right edge — icon buttons only, same place on every surface. */}
        {actions ? (
          <div className="flex items-center gap-0.5 shrink-0">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
