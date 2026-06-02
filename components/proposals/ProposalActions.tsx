"use client";

/**
 * ProposalActions — the [Approve][Reject] button pair that drops into any
 * existing row component (TradeRow, ActivityRow, run-summary ticker row,
 * ThesisSheet header). Same callbacks everywhere; the only thing the row
 * component decides is layout + sizing.
 *
 * Calls the existing API routes built in Step 5:
 *   POST /api/proposals/[orderId]/approve
 *   POST /api/proposals/[orderId]/reject
 *
 * On success the page server-refreshes (router.refresh()) so every other
 * surface that shows the same Order picks up the new state. The local
 * `resolved` state hides the buttons immediately to prevent double-click.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §6.
 */

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProposalActionsProps {
  orderId: string;
  /** Size variant — "sm" fits inside trade rows / activity rows;
   *  "md" is for the thesis sheet header. Defaults to "sm". */
  size?: "sm" | "md";
  /** Render with text labels ("Approve" / "Reject") instead of icon-only.
   *  Defaults to true for "md", false for "sm" (icon-only on tight rows). */
  showLabels?: boolean;
  /** Hide the reject button (used in surfaces where reject lives in a
   *  separate kebab menu). Defaults to false. */
  hideReject?: boolean;
  /** Optional render-prop for the resolved state — if omitted, a tiny
   *  "Approved" / "Rejected" label renders. */
  renderResolved?: (state: "approved" | "rejected") => ReactNode;
  className?: string;
  /** Optional callback fired on successful approve/reject — lets a parent
   *  surface (e.g. activity row) clear its local optimistic state. */
  onResolved?: (state: "approved" | "rejected") => void;
}

export function ProposalActions({
  orderId,
  size = "sm",
  showLabels,
  hideReject = false,
  renderResolved,
  className,
  onResolved,
}: ProposalActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveShowLabels = showLabels ?? size === "md";
  const btnSize = size === "md" ? "default" : "sm";

  const handleApprove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPending("approve");
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${orderId}/approve`, { method: "POST" });
      // 202 (uncertain Alpaca) is still a success for UI purposes —
      // reconcile-orders will resolve the fill.
      if (!res.ok && res.status !== 202) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setResolved("approved");
      onResolved?.("approved");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approval failed";
      setError(msg);
      console.error(`[proposal-actions] approve ${orderId} failed:`, msg);
    } finally {
      setPending(null);
    }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPending("reject");
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${orderId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setResolved("rejected");
      onResolved?.("rejected");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reject failed";
      setError(msg);
      console.error(`[proposal-actions] reject ${orderId} failed:`, msg);
    } finally {
      setPending(null);
    }
  };

  if (resolved) {
    if (renderResolved) return <>{renderResolved(resolved)}</>;
    return (
      <span
        className={cn(
          "text-xs",
          resolved === "approved" ? "text-emerald-500" : "text-muted-foreground",
        )}
      >
        {resolved === "approved" ? "Approved" : "Rejected"}
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant="default"
        size={btnSize}
        disabled={pending !== null}
        onClick={handleApprove}
        aria-label="Approve"
      >
        {pending === "approve" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        {effectiveShowLabels && <span className="ml-1">Approve</span>}
      </Button>
      {!hideReject && (
        <Button
          variant="outline"
          size={btnSize}
          disabled={pending !== null}
          onClick={handleReject}
          aria-label="Reject"
        >
          {pending === "reject" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <X className="size-3.5" />
          )}
          {effectiveShowLabels && <span className="ml-1">Reject</span>}
        </Button>
      )}
      {error && (
        <span
          className="text-[10px] text-red-500 ml-1"
          title={error}
        >
          Failed
        </span>
      )}
    </div>
  );
}
